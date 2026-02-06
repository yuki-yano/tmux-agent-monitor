import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { encodePaneId } from "@vde-monitor/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IMAGE_ATTACHMENT_MAX_BYTES, saveImageAttachment } from "./image-attachment.js";

const createImageFile = ({
  mimeType = "image/png",
  size = 6,
}: {
  mimeType?: string;
  size?: number;
} = {}) =>
  new File([new Uint8Array(size).fill(1)], "sample", {
    type: mimeType,
  });

describe("saveImageAttachment", () => {
  const originalTmpDir = process.env.TMPDIR;
  const cleanupTargets = new Set<string>();
  const restoreTmpDir = () => {
    if (typeof originalTmpDir === "string") {
      process.env.TMPDIR = originalTmpDir;
      return;
    }
    delete process.env.TMPDIR;
  };

  const makeTempDir = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vde-monitor-image-"));
    cleanupTargets.add(dir);
    return dir;
  };

  beforeEach(() => {
    restoreTmpDir();
  });

  afterEach(async () => {
    restoreTmpDir();
    await Promise.all(
      Array.from(cleanupTargets).map((target) => rm(target, { recursive: true, force: true })),
    );
    cleanupTargets.clear();
  });

  it("saves image to TMPDIR attachments path and returns insert text", async () => {
    const tmpRoot = await makeTempDir();
    process.env.TMPDIR = tmpRoot;

    const result = await saveImageAttachment({
      paneId: "pane:1",
      repoRoot: null,
      file: createImageFile(),
      now: new Date("2026-02-06T12:34:56.000Z"),
    });

    const realTmpRoot = await realpath(tmpRoot);
    expect(result.path.startsWith(path.join(realTmpRoot, "vde-monitor", "attachments"))).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.size).toBe(6);
    expect(result.insertText).toBe(`${result.path} `);
    expect(result.path.endsWith(".png")).toBe(true);
    const payload = await readFile(result.path);
    expect(payload.byteLength).toBe(6);
    const attachmentRootStat = await stat(path.join(realTmpRoot, "vde-monitor", "attachments"));
    const paneDirStat = await stat(path.dirname(result.path));
    const fileStat = await stat(result.path);
    expect(attachmentRootStat.mode & 0o777).toBe(0o700);
    expect(paneDirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("rejects unsupported MIME type", async () => {
    const tmpRoot = await makeTempDir();
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: null,
        file: createImageFile({ mimeType: "image/gif" }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });
  });

  it("rejects empty files", async () => {
    const tmpRoot = await makeTempDir();
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: null,
        file: createImageFile({ size: 0 }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });
  });

  it("rejects files larger than 10MB", async () => {
    const tmpRoot = await makeTempDir();
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: null,
        file: createImageFile({ size: IMAGE_ATTACHMENT_MAX_BYTES + 1 }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });
  });

  it("rejects when TMPDIR ancestor has .git directory and performs no writes", async () => {
    const root = await makeTempDir();
    const tmpRoot = path.join(root, "tmp");
    await mkdir(tmpRoot, { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: null,
        file: createImageFile(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });

    await expect(access(path.join(tmpRoot, "vde-monitor"))).rejects.toBeDefined();
  });

  it("rejects when TMPDIR ancestor has .git file(worktree) and performs no writes", async () => {
    const root = await makeTempDir();
    const tmpRoot = path.join(root, "tmp");
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(path.join(root, ".git"), "gitdir: /tmp/worktree");
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: null,
        file: createImageFile(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });

    await expect(access(path.join(tmpRoot, "vde-monitor"))).rejects.toBeDefined();
  });

  it("rejects symlink components on planned attachment root and performs no writes", async () => {
    const tmpRoot = await makeTempDir();
    const symlinkTarget = await makeTempDir();
    await symlink(symlinkTarget, path.join(tmpRoot, "vde-monitor"));
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: null,
        file: createImageFile(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });

    expect(await readdir(symlinkTarget)).toEqual([]);
  });

  it("rejects when resolved attachment path would be under repoRoot", async () => {
    const tmpRoot = await makeTempDir();
    process.env.TMPDIR = tmpRoot;

    await expect(
      saveImageAttachment({
        paneId: "pane-1",
        repoRoot: tmpRoot,
        file: createImageFile(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PAYLOAD",
    });
  });

  it("falls back to /tmp when TMPDIR is unset", async () => {
    process.env.TMPDIR = "";
    const paneId = `fallback-pane-${Date.now()}`;
    const result = await saveImageAttachment({
      paneId,
      repoRoot: null,
      file: createImageFile(),
    });

    const realTmp = await realpath("/tmp");
    expect(result.path.startsWith(path.join(realTmp, "vde-monitor", "attachments"))).toBe(true);
    expect(result.insertText).toBe(`${result.path} `);

    const paneDir = path.dirname(result.path);
    cleanupTargets.add(paneDir);
  });

  it("deletes files older than TTL while keeping current upload", async () => {
    const tmpRoot = await makeTempDir();
    process.env.TMPDIR = tmpRoot;
    const paneId = "pane-1";
    const paneDir = path.join(tmpRoot, "vde-monitor", "attachments", encodePaneId(paneId));
    await mkdir(paneDir, { recursive: true });
    const oldPath = path.join(paneDir, "old.png");
    await writeFile(oldPath, Buffer.from([1, 2, 3]));
    const oldDate = new Date("2026-02-05T08:00:00.000Z");
    await utimes(oldPath, oldDate, oldDate);

    const now = new Date("2026-02-06T12:00:00.000Z");
    const result = await saveImageAttachment({
      paneId,
      repoRoot: null,
      file: createImageFile(),
      now,
    });

    await expect(access(oldPath)).rejects.toBeDefined();
    const current = await stat(result.path);
    expect(current.size).toBe(6);
  });
});
