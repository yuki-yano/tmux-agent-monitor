import { describe, expect, it } from "vitest";

import { buildSessionDetail, type PaneSnapshot } from "./session-detail.js";

const buildPane = (overrides: Partial<PaneSnapshot> = {}): PaneSnapshot => ({
  paneId: "1",
  sessionName: "main",
  windowIndex: 0,
  paneIndex: 1,
  windowActivity: null,
  paneActive: true,
  currentCommand: "bash",
  currentPath: "/Users/test/project",
  paneTty: "/dev/ttys001",
  paneTitle: null,
  paneStartCommand: "bash",
  panePid: 123,
  paneDead: false,
  alternateOn: false,
  ...overrides,
});

describe("buildSessionDetail", () => {
  it("uses pane title when available and not host", () => {
    const pane = buildPane({ paneTitle: "MyPane" });
    const detail = buildSessionDetail({
      pane,
      agent: "codex",
      state: "RUNNING",
      stateReason: "test",
      lastMessage: null,
      lastOutputAt: null,
      lastEventAt: null,
      lastInputAt: null,
      pipeAttached: true,
      pipeConflict: false,
      customTitle: null,
      repoRoot: "/Users/test/project",
    });
    expect(detail.title).toBe("MyPane");
  });

  it("falls back to default title when pane title is absent", () => {
    const pane = buildPane({ paneTitle: null });
    const detail = buildSessionDetail({
      pane,
      agent: "claude",
      state: "WAITING_INPUT",
      stateReason: "test",
      lastMessage: null,
      lastOutputAt: null,
      lastEventAt: null,
      lastInputAt: null,
      pipeAttached: false,
      pipeConflict: false,
      customTitle: "Custom",
      repoRoot: null,
    });
    expect(detail.title).toBe("project:w0:1");
    expect(detail.customTitle).toBe("Custom");
  });

  it("builds default title from session name when path is missing", () => {
    const pane = buildPane({ currentPath: null, paneTitle: null });
    const detail = buildSessionDetail({
      pane,
      agent: "unknown",
      state: "UNKNOWN",
      stateReason: "test",
      lastMessage: "msg",
      lastOutputAt: "2024-01-01T00:00:00.000Z",
      lastEventAt: "2024-01-01T00:00:00.000Z",
      lastInputAt: null,
      pipeAttached: false,
      pipeConflict: true,
      customTitle: null,
      repoRoot: null,
    });
    expect(detail.title).toBe("main:w0:1");
    expect(detail.pipeConflict).toBe(true);
    expect(detail.lastMessage).toBe("msg");
  });
});
