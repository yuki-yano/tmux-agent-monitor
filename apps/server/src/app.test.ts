// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import { rotateToken } from "./config";
import {
  authHeaders,
  createTestContext,
  createTestStreamDeps,
} from "./http/api-router.test-helpers";

vi.mock("./config", () => ({
  rotateToken: vi.fn(() => ({ token: "rotated-token" })),
}));

const execFileAsync = promisify(execFile);

const createAppUnderTest = () => {
  const context = createTestContext();
  const streamDeps = createTestStreamDeps();
  const { app, previewTicketService } = createApp({
    config: context.config,
    monitor: context.monitor,
    actions: context.actions,
    launchCapability: context.launchCapability,
    notificationService: context.notificationService,
    ...streamDeps,
  });
  return { app, previewTicketService, ...context, ...streamDeps };
};

describe("createApp /api/admin/token/rotate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects token rotation without auth", async () => {
    const { app } = createAppUnderTest();

    const res = await app.request("/api/admin/token/rotate", { method: "POST" });

    expect(res.status).toBe(401);
    expect(rotateToken).not.toHaveBeenCalled();
  });

  it("rotates the token and revokes push subscriptions with valid auth", async () => {
    const { app, config, notificationService } = createAppUnderTest();

    const res = await app.request("/api/admin/token/rotate", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "rotated-token" });
    expect(config.token).toBe("rotated-token");
    expect(notificationService.removeAllSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("keeps revocable runtime state when token persistence fails", async () => {
    const { app, config, notificationService, previewTicketService, streamConnections } =
      createAppUnderTest();
    const revokeTickets = vi.spyOn(previewTicketService, "revokeAll");
    vi.mocked(rotateToken).mockImplementationOnce(() => {
      throw new Error("token persistence failed");
    });

    const res = await app.request("/api/admin/token/rotate", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(500);
    expect(config.token).toBe("token");
    expect(notificationService.removeAllSubscriptions).not.toHaveBeenCalled();
    expect(streamConnections.closeAll).not.toHaveBeenCalled();
    expect(revokeTickets).not.toHaveBeenCalled();
  });

  it("returns the committed token and attempts every cleanup when cleanup operations fail", async () => {
    const { app, config, notificationService, previewTicketService, streamConnections } =
      createAppUnderTest();
    const revokeTickets = vi.spyOn(previewTicketService, "revokeAll");
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(notificationService.removeAllSubscriptions).mockImplementationOnce(() => {
      throw new Error("subscription cleanup failed");
    });
    vi.mocked(streamConnections.closeAll).mockImplementationOnce(() => {
      throw new Error("stream cleanup failed");
    });
    revokeTickets.mockImplementationOnce(() => {
      throw new Error("ticket cleanup failed");
    });

    const res = await app.request("/api/admin/token/rotate", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(207);
    expect(await res.json()).toEqual({
      token: "rotated-token",
      cleanupFailures: ["push-subscriptions", "streams", "preview-tickets"],
    });
    expect(config.token).toBe("rotated-token");
    expect(rotateToken).toHaveBeenCalledOnce();
    expect(notificationService.removeAllSubscriptions).toHaveBeenCalledOnce();
    expect(streamConnections.closeAll).toHaveBeenCalledOnce();
    expect(revokeTickets).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledTimes(3);
  });

  it("invalidates the previous token after rotation", async () => {
    const { app } = createAppUnderTest();

    await app.request("/api/admin/token/rotate", {
      method: "POST",
      headers: authHeaders,
    });

    const oldTokenRes = await app.request("/api/sessions", { headers: authHeaders });
    expect(oldTokenRes.status).toBe(401);

    const newTokenRes = await app.request("/api/sessions", {
      headers: { Authorization: "Bearer rotated-token" },
    });
    expect(newTokenRes.status).toBe(200);
  });

  it("serves file previews without auth and supports explicit and rotation revocation", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vde-monitor-app-preview-"));
    try {
      const image = Buffer.alloc(300 * 1024, 0x7f);
      await fs.writeFile(path.join(repoRoot, "large.png"), image);
      const { app, monitor, detail } = createAppUnderTest();
      monitor.registry.update({ ...detail, repoRoot, currentPath: repoRoot });

      const contentResponse = await app.request(
        "/api/sessions/pane-1/files/content?path=large.png",
        { headers: authHeaders },
      );
      expect(contentResponse.status).toBe(200);
      const content = await contentResponse.json();
      const previewPath = content.file.preview.url;
      expect(previewPath).toMatch(/^\/file-preview\//);

      const previewResponse = await app.request(previewPath);
      expect(previewResponse.status).toBe(200);
      expect(Buffer.from(await previewResponse.arrayBuffer())).toEqual(image);

      const revokeResponse = await app.request(
        `/api/sessions/pane-already-removed/files/preview/${content.file.preview.token}`,
        { method: "DELETE", headers: authHeaders },
      );
      expect(revokeResponse.status).toBe(204);
      expect((await app.request(previewPath)).status).toBe(404);

      const rotatedContentResponse = await app.request(
        "/api/sessions/pane-1/files/content?path=large.png",
        { headers: authHeaders },
      );
      const rotatedContent = await rotatedContentResponse.json();
      const rotatedPreviewPath = rotatedContent.file.preview.url;
      expect(rotatedPreviewPath).toMatch(/^\/file-preview\//);
      expect((await app.request(rotatedPreviewPath)).status).toBe(200);

      await app.request("/api/admin/token/rotate", {
        method: "POST",
        headers: authHeaders,
      });
      expect((await app.request(rotatedPreviewPath)).status).toBe(404);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("serves previews from a registered worktree mounted under .git/wt", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vde-monitor-app-worktree-"));
    try {
      await execFileAsync("git", ["init", "--quiet", repoRoot]);
      await fs.writeFile(path.join(repoRoot, "README.md"), "# main\n");
      await execFileAsync("git", ["-C", repoRoot, "add", "README.md"]);
      await execFileAsync("git", [
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
      const worktreeRoot = path.join(repoRoot, ".git", "wt", "preview");
      await execFileAsync("git", [
        "-C",
        repoRoot,
        "worktree",
        "add",
        "-b",
        "preview",
        worktreeRoot,
      ]);
      const image = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+Zl8AAAAASUVORK5CYII=",
        "base64",
      );
      await fs.writeFile(path.join(worktreeRoot, "pixel.png"), image);

      const { app, monitor, detail } = createAppUnderTest();
      monitor.registry.update({
        ...detail,
        repoRoot,
        currentPath: repoRoot,
        worktreePath: repoRoot,
      });

      const contentResponse = await app.request(
        "/api/sessions/pane-1/files/content?path=.git%2Fwt%2Fpreview%2Fpixel.png",
        { headers: authHeaders },
      );
      expect(contentResponse.status).toBe(200);
      const content = await contentResponse.json();
      const previewResponse = await app.request(content.file.preview.url);

      expect(previewResponse.status).toBe(200);
      expect(Buffer.from(await previewResponse.arrayBuffer())).toEqual(image);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
