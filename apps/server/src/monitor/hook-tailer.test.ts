import { describe, expect, it, vi } from "vitest";

import { handleHookLine } from "./hook-tailer.js";

describe("handleHookLine", () => {
  const panes = [
    { paneId: "1", paneTty: "tty1", currentPath: "/tmp" },
    { paneId: "2", paneTty: "tty2", currentPath: "/var" },
  ];

  it("ignores invalid json", () => {
    const onHook = vi.fn();
    const result = handleHookLine("{", panes, onHook);
    expect(result).toBe(false);
    expect(onHook).not.toHaveBeenCalled();
  });

  it("ignores events without matching hook state", () => {
    const onHook = vi.fn();
    const event = {
      ts: "2024-01-01T00:00:00.000Z",
      hook_event_name: "Notification",
      session_id: "s1",
      payload: { raw: "" },
    };
    const result = handleHookLine(JSON.stringify(event), panes, onHook);
    expect(result).toBe(false);
    expect(onHook).not.toHaveBeenCalled();
  });

  it("dispatches hook event when pane matches", () => {
    const onHook = vi.fn();
    const event = {
      ts: "2024-01-01T00:00:00.000Z",
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tmux_pane: "2",
      payload: { raw: "" },
    };
    const result = handleHookLine(JSON.stringify(event), panes, onHook);
    expect(result).toBe(true);
    expect(onHook).toHaveBeenCalledWith({
      paneId: "2",
      hookState: { state: "RUNNING", reason: "hook:PreToolUse", at: event.ts },
    });
  });

  it("falls back to tty matching", () => {
    const onHook = vi.fn();
    const event = {
      ts: "2024-01-01T00:00:00.000Z",
      hook_event_name: "Stop",
      session_id: "s1",
      tty: "tty1",
      payload: { raw: "" },
    };
    const result = handleHookLine(JSON.stringify(event), panes, onHook);
    expect(result).toBe(true);
    expect(onHook).toHaveBeenCalledWith({
      paneId: "1",
      hookState: { state: "WAITING_INPUT", reason: "hook:stop", at: event.ts },
    });
  });
});
