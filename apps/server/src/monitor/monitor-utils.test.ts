import { describe, expect, it } from "vitest";

import {
  buildDefaultTitle,
  deriveHookState,
  hostCandidates,
  mapHookToPane,
  normalizeFingerprint,
  normalizeTitle,
} from "./monitor-utils.js";

describe("monitor-utils", () => {
  it("normalizes fingerprints and limits lines", () => {
    const input = "a  \n b  \n c  \n";
    expect(normalizeFingerprint(input, 2)).toBe(" b\n c");
  });

  it("normalizes titles", () => {
    expect(normalizeTitle("  hello  ")).toBe("hello");
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle(null)).toBeNull();
  });

  it("builds default titles from path or session name", () => {
    expect(buildDefaultTitle("/Users/test/project", "1", "main", 2)).toBe("project:w2:1");
    expect(buildDefaultTitle(null, "2", "dev", 0)).toBe("dev:w0:2");
  });

  it("derives hook state from events", () => {
    expect(deriveHookState("Notification", "permission_prompt")).toEqual({
      state: "WAITING_PERMISSION",
      reason: "hook:permission_prompt",
    });
    expect(deriveHookState("Stop")).toEqual({ state: "WAITING_INPUT", reason: "hook:stop" });
    expect(deriveHookState("PreToolUse")).toEqual({ state: "RUNNING", reason: "hook:PreToolUse" });
    expect(deriveHookState("UnknownEvent")).toBeNull();
  });

  it("maps hook to pane by tmux pane id first", () => {
    const panes = [{ paneId: "1", paneTty: "tty1", currentPath: "/tmp" }];
    expect(mapHookToPane(panes, { tmux_pane: "1" })).toBe("1");
  });

  it("maps hook to pane by tty when unique", () => {
    const panes = [
      { paneId: "1", paneTty: "tty1", currentPath: "/tmp" },
      { paneId: "2", paneTty: "tty2", currentPath: "/var" },
    ];
    expect(mapHookToPane(panes, { tty: "tty2" })).toBe("2");
  });

  it("returns null when tty matches multiple panes", () => {
    const panes = [
      { paneId: "1", paneTty: "tty1", currentPath: "/tmp" },
      { paneId: "2", paneTty: "tty1", currentPath: "/var" },
    ];
    expect(mapHookToPane(panes, { tty: "tty1" })).toBeNull();
  });

  it("maps hook to pane by cwd when unique", () => {
    const panes = [
      { paneId: "1", paneTty: "tty1", currentPath: "/tmp" },
      { paneId: "2", paneTty: "tty2", currentPath: "/var" },
    ];
    expect(mapHookToPane(panes, { cwd: "/var" })).toBe("2");
  });

  it("exposes host candidates", () => {
    expect(hostCandidates.size).toBeGreaterThan(0);
  });
});
