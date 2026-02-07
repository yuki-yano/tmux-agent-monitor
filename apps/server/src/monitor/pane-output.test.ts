import { describe, expect, it, vi } from "vitest";

import { updatePaneOutputState } from "./pane-output.js";
import type { PaneRuntimeState } from "./pane-state.js";

describe("updatePaneOutputState", () => {
  const basePane = {
    paneId: "1",
    paneActivity: null,
    windowActivity: null,
    paneActive: false,
    paneDead: false,
    alternateOn: false,
  };

  const createState = (overrides: Partial<PaneRuntimeState> = {}): PaneRuntimeState => ({
    hookState: null,
    lastOutputAt: null,
    lastEventAt: null,
    lastMessage: null,
    lastInputAt: null,
    lastFingerprint: null,
    ...overrides,
  });

  it("updates output timestamp from log mtime and clears stale hook state", async () => {
    const state = createState({
      hookState: { state: "RUNNING", reason: "hook:test", at: "2024-01-01T00:00:00.000Z" },
    });
    const result = await updatePaneOutputState({
      pane: basePane,
      paneState: state,
      logPath: "/tmp/log",
      inactiveThresholdMs: 1000,
      deps: {
        statLogMtime: async () => "2024-01-02T00:00:00.000Z",
        resolveActivityAt: () => null,
        captureFingerprint: async () => null,
        now: () => new Date("2024-01-03T00:00:00.000Z"),
      },
    });

    expect(result.outputAt).toBe("2024-01-02T00:00:00.000Z");
    expect(result.hookState).toBeNull();
    expect(state.hookState).toBeNull();
  });

  it("keeps waiting hook state even when output advances", async () => {
    const state = createState({
      hookState: { state: "WAITING_INPUT", reason: "hook:stop", at: "2024-01-01T00:00:00.000Z" },
    });
    const result = await updatePaneOutputState({
      pane: basePane,
      paneState: state,
      logPath: "/tmp/log",
      inactiveThresholdMs: 1000,
      deps: {
        statLogMtime: async () => "2024-01-02T00:00:00.000Z",
        resolveActivityAt: () => null,
        captureFingerprint: async () => null,
        now: () => new Date("2024-01-03T00:00:00.000Z"),
      },
    });

    expect(result.outputAt).toBe("2024-01-02T00:00:00.000Z");
    expect(result.hookState).toEqual({
      state: "WAITING_INPUT",
      reason: "hook:stop",
      at: "2024-01-01T00:00:00.000Z",
    });
  });

  it("keeps waiting-permission hook state when output advances", async () => {
    const state = createState({
      hookState: {
        state: "WAITING_PERMISSION",
        reason: "hook:approval",
        at: "2024-01-01T00:00:00.000Z",
      },
    });
    const result = await updatePaneOutputState({
      pane: basePane,
      paneState: state,
      logPath: "/tmp/log",
      inactiveThresholdMs: 1000,
      deps: {
        statLogMtime: async () => "2024-01-02T00:00:00.000Z",
        resolveActivityAt: () => null,
        captureFingerprint: async () => null,
        now: () => new Date("2024-01-03T00:00:00.000Z"),
      },
    });

    expect(result.outputAt).toBe("2024-01-02T00:00:00.000Z");
    expect(result.hookState).toEqual({
      state: "WAITING_PERMISSION",
      reason: "hook:approval",
      at: "2024-01-01T00:00:00.000Z",
    });
  });

  it("uses fallback timestamp when no activity is available", async () => {
    const state = createState();
    const now = new Date("2024-01-03T00:00:10.000Z");
    const result = await updatePaneOutputState({
      pane: basePane,
      paneState: state,
      logPath: "/tmp/log",
      inactiveThresholdMs: 5000,
      deps: {
        statLogMtime: async () => null,
        resolveActivityAt: () => null,
        captureFingerprint: async () => null,
        now: () => now,
      },
    });

    const expected = new Date(now.getTime() - 5000 - 1000).toISOString();
    expect(result.outputAt).toBe(expected);
  });

  it("updates output timestamp when fingerprint changes", async () => {
    const state = createState({ lastFingerprint: "old" });
    const now = new Date("2024-01-03T00:00:00.000Z");
    const result = await updatePaneOutputState({
      pane: basePane,
      paneState: state,
      logPath: "/tmp/log",
      inactiveThresholdMs: 1000,
      deps: {
        statLogMtime: async () => null,
        resolveActivityAt: () => null,
        captureFingerprint: async () => "new",
        now: () => now,
      },
    });

    expect(state.lastFingerprint).toBe("new");
    expect(result.outputAt).toBe(now.toISOString());
  });

  it("skips log mtime lookup when logPath is null", async () => {
    const state = createState({ lastFingerprint: "old" });
    const statLogMtime = async () => "2024-01-02T00:00:00.000Z";
    const statSpy = vi.fn(statLogMtime);
    const now = new Date("2024-01-03T00:00:00.000Z");

    const result = await updatePaneOutputState({
      pane: basePane,
      paneState: state,
      logPath: null,
      inactiveThresholdMs: 1000,
      deps: {
        statLogMtime: statSpy,
        resolveActivityAt: () => null,
        captureFingerprint: async () => "new",
        now: () => now,
      },
    });

    expect(statSpy).not.toHaveBeenCalled();
    expect(result.outputAt).toBe(now.toISOString());
  });
});
