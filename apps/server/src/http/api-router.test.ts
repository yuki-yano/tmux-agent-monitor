import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type AgentMonitorConfig, defaultConfig, type SessionDetail } from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCommitDetail, fetchCommitFile, fetchCommitLog } from "../git-commits.js";
import { fetchDiffSummary } from "../git-diff.js";
import type { createSessionMonitor } from "../monitor.js";
import type { MultiplexerInputActions } from "../multiplexer/types.js";
import { createSessionRegistry } from "../session-registry.js";
import { createApiRouter } from "./api-router.js";
import {
  IMAGE_ATTACHMENT_MAX_BYTES,
  IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES,
} from "./image-attachment.js";

vi.mock("../git-diff.js", () => ({
  fetchDiffSummary: vi.fn(),
  fetchDiffFile: vi.fn(),
}));

vi.mock("../git-commits.js", () => ({
  fetchCommitLog: vi.fn(),
  fetchCommitDetail: vi.fn(),
  fetchCommitFile: vi.fn(),
}));

type Monitor = ReturnType<typeof createSessionMonitor>;

const createSessionDetail = (overrides: Partial<SessionDetail> = {}): SessionDetail => ({
  paneId: "pane-1",
  sessionName: "session",
  windowIndex: 0,
  paneIndex: 0,
  windowActivity: null,
  paneActive: true,
  currentCommand: null,
  currentPath: "/tmp",
  paneTty: "tty1",
  title: null,
  customTitle: null,
  repoRoot: null,
  agent: "codex",
  state: "RUNNING",
  stateReason: "reason",
  lastMessage: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
  startCommand: null,
  panePid: null,
  ...overrides,
});

const createTestContext = (configOverrides: Partial<AgentMonitorConfig> = {}) => {
  const config: AgentMonitorConfig = { ...defaultConfig, token: "token", ...configOverrides };
  const registry = createSessionRegistry();
  const detail = createSessionDetail();
  registry.update(detail);
  const captureText = vi.fn(async () => ({
    screen: "hello",
    alternateOn: false,
    truncated: null,
  }));
  const getStateTimeline = vi.fn(() => ({
    paneId: detail.paneId,
    now: new Date(0).toISOString(),
    range: "1h",
    items: [],
    totalsMs: {
      RUNNING: 0,
      WAITING_INPUT: 0,
      WAITING_PERMISSION: 0,
      SHELL: 0,
      UNKNOWN: 0,
    },
    current: null,
  }));
  const monitor = {
    registry,
    getScreenCapture: () => ({ captureText }),
    getStateTimeline,
    setCustomTitle: vi.fn((paneId: string, title: string | null) => {
      const existing = registry.getDetail(paneId);
      if (!existing) return;
      registry.update({ ...existing, customTitle: title });
    }),
    recordInput: vi.fn(),
  } as unknown as Monitor;
  const actions = {
    sendText: vi.fn(async () => ({ ok: true })),
    sendKeys: vi.fn(async () => ({ ok: true })),
    sendRaw: vi.fn(async () => ({ ok: true })),
    focusPane: vi.fn(async () => ({ ok: true as const })),
  } as unknown as MultiplexerInputActions;
  const api = createApiRouter({ config, monitor, actions });
  return { api, config, monitor, actions, detail, getStateTimeline };
};

const authHeaders = {
  Authorization: "Bearer token",
};

const createMultipartImagePayload = ({
  fieldName = "image",
  fileName = "sample.png",
  mimeType = "image/png",
  content = "png-data",
  boundary = "----vde-monitor-test-boundary",
}: {
  fieldName?: string;
  fileName?: string;
  mimeType?: string;
  content?: string;
  boundary?: string;
} = {}) => {
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return {
    body,
    boundary,
    byteLength: Buffer.byteLength(body),
  };
};

describe("createApiRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without auth", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions");
    expect(res.status).toBe(401);
  });

  it("rejects requests with disallowed origin", async () => {
    const { api } = createTestContext({ allowedOrigins: ["https://allowed.example"] });
    const res = await api.request("/sessions", {
      headers: { ...authHeaders, origin: "https://bad.example" },
    });
    expect(res.status).toBe(403);
  });

  it("returns sessions snapshot and mirrors request id", async () => {
    const { api, config } = createTestContext();
    const res = await api.request("/sessions", {
      headers: { ...authHeaders, "x-request-id": "req-1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Request-Id")).toBe("req-1");
    const data = await res.json();
    expect(data.sessions.length).toBe(1);
    expect(data.clientConfig.screen.highlightCorrection).toEqual(config.screen.highlightCorrection);
  });

  it("returns 404 when session is missing", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions/missing", { headers: authHeaders });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PANE");
  });

  it("returns timeline for a pane", async () => {
    const { api, getStateTimeline } = createTestContext();
    const res = await api.request("/sessions/pane-1/timeline?range=15m&limit=50", {
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    expect(getStateTimeline).toHaveBeenCalledWith("pane-1", "15m", 50);
    const data = await res.json();
    expect(data.timeline.paneId).toBe("pane-1");
  });

  it("returns rate limit error on repeated screen requests", async () => {
    const { api } = createTestContext({
      rateLimit: { ...defaultConfig.rateLimit, screen: { windowMs: 1000, max: 1 } },
    });
    const payload = JSON.stringify({ mode: "text", lines: 5 });
    const headers = { ...authHeaders, "content-type": "application/json" };
    const first = await api.request("/sessions/pane-1/screen", {
      method: "POST",
      headers,
      body: payload,
    });
    const second = await api.request("/sessions/pane-1/screen", {
      method: "POST",
      headers,
      body: payload,
    });
    const firstData = await first.json();
    const secondData = await second.json();
    expect(firstData.screen.ok).toBe(true);
    expect(secondData.screen.ok).toBe(false);
    expect(secondData.screen.error.code).toBe("RATE_LIMIT");
  });

  it("sends text command", async () => {
    const { api, actions } = createTestContext();
    const res = await api.request("/sessions/pane-1/send/text", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ text: "ls", enter: true }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.command.ok).toBe(true);
    expect(actions.sendText).toHaveBeenCalledWith("pane-1", "ls", true);
  });

  it("focuses pane via focus endpoint", async () => {
    const { api, actions } = createTestContext();
    const res = await api.request("/sessions/pane-1/focus", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.command.ok).toBe(true);
    expect(actions.focusPane).toHaveBeenCalledWith("pane-1");
  });

  it("focuses pane for wezterm backend as well", async () => {
    const { api } = createTestContext({
      multiplexer: {
        ...defaultConfig.multiplexer,
        backend: "wezterm",
      },
    });
    const res = await api.request("/sessions/pane-1/focus", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.command.ok).toBe(true);
  });

  it("returns rate limit error on repeated focus requests", async () => {
    const { api, actions } = createTestContext({
      rateLimit: { ...defaultConfig.rateLimit, send: { windowMs: 1000, max: 1 } },
    });
    const first = await api.request("/sessions/pane-1/focus", {
      method: "POST",
      headers: authHeaders,
    });
    const second = await api.request("/sessions/pane-1/focus", {
      method: "POST",
      headers: authHeaders,
    });

    const firstData = await first.json();
    const secondData = await second.json();
    expect(firstData.command.ok).toBe(true);
    expect(secondData.command.ok).toBe(false);
    expect(secondData.command.error.code).toBe("RATE_LIMIT");
    expect(actions.focusPane).toHaveBeenCalledTimes(1);
  });

  it("returns focus command errors from actions", async () => {
    const { api, actions } = createTestContext();
    vi.mocked(actions.focusPane).mockResolvedValueOnce({
      ok: false,
      error: { code: "TMUX_UNAVAILABLE", message: "Terminal is not running" },
    });

    const res = await api.request("/sessions/pane-1/focus", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.command.ok).toBe(false);
    expect(data.command.error.code).toBe("TMUX_UNAVAILABLE");
  });

  it("updates custom title", async () => {
    const { api, monitor } = createTestContext();
    const res = await api.request("/sessions/pane-1/title", {
      method: "PUT",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ title: "new title" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.customTitle).toBe("new title");
    expect(monitor.setCustomTitle).toHaveBeenCalledWith("pane-1", "new title");
  });

  it("touch updates session activity", async () => {
    const { api, monitor } = createTestContext();
    const res = await api.request("/sessions/pane-1/touch", {
      method: "POST",
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(monitor.recordInput).toHaveBeenCalledWith("pane-1");
  });

  it("returns 404 when pane is missing on diff endpoint", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions/missing/diff", {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PANE");
  });

  it("returns 404 when pane is missing on focus endpoint", async () => {
    const { api, actions } = createTestContext();
    const res = await api.request("/sessions/missing/focus", {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PANE");
    expect(actions.focusPane).not.toHaveBeenCalled();
  });

  it("returns 400 when diff summary is unavailable", async () => {
    vi.mocked(fetchDiffSummary).mockResolvedValueOnce({
      repoRoot: null,
      rev: null,
      generatedAt: new Date(0).toISOString(),
      files: [],
      reason: "not_git",
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/diff/file?path=README.md", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when commit log is unavailable", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValueOnce({
      repoRoot: null,
      rev: null,
      generatedAt: new Date(0).toISOString(),
      commits: [],
      reason: "not_git",
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/commits/hash", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("uses force=false by default on commit detail endpoint", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValueOnce({
      repoRoot: "/tmp",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
    });
    vi.mocked(fetchCommitDetail).mockResolvedValueOnce({
      hash: "hash",
      shortHash: "hash",
      subject: "subject",
      body: null,
      authorName: "tester",
      authorEmail: "tester@example.com",
      authoredAt: new Date(0).toISOString(),
      files: [],
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/commits/hash", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(fetchCommitDetail).toHaveBeenCalledWith("/tmp", "hash", { force: false });
  });

  it("uses force flag from query on commit file endpoint", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValue({
      repoRoot: "/tmp",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
    });
    vi.mocked(fetchCommitDetail).mockResolvedValue({
      hash: "hash",
      shortHash: "hash",
      subject: "subject",
      body: null,
      authorName: "tester",
      authorEmail: "tester@example.com",
      authoredAt: new Date(0).toISOString(),
      files: [
        {
          path: "src/index.ts",
          status: "M",
          additions: 1,
          deletions: 0,
        },
      ],
    });
    vi.mocked(fetchCommitFile).mockResolvedValue({
      path: "src/index.ts",
      status: "M",
      patch: "+line",
      binary: false,
      truncated: false,
    });

    const { api } = createTestContext();
    const first = await api.request("/sessions/pane-1/commits/hash/file?path=src/index.ts", {
      headers: authHeaders,
    });
    expect(first.status).toBe(200);
    expect(fetchCommitFile).toHaveBeenLastCalledWith(
      "/tmp",
      "hash",
      expect.objectContaining({ path: "src/index.ts" }),
      { force: false },
    );

    const second = await api.request(
      "/sessions/pane-1/commits/hash/file?path=src/index.ts&force=1",
      {
        headers: authHeaders,
      },
    );
    expect(second.status).toBe(200);
    expect(fetchCommitFile).toHaveBeenLastCalledWith(
      "/tmp",
      "hash",
      expect.objectContaining({ path: "src/index.ts" }),
      { force: true },
    );
  });

  it("returns 400 when commit log is unavailable on commit file endpoint", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValueOnce({
      repoRoot: null,
      rev: null,
      generatedAt: new Date(0).toISOString(),
      commits: [],
      reason: "not_git",
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/commits/hash/file?path=README.md", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
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
        "x-content-length": "abc",
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
        "x-content-length": String(IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES + 1),
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
        "x-content-length": "128",
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
          "x-content-length": "128",
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
          "x-content-length": String(simulatedContentLength),
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
