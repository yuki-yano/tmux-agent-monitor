// @vitest-environment node
// The happy-dom Request drops forbidden headers like content-length, which this suite must set.
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMAGE_ATTACHMENT_MAX_BYTES,
  IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES,
} from "./image-attachment";
import {
  authHeaders,
  createMultipartImagePayload,
  createTestContext,
} from "./api-router.test-helpers";

describe("createApiRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns REPO_UNAVAILABLE when repoRoot is missing on file tree endpoint", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/files/tree", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("REPO_UNAVAILABLE");
  });

  it("accepts the current repo root as an explicit file-route override", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-root-override-"));
    try {
      await execa("git", ["init", "--quiet", tmpRoot]);
      await writeFile(path.join(tmpRoot, "README.md"), "root\n");
      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
        worktreePath: null,
      });

      const res = await api.request(
        `/sessions/pane-1/files/tree?limit=200&worktreePath=${encodeURIComponent(tmpRoot)}`,
        { headers: authHeaders },
      );

      expect(res.status).toBe(200);
      expect((await res.json()).tree.entries).toContainEqual(
        expect.objectContaining({ path: "README.md", kind: "file" }),
      );
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("lists ignored tree entries as ignored and expands them explicitly", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-tree-"));
    try {
      await mkdir(path.join(tmpRoot, "src"), { recursive: true });
      await mkdir(path.join(tmpRoot, "build"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "build/\n");
      await writeFile(path.join(tmpRoot, "src", "index.ts"), "export {};\n");
      await writeFile(path.join(tmpRoot, "build", "output.txt"), "hidden\n");
      await execa("git", ["init", "--quiet", tmpRoot]);

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const rootRes = await api.request("/sessions/pane-1/files/tree?limit=200", {
        headers: authHeaders,
      });
      expect(rootRes.status).toBe(200);
      const rootData = await rootRes.json();
      const rootPaths = rootData.tree.entries.map((entry: { path: string }) => entry.path);
      expect(rootPaths).toContain("src");
      expect(rootPaths).toContain("build");
      expect(
        rootData.tree.entries.find((entry: { path: string }) => entry.path === "build"),
      ).toMatchObject({ isIgnored: true, hasChildren: true });

      const buildRes = await api.request("/sessions/pane-1/files/tree?path=build&limit=200", {
        headers: authHeaders,
      });
      expect(buildRes.status).toBe(200);
      const buildData = await buildRes.json();
      const buildPaths = buildData.tree.entries.map((entry: { path: string }) => entry.path);
      expect(buildPaths).toContain("build/output.txt");
      expect(buildData.tree.entries[0]).toMatchObject({ isIgnored: true });
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("searches file names with space-separated words and returns truncation metadata", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-search-"));
    try {
      await mkdir(path.join(tmpRoot, "src"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "");
      await writeFile(path.join(tmpRoot, "src", "alpha.ts"), "export const alpha = 1;\n");
      await writeFile(path.join(tmpRoot, "src", "beta.ts"), "export const beta = 1;\n");
      await writeFile(path.join(tmpRoot, "src", "gamma.ts"), "export const gamma = 1;\n");
      await execa("git", ["init", "--quiet", tmpRoot]);

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const firstRes = await api.request("/sessions/pane-1/files/search?q=a&limit=1", {
        headers: authHeaders,
      });
      expect(firstRes.status).toBe(200);
      const firstData = await firstRes.json();
      expect(firstData.result.query).toBe("a");
      expect(firstData.result.items.length).toBe(1);
      expect(firstData.result.totalMatchedCount).toBeGreaterThanOrEqual(2);
      expect(firstData.result.truncated).toBe(true);
      expect(typeof firstData.result.nextCursor).toBe("string");
      expect(typeof firstData.result.items[0].score).toBe("number");
      expect(Array.isArray(firstData.result.items[0].highlights)).toBe(true);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("search endpoint matches files containing all query words", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-search-words-"));
    try {
      await mkdir(path.join(tmpRoot, "src"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "");
      await writeFile(path.join(tmpRoot, "src", "alpha-beta.ts"), "export const alphaBeta = 1;\n");
      await writeFile(path.join(tmpRoot, "src", "alpha.ts"), "export const alpha = 1;\n");
      await writeFile(path.join(tmpRoot, "src", "beta.ts"), "export const beta = 1;\n");
      await execa("git", ["init", "--quiet", tmpRoot]);

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const res = await api.request("/sessions/pane-1/files/search?q=alpha%20beta&limit=10", {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.items.map((item: { path: string }) => item.path)).toEqual([
        "src/alpha-beta.ts",
      ]);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("accepts file search queries longer than 200 characters", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-search-long-query-"));
    try {
      await mkdir(path.join(tmpRoot, "src"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "");
      const longFilename = `${"a".repeat(210)}.ts`;
      await writeFile(path.join(tmpRoot, "src", longFilename), "export const long = 1;\n");
      await execa("git", ["init", "--quiet", tmpRoot]);

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const query = encodeURIComponent(longFilename);
      const res = await api.request(`/sessions/pane-1/files/search?q=${query}&limit=10`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.query).toBe(longFilename);
      expect(data.result.items.map((item: { path: string }) => item.path)).toContain(
        `src/${longFilename}`,
      );
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("returns file content with truncation metadata", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-content-"));
    try {
      await writeFile(path.join(tmpRoot, ".gitignore"), "");
      await writeFile(path.join(tmpRoot, "README.md"), "# title\nbody\n");

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const res = await api.request("/sessions/pane-1/files/content?path=README.md&maxBytes=5", {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.file.path).toBe("README.md");
      expect(data.file.isBinary).toBe(false);
      expect(data.file.truncated).toBe(true);
      expect(data.file.languageHint).toBe("markdown");
      expect(data.file.content).toBe("# tit");
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("returns a short-lived URL preview for supported binary image files", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-content-image-"));
    const imageBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+Zl8AAAAASUVORK5CYII=";
    try {
      await mkdir(path.join(tmpRoot, "assets"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "");
      await writeFile(
        path.join(tmpRoot, "assets", "pixel.png"),
        Buffer.from(imageBase64, "base64"),
      );

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const res = await api.request(
        "/sessions/pane-1/files/content?path=assets/pixel.png&maxBytes=1024",
        {
          headers: authHeaders,
        },
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.file.path).toBe("assets/pixel.png");
      expect(data.file.isBinary).toBe(true);
      expect(data.file.content).toBeNull();
      expect(data.file.preview).toMatchObject({ mimeType: "image/png" });
      expect(data.file.preview.url).toMatch(/^\/file-preview\/[^/]+\/r\/repo\/assets\/pixel\.png$/);
      expect(data.file.preview.token).not.toBe("");
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("exposes only registered .git/wt worktrees in tree, search, content, and preview", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-git-worktree-"));
    const imageBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+Zl8AAAAASUVORK5CYII=";
    try {
      await execa("git", ["init", "--quiet", repoRoot]);
      await writeFile(path.join(repoRoot, "main-only.txt"), "main\n");
      await execa("git", ["-C", repoRoot, "add", "main-only.txt"]);
      await execa("git", [
        "-C",
        repoRoot,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "initial",
      ]);

      const worktreeRoot = path.join(repoRoot, ".git", "wt", "feature", "nested");
      await execa("git", ["-C", repoRoot, "worktree", "add", "-b", "feature", worktreeRoot]);
      await writeFile(path.join(worktreeRoot, "worktree-only.txt"), "worktree\n");
      await mkdir(path.join(worktreeRoot, "assets"), { recursive: true });
      await writeFile(
        path.join(worktreeRoot, "assets", "pixel.png"),
        Buffer.from(imageBase64, "base64"),
      );
      await mkdir(path.join(repoRoot, ".git", "wt", "fake"), { recursive: true });
      await writeFile(path.join(repoRoot, ".git", "wt", "fake", "secret.txt"), "secret\n");

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot,
        currentPath: repoRoot,
        worktreePath: repoRoot,
      });

      const treeResponse = await api.request("/sessions/pane-1/files/tree?limit=200", {
        headers: authHeaders,
      });
      expect(treeResponse.status).toBe(200);
      const tree = await treeResponse.json();
      expect(tree.tree.entries.map((entry: { path: string }) => entry.path)).toContain(".git");

      const gitTreeResponse = await api.request("/sessions/pane-1/files/tree?path=.git&limit=200", {
        headers: authHeaders,
      });
      expect(gitTreeResponse.status).toBe(200);
      expect(
        (await gitTreeResponse.json()).tree.entries.map((entry: { path: string }) => entry.path),
      ).toEqual([".git/wt"]);

      const wtTreeResponse = await api.request(
        "/sessions/pane-1/files/tree?path=.git%2Fwt&limit=200",
        { headers: authHeaders },
      );
      expect(wtTreeResponse.status).toBe(200);
      expect(
        (await wtTreeResponse.json()).tree.entries.map((entry: { path: string }) => entry.path),
      ).toEqual([".git/wt/feature"]);

      const worktreeParentResponse = await api.request(
        "/sessions/pane-1/files/tree?path=.git%2Fwt%2Ffeature&limit=200",
        { headers: authHeaders },
      );
      expect(worktreeParentResponse.status).toBe(200);
      expect(
        (await worktreeParentResponse.json()).tree.entries.map(
          (entry: { path: string }) => entry.path,
        ),
      ).toEqual([".git/wt/feature/nested"]);

      const worktreeTreeResponse = await api.request(
        "/sessions/pane-1/files/tree?path=.git%2Fwt%2Ffeature%2Fnested&limit=200",
        { headers: authHeaders },
      );
      expect(worktreeTreeResponse.status).toBe(200);
      expect(
        (await worktreeTreeResponse.json()).tree.entries.map(
          (entry: { path: string }) => entry.path,
        ),
      ).toContain(".git/wt/feature/nested/worktree-only.txt");

      const fuzzySearchResponse = await api.request(
        "/sessions/pane-1/files/search?q=worktree-only&limit=20",
        { headers: authHeaders },
      );
      expect(fuzzySearchResponse.status).toBe(200);
      expect((await fuzzySearchResponse.json()).result.items).toContainEqual(
        expect.objectContaining({
          path: ".git/wt/feature/nested/worktree-only.txt",
          kind: "file",
        }),
      );

      const searchResponse = await api.request(
        "/sessions/pane-1/files/search?q=.git%2Fwt%2Ffeature%2Fnested%2Fworktree-only.txt&exactReference=1",
        { headers: authHeaders },
      );
      expect(searchResponse.status).toBe(200);
      const search = await searchResponse.json();
      expect(search.result.items).toContainEqual(
        expect.objectContaining({
          path: ".git/wt/feature/nested/worktree-only.txt",
          kind: "file",
        }),
      );

      const textResponse = await api.request(
        "/sessions/pane-1/files/content?path=.git%2Fwt%2Ffeature%2Fnested%2Fworktree-only.txt",
        { headers: authHeaders },
      );
      expect(textResponse.status).toBe(200);
      expect((await textResponse.json()).file.content).toBe("worktree\n");

      const imageResponse = await api.request(
        "/sessions/pane-1/files/content?path=.git%2Fwt%2Ffeature%2Fnested%2Fassets%2Fpixel.png",
        { headers: authHeaders },
      );
      expect(imageResponse.status).toBe(200);
      const image = await imageResponse.json();
      expect(image.file.preview).toMatchObject({ mimeType: "image/png" });

      for (const forbiddenPath of [
        ".git/config",
        ".git/objects",
        ".git/worktrees/feature/HEAD",
        ".git/wt/fake/secret.txt",
      ]) {
        const forbiddenResponse = await api.request(
          `/sessions/pane-1/files/content?path=${encodeURIComponent(forbiddenPath)}`,
          { headers: authHeaders },
        );
        expect(forbiddenResponse.status).toBe(403);
      }

      await execa("git", ["-C", repoRoot, "worktree", "remove", "--force", worktreeRoot]);
      await mkdir(worktreeRoot, { recursive: true });
      await writeFile(path.join(worktreeRoot, ".git"), "gitdir: forged\n");
      await writeFile(path.join(worktreeRoot, "stale.txt"), "stale\n");

      const staleResponse = await api.request(
        "/sessions/pane-1/files/content?path=.git%2Fwt%2Ffeature%2Fnested%2Fstale.txt",
        { headers: authHeaders },
      );
      expect(staleResponse.status).toBe(403);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns ignored content without an override flag", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-content-policy-"));
    try {
      await mkdir(path.join(tmpRoot, "build"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "build/\n");
      await writeFile(path.join(tmpRoot, "build", "output.txt"), "hidden\n");

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const res = await api.request("/sessions/pane-1/files/content?path=build/output.txt", {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.file.content).toBe("hidden\n");
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("returns exact ignored content for any extension while keeping .git hidden", async () => {
    const tmpRoot = await mkdtemp(
      path.join(os.tmpdir(), "vde-monitor-files-content-preview-policy-"),
    );
    try {
      await mkdir(path.join(tmpRoot, "docs"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".gitignore"), "docs/\n");
      await writeFile(path.join(tmpRoot, "docs", "notes.txt"), "Notes\n");
      await execa("git", ["init", "--quiet", tmpRoot]);

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const searchRes = await api.request(
        "/sessions/pane-1/files/search?q=docs%2Fnotes.txt&exactReference=1",
        {
          headers: authHeaders,
        },
      );
      expect(searchRes.status).toBe(200);
      const searchData = await searchRes.json();
      expect(searchData.result.items.map((item: { path: string }) => item.path)).toContain(
        "docs/notes.txt",
      );

      const res = await api.request("/sessions/pane-1/files/content?path=docs%2Fnotes.txt", {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.file.path).toBe("docs/notes.txt");
      expect(data.file.languageHint).toBe("text");
      expect(data.file.content).toBe("Notes\n");

      await mkdir(path.join(tmpRoot, ".git"), { recursive: true });
      await writeFile(path.join(tmpRoot, ".git", "secret.md"), "# secret\n");
      const hiddenRes = await api.request("/sessions/pane-1/files/content?path=.git%2Fsecret.md", {
        headers: authHeaders,
      });
      expect(hiddenRes.status).toBe(403);
      const hiddenData = await hiddenRes.json();
      expect(hiddenData.error.code).toBe("FORBIDDEN_PATH");
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("resolves configured external absolute references only in exact mode", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-external-repo-"));
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-external-root-"));
    try {
      await execa("git", ["init", "--quiet", repoRoot]);
      const externalFile = path.join(externalRoot, "preview.html");
      await writeFile(externalFile, "<h1>External</h1>\n");
      const { api, monitor, detail } = createTestContext({
        fileNavigator: {
          externalRoots: [externalRoot],
          autoExpandMatchLimit: 100,
        },
      });
      monitor.registry.update({
        ...detail,
        repoRoot,
        currentPath: repoRoot,
      });

      const fuzzyResponse = await api.request(
        `/sessions/pane-1/files/search?q=${encodeURIComponent(externalFile)}`,
        { headers: authHeaders },
      );
      expect(fuzzyResponse.status).toBe(200);
      expect((await fuzzyResponse.json()).result.items).toEqual([]);

      const exactResponse = await api.request(
        `/sessions/pane-1/files/search?q=${encodeURIComponent(externalFile)}&exactReference=1`,
        { headers: authHeaders },
      );
      expect(exactResponse.status).toBe(200);
      expect((await exactResponse.json()).result.items[0]).toMatchObject({
        path: externalFile,
        isIgnored: false,
      });

      const contentResponse = await api.request(
        `/sessions/pane-1/files/content?path=${encodeURIComponent(externalFile)}`,
        { headers: authHeaders },
      );
      expect(contentResponse.status).toBe(200);
      const content = await contentResponse.json();
      expect(content.file.path).toBe(externalFile);
      expect(content.file.content).toContain("External");
      expect(content.file.preview.url).toMatch(
        /^\/file-preview\/[^/]+\/r\/external-1\/preview\.html$/,
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("returns FORBIDDEN_PATH when content target is a symbolic link", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-content-symlink-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-files-content-outside-"));
    try {
      await writeFile(path.join(tmpRoot, ".gitignore"), "");
      const outsideFile = path.join(outsideRoot, "outside.txt");
      await writeFile(outsideFile, "outside\n");
      try {
        await symlink(outsideFile, path.join(tmpRoot, "outside-link.txt"));
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
          return;
        }
        throw error;
      }

      const { api, monitor, detail } = createTestContext();
      monitor.registry.update({
        ...detail,
        repoRoot: tmpRoot,
        currentPath: tmpRoot,
      });

      const res = await api.request("/sessions/pane-1/files/content?path=outside-link.txt", {
        headers: authHeaders,
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe("FORBIDDEN_PATH");
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("returns 400 when image attachment content-length is missing", async () => {
    const { api } = createTestContext();
    const payload = createMultipartImagePayload();
    const res = await api.request("/sessions/pane-1/attachments/image", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": `multipart/form-data; boundary=${payload.boundary}`,
      },
      body: payload.body,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PAYLOAD");
    expect(data.error.message).toBe("content-length header is required");
  });

  it("returns 400 when image attachment content-length is invalid", async () => {
    const { api } = createTestContext();
    const payload = createMultipartImagePayload();
    const res = await api.request("/sessions/pane-1/attachments/image", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": `multipart/form-data; boundary=${payload.boundary}`,
        "content-length": "abc",
      },
      body: payload.body,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PAYLOAD");
    expect(data.error.message).toBe("invalid content-length");
  });

  it("returns 400 when image attachment content-length exceeds limit", async () => {
    const { api } = createTestContext();
    const payload = createMultipartImagePayload();
    const res = await api.request("/sessions/pane-1/attachments/image", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": `multipart/form-data; boundary=${payload.boundary}`,
        "content-length": String(IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES + 1),
      },
      body: payload.body,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PAYLOAD");
    expect(data.error.message).toBe("attachment exceeds content-length limit");
  });

  it("returns 400 when image field is missing", async () => {
    const { api } = createTestContext();
    const formData = new FormData();
    formData.set(
      "file",
      new File([new TextEncoder().encode("png-data")], "sample.png", {
        type: "image/png",
      }),
    );
    const res = await api.request("/sessions/pane-1/attachments/image", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-length": "128",
      },
      body: formData,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PAYLOAD");
    expect(data.error.message).toBe("image field is required");
  });

  it("stores uploaded image and returns attachment metadata", async () => {
    const { api } = createTestContext();
    const formData = new FormData();
    formData.set(
      "image",
      new File([new TextEncoder().encode("png-data")], "sample.png", {
        type: "image/png",
      }),
    );
    const originalTmpDir = process.env.TMPDIR;
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-api-router-"));
    process.env.TMPDIR = tmpRoot;

    try {
      const res = await api.request("/sessions/pane-1/attachments/image", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-length": "128",
        },
        body: formData,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const realTmpRoot = await realpath(tmpRoot);
      expect(data.attachment.mimeType).toBe("image/png");
      expect(data.attachment.size).toBeGreaterThan(0);
      expect(data.attachment.size).toBeLessThanOrEqual(IMAGE_ATTACHMENT_MAX_BYTES);
      expect(
        data.attachment.path.startsWith(path.join(realTmpRoot, "vde-monitor", "attachments")),
      ).toBe(true);
      expect(data.attachment.insertText).toBe(`${data.attachment.path} `);
    } finally {
      if (typeof originalTmpDir === "string") {
        process.env.TMPDIR = originalTmpDir;
      } else {
        delete process.env.TMPDIR;
      }
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("accepts a 10MB file even when multipart content-length is larger than 10MB", async () => {
    const { api } = createTestContext();
    const formData = new FormData();
    formData.set(
      "image",
      new File([new Uint8Array(IMAGE_ATTACHMENT_MAX_BYTES).fill(1)], "sample.png", {
        type: "image/png",
      }),
    );
    const simulatedContentLength = IMAGE_ATTACHMENT_MAX_BYTES + 1024;
    expect(simulatedContentLength).toBeLessThanOrEqual(IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES);

    const originalTmpDir = process.env.TMPDIR;
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-api-router-"));
    process.env.TMPDIR = tmpRoot;

    try {
      const res = await api.request("/sessions/pane-1/attachments/image", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-length": String(simulatedContentLength),
        },
        body: formData,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.attachment.size).toBe(IMAGE_ATTACHMENT_MAX_BYTES);
    } finally {
      if (typeof originalTmpDir === "string") {
        process.env.TMPDIR = originalTmpDir;
      } else {
        delete process.env.TMPDIR;
      }
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
