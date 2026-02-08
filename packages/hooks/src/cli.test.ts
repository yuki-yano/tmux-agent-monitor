import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHookEvent,
  extractPayloadFields,
  resolveHookServerKey,
  resolveTranscriptPath,
} from "./cli";

describe("hooks cli helpers", () => {
  it("resolves transcript path from cwd and session id", () => {
    const transcriptPath = resolveTranscriptPath("apps/web", "session-1");
    expect(transcriptPath).toBe(
      path.join(os.homedir(), ".claude", "projects", "apps-web", "session-1.jsonl"),
    );
  });

  it("extracts payload fields with tmux fallback from env", () => {
    const fields = extractPayloadFields(
      {
        session_id: "session-1",
        cwd: "apps/web",
        notification_type: "idle",
      },
      { TMUX_PANE: "%42" },
    );

    expect(fields.sessionId).toBe("session-1");
    expect(fields.cwd).toBe("apps/web");
    expect(fields.tmuxPane).toBe("%42");
    expect(fields.transcriptPath).toContain(path.join(".claude", "projects", "apps-web"));
  });

  it("includes fallback payload when tmux pane is missing", () => {
    const event = buildHookEvent("PostToolUse", "{}", {
      sessionId: "session-1",
      cwd: "apps/web",
      tmuxPane: null,
      transcriptPath: "/tmp/session-1.jsonl",
    });

    expect(event.fallback).toEqual({
      cwd: "apps/web",
      transcript_path: "/tmp/session-1.jsonl",
    });
  });

  it("resolves tmux server key from config", () => {
    expect(
      resolveHookServerKey({
        multiplexerBackend: "tmux",
        tmuxSocketName: "my/socket",
        tmuxSocketPath: "/tmp/tmux.sock",
        weztermTarget: "dev",
      }),
    ).toBe("my_socket");
  });

  it("resolves wezterm server key from config", () => {
    expect(
      resolveHookServerKey({
        multiplexerBackend: "wezterm",
        tmuxSocketName: "my/socket",
        tmuxSocketPath: "/tmp/tmux.sock",
        weztermTarget: " dev ",
      }),
    ).toBe("wezterm-dev");
  });
});
