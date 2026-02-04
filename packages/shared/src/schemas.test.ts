import { describe, expect, it } from "vitest";

import { defaultConfig } from "./constants.js";
import {
  claudeHookEventSchema,
  configSchema,
  screenResponseSchema,
  sessionStateSchema,
  wsClientMessageSchema,
  wsServerMessageSchema,
} from "./schemas.js";

describe("sessionStateSchema", () => {
  it("rejects DONE state", () => {
    const result = sessionStateSchema.safeParse("DONE");
    expect(result.success).toBe(false);
  });
});

describe("wsClientMessageSchema", () => {
  it("accepts send.keys with extended control keys", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "send.keys",
      ts: "2025-01-01T00:00:00Z",
      data: {
        paneId: "%1",
        keys: [
          "BTab",
          "C-a",
          "C-Tab",
          "C-BTab",
          "C-Left",
          "C-Right",
          "C-Up",
          "C-Down",
          "C-Enter",
          "C-Escape",
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts send.raw with text and key items", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "send.raw",
      ts: "2025-01-01T00:00:00Z",
      data: {
        paneId: "%1",
        items: [
          { kind: "text", value: "ls -la" },
          { kind: "key", value: "Enter" },
          { kind: "key", value: "C-d" },
        ],
        unsafe: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "send.keys",
      ts: "2025-01-01T00:00:00Z",
      data: {
        paneId: "%1",
        keys: ["Meta-Left"],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects messages missing required data", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "send.text",
      ts: "2025-01-01T00:00:00Z",
      data: { paneId: "%1" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts screen.request with mode and lines", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "screen.request",
      ts: "2025-01-01T00:00:00Z",
      data: { paneId: "%1", lines: 120, mode: "image" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts screen.request with cursor", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "screen.request",
      ts: "2025-01-01T00:00:00Z",
      data: { paneId: "%1", mode: "text", cursor: "cursor-1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects client.ping with extra fields", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "client.ping",
      ts: "2025-01-01T00:00:00Z",
      data: { extra: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects send.keys when keys are missing", () => {
    const result = wsClientMessageSchema.safeParse({
      type: "send.keys",
      ts: "2025-01-01T00:00:00Z",
      data: { paneId: "%1" },
    });
    expect(result.success).toBe(false);
  });
});

describe("screenResponseSchema", () => {
  it("accepts text response with screen content", () => {
    const result = screenResponseSchema.safeParse({
      ok: true,
      paneId: "%1",
      mode: "text",
      capturedAt: "2025-01-01T00:00:00Z",
      screen: "output",
    });
    expect(result.success).toBe(true);
  });

  it("accepts text response with deltas and cursor", () => {
    const result = screenResponseSchema.safeParse({
      ok: true,
      paneId: "%1",
      mode: "text",
      capturedAt: "2025-01-01T00:00:00Z",
      cursor: "cursor-2",
      full: false,
      deltas: [{ start: 1, deleteCount: 1, insertLines: ["next"] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts image response with imageBase64", () => {
    const result = screenResponseSchema.safeParse({
      ok: true,
      paneId: "%1",
      mode: "image",
      capturedAt: "2025-01-01T00:00:00Z",
      imageBase64: "abcd",
    });
    expect(result.success).toBe(true);
  });

  it("rejects response without required fields", () => {
    const result = screenResponseSchema.safeParse({
      ok: true,
      paneId: "%1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts error response with error payload", () => {
    const result = screenResponseSchema.safeParse({
      ok: false,
      paneId: "%1",
      mode: "text",
      capturedAt: "2025-01-01T00:00:00Z",
      error: { code: "INVALID_PANE", message: "bad pane" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects response with invalid mode", () => {
    const result = screenResponseSchema.safeParse({
      ok: true,
      paneId: "%1",
      mode: "video",
      capturedAt: "2025-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("wsServerMessageSchema", () => {
  it("accepts screen.response payloads", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "screen.response",
      ts: "2025-01-01T00:00:00Z",
      data: {
        ok: true,
        paneId: "%1",
        mode: "image",
        capturedAt: "2025-01-01T00:00:00Z",
        imageBase64: "abcd",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts session.updated payloads", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "session.updated",
      ts: "2025-01-01T00:00:00Z",
      data: {
        session: {
          paneId: "%1",
          sessionName: "main",
          windowIndex: 0,
          paneIndex: 0,
          windowActivity: null,
          paneActive: true,
          currentCommand: "zsh",
          currentPath: "/tmp",
          paneTty: "/dev/ttys001",
          title: "title",
          customTitle: null,
          repoRoot: "/tmp",
          agent: "codex",
          state: "RUNNING",
          stateReason: "recent_output",
          lastMessage: null,
          lastOutputAt: null,
          lastEventAt: null,
          lastInputAt: null,
          paneDead: false,
          alternateOn: false,
          pipeAttached: false,
          pipeConflict: false,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts sessions.snapshot payloads", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "sessions.snapshot",
      ts: "2025-01-01T00:00:00Z",
      data: {
        sessions: [
          {
            paneId: "%1",
            sessionName: "main",
            windowIndex: 0,
            paneIndex: 0,
            windowActivity: null,
            paneActive: false,
            currentCommand: null,
            currentPath: null,
            paneTty: null,
            title: null,
            customTitle: null,
            repoRoot: null,
            agent: "unknown",
            state: "UNKNOWN",
            stateReason: "no_signal",
            lastMessage: null,
            lastOutputAt: null,
            lastEventAt: null,
            lastInputAt: null,
            paneDead: false,
            alternateOn: false,
            pipeAttached: false,
            pipeConflict: false,
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts session.removed payloads", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "session.removed",
      ts: "2025-01-01T00:00:00Z",
      data: { paneId: "%9" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts server.health payloads", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "server.health",
      ts: "2025-01-01T00:00:00Z",
      data: { version: "0.0.1" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts server.health payloads with client config", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "server.health",
      ts: "2025-01-01T00:00:00Z",
      data: {
        version: "0.0.1",
        clientConfig: { screen: { highlightCorrection: { codex: false, claude: true } } },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts command.response payloads with error", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "command.response",
      ts: "2025-01-01T00:00:00Z",
      data: {
        ok: false,
        error: { code: "RATE_LIMIT", message: "slow down" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts command.response payloads without error", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "command.response",
      ts: "2025-01-01T00:00:00Z",
      data: { ok: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown message types", () => {
    const result = wsServerMessageSchema.safeParse({
      type: "unknown.event",
      ts: "2025-01-01T00:00:00Z",
      data: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("claudeHookEventSchema", () => {
  it("accepts minimal hook event", () => {
    const result = claudeHookEventSchema.safeParse({
      ts: "2025-01-01T00:00:00Z",
      hook_event_name: "Stop",
      session_id: "session",
      payload: { raw: "{}" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid hook_event_name", () => {
    const result = claudeHookEventSchema.safeParse({
      ts: "2025-01-01T00:00:00Z",
      hook_event_name: "Unknown",
      session_id: "session",
      payload: { raw: "{}" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts permission prompt event with tmux pane and fallback", () => {
    const result = claudeHookEventSchema.safeParse({
      ts: "2025-01-01T00:00:00Z",
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      session_id: "session",
      cwd: "/tmp",
      tty: "/dev/ttys001",
      tmux_pane: null,
      fallback: { cwd: "/tmp", transcript_path: "/tmp/log.jsonl" },
      payload: { raw: "{}" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid notification type", () => {
    const result = claudeHookEventSchema.safeParse({
      ts: "2025-01-01T00:00:00Z",
      hook_event_name: "Notification",
      notification_type: "other",
      session_id: "session",
      payload: { raw: "{}" },
    });
    expect(result.success).toBe(false);
  });
});

describe("configSchema", () => {
  it("fills default raw rate limit when missing", () => {
    const rateLimit: Partial<typeof defaultConfig.rateLimit> = { ...defaultConfig.rateLimit };
    delete rateLimit.raw;
    const result = configSchema.safeParse({ ...defaultConfig, rateLimit });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateLimit.raw).toEqual(defaultConfig.rateLimit.raw);
    }
  });

  it("accepts supported image backends", () => {
    const backends = ["alacritty", "terminal", "iterm", "wezterm", "ghostty"] as const;
    for (const backend of backends) {
      const result = configSchema.safeParse({
        ...defaultConfig,
        screen: {
          ...defaultConfig.screen,
          image: { ...defaultConfig.screen.image, backend },
        },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unsupported image backend", () => {
    const result = configSchema.safeParse({
      ...defaultConfig,
      screen: {
        ...defaultConfig.screen,
        image: { ...defaultConfig.screen.image, backend: "kitty" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects auto image backend", () => {
    const result = configSchema.safeParse({
      ...defaultConfig,
      screen: {
        ...defaultConfig.screen,
        image: { ...defaultConfig.screen.image, backend: "auto" },
      },
    });
    expect(result.success).toBe(false);
  });
});
