import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveFileContent, resolveFileContentFromAbsolutePath } from "./file-content-resolver";

describe("file content resolver", () => {
  it("reads text files with truncation and language hint", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-text-"));
    try {
      await mkdir(path.join(repoRoot, "src"), { recursive: true });
      await writeFile(path.join(repoRoot, "src", "index.ts"), "export const value = 123;\n");

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "src/index.ts",
        maxBytes: 10,
      });

      expect(result).toMatchObject({
        path: "src/index.ts",
        isBinary: false,
        truncated: true,
        languageHint: "typescript",
      });
      expect(result.content).toBe("export con");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects binary files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-bin-"));
    try {
      await mkdir(path.join(repoRoot, "assets"), { recursive: true });
      await writeFile(path.join(repoRoot, "assets", "raw.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "assets/raw.bin",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "assets/raw.bin",
        isBinary: true,
        truncated: false,
        languageHint: null,
        content: null,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns metadata only for image files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-image-"));
    const imageBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+Zl8AAAAASUVORK5CYII=";
    try {
      await mkdir(path.join(repoRoot, "assets"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "assets", "pixel.png"),
        Buffer.from(imageBase64, "base64"),
      );

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "assets/pixel.png",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "assets/pixel.png",
        isBinary: true,
        truncated: false,
        languageHint: null,
        content: null,
      });
      expect(result.content).toBeNull();
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not truncate binary metadata when an image exceeds maxBytes", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-image-limit-"));
    const imageBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+Zl8AAAAASUVORK5CYII=";
    try {
      await mkdir(path.join(repoRoot, "assets"), { recursive: true });
      const imageBuffer = Buffer.from(imageBase64, "base64");
      await writeFile(path.join(repoRoot, "assets", "pixel.png"), imageBuffer);

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "assets/pixel.png",
        maxBytes: imageBuffer.length - 1,
      });

      expect(result.isBinary).toBe(true);
      expect(result.truncated).toBe(false);
      expect(result.sizeBytes).toBe(imageBuffer.length);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not misclassify utf-8 text when sample ends mid-character", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-utf8-edge-"));
    try {
      await mkdir(path.join(repoRoot, "tmp"), { recursive: true });
      const content = `${"a".repeat(8_191)}あ`;
      await writeFile(path.join(repoRoot, "tmp", "edge.md"), content);

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "tmp/edge.md",
        maxBytes: 20_000,
      });

      expect(result).toMatchObject({
        path: "tmp/edge.md",
        isBinary: false,
        truncated: false,
        languageHint: "markdown",
      });
      expect(result.content).toBe(content);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns html language hint for HTML files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-html-"));
    try {
      await mkdir(path.join(repoRoot, "public"), { recursive: true });
      await writeFile(path.join(repoRoot, "public", "preview.html"), "<main>Preview</main>\n");

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "public/preview.html",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "public/preview.html",
        isBinary: false,
        truncated: false,
        languageHint: "html",
        content: "<main>Preview</main>\n",
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns rust language hint for Rust files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-rust-"));
    try {
      await mkdir(path.join(repoRoot, "src"), { recursive: true });
      await writeFile(path.join(repoRoot, "src", "main.rs"), "fn main() {}\n");

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "src/main.rs",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "src/main.rs",
        isBinary: false,
        truncated: false,
        languageHint: "rust",
        content: "fn main() {}\n",
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns go language hint for Go files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-go-"));
    try {
      await mkdir(path.join(repoRoot, "cmd"), { recursive: true });
      await writeFile(path.join(repoRoot, "cmd", "main.go"), "package main\n\nfunc main() {}\n");

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "cmd/main.go",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "cmd/main.go",
        isBinary: false,
        truncated: false,
        languageHint: "go",
        content: "package main\n\nfunc main() {}\n",
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns swift language hint for Swift files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-swift-"));
    try {
      await mkdir(path.join(repoRoot, "Sources"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "Sources", "App.swift"),
        "import SwiftUI\n\n@main struct App: SwiftUI.App {\n  var body: some Scene { WindowGroup {} }\n}\n",
      );

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "Sources/App.swift",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "Sources/App.swift",
        isBinary: false,
        truncated: false,
        languageHint: "swift",
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns nix language hint for Nix files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-nix-"));
    try {
      await writeFile(
        path.join(repoRoot, "flake.nix"),
        '{\n  description = "vde-monitor";\n  outputs = { self }: {};\n}\n',
      );

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "flake.nix",
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: "flake.nix",
        isBinary: false,
        truncated: false,
        languageHint: "nix",
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      extension: "lua",
      content: "local value = 1\n",
      languageHint: "lua",
    },
    {
      extension: "toml",
      content: 'name = "vde-monitor"\n',
      languageHint: "toml",
    },
  ])("returns $languageHint language hint for .$extension files", async (fixture) => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), `vde-monitor-file-content-${fixture.extension}-`),
    );
    try {
      const normalizedPath = `config.${fixture.extension}`;
      await writeFile(path.join(repoRoot, normalizedPath), fixture.content);

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath,
        maxBytes: 1024,
      });

      expect(result).toMatchObject({
        path: normalizedPath,
        isBinary: false,
        truncated: false,
        languageHint: fixture.languageHint,
        content: fixture.content,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-file paths", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-dir-"));
    try {
      await mkdir(path.join(repoRoot, "src"), { recursive: true });

      await expect(
        resolveFileContent({
          repoRoot,
          normalizedPath: "src",
          maxBytes: 100,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_PAYLOAD",
        status: 400,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("allows symlinks that resolve inside the repository", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-link-"));
    try {
      await writeFile(path.join(repoRoot, "target.txt"), "target\n");
      await symlink(path.join(repoRoot, "target.txt"), path.join(repoRoot, "linked.txt"));

      const result = await resolveFileContent({
        repoRoot,
        normalizedPath: "linked.txt",
        maxBytes: 100,
      });
      expect(result.content).toBe("target\n");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlinks that resolve outside the repository", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-link-root-"));
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "vde-monitor-file-content-link-outside-"),
    );
    try {
      const outsideFile = path.join(outsideRoot, "outside.txt");
      await writeFile(outsideFile, "outside\n");
      await symlink(outsideFile, path.join(repoRoot, "linked.txt"));

      await expect(
        resolveFileContent({
          repoRoot,
          normalizedPath: "linked.txt",
          maxBytes: 100,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN_PATH",
        status: 403,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rechecks the allowed root against the opened file handle", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-safe-open-"));
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "vde-monitor-file-content-safe-open-outside-"),
    );
    try {
      const outsideFile = path.join(outsideRoot, "outside.txt");
      await writeFile(outsideFile, "outside\n");

      await expect(
        resolveFileContentFromAbsolutePath({
          absolutePath: outsideFile,
          allowedRootPath: repoRoot,
          displayPath: "outside.txt",
          maxBytes: 100,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN_PATH",
        status: 403,
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects an allowed root replaced with a symlink before opening", async () => {
    const parentRoot = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-file-content-root-swap-"));
    const allowedRoot = path.join(parentRoot, "allowed");
    const originalRoot = path.join(parentRoot, "allowed-original");
    const outsideRoot = path.join(parentRoot, "outside");
    await mkdir(allowedRoot);
    await mkdir(outsideRoot);
    await writeFile(path.join(allowedRoot, "file.txt"), "safe\n");
    await writeFile(path.join(outsideRoot, "file.txt"), "secret\n");
    try {
      await rename(allowedRoot, originalRoot);
      await symlink(outsideRoot, allowedRoot);

      await expect(
        resolveFileContentFromAbsolutePath({
          absolutePath: path.join(allowedRoot, "file.txt"),
          allowedRootPath: allowedRoot,
          displayPath: "file.txt",
          maxBytes: 100,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN_PATH",
        status: 403,
      });
    } finally {
      await rm(parentRoot, { recursive: true, force: true });
    }
  });
});
