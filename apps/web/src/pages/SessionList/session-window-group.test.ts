import type { SessionSummary } from "@vde-monitor/shared";
import { describe, expect, it } from "vitest";

import { buildSessionWindowGroups } from "./session-window-group";

const buildSession = (overrides: Partial<SessionSummary>): SessionSummary => ({
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
  agent: "unknown",
  state: "UNKNOWN",
  stateReason: "no_signal",
  lastMessage: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: null,
  repoRoot: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
  ...overrides,
});

describe("buildSessionWindowGroups", () => {
  it("moves recently operated windows to the top within the same tmux session", () => {
    const groups = buildSessionWindowGroups([
      buildSession({
        paneId: "%1",
        sessionName: "alpha",
        windowIndex: 1,
        lastInputAt: "2026-02-07T10:00:00.000Z",
      }),
      buildSession({
        paneId: "%2",
        sessionName: "alpha",
        windowIndex: 2,
        lastInputAt: "2026-02-07T11:00:00.000Z",
      }),
      buildSession({
        paneId: "%3",
        sessionName: "beta",
        windowIndex: 3,
        lastInputAt: "2026-02-07T12:00:00.000Z",
      }),
    ]);

    expect(
      groups.filter((group) => group.sessionName === "alpha").map((group) => group.windowIndex),
    ).toEqual([2, 1]);
  });

  it("prioritizes pinned session, window, and pane in that order", () => {
    const groups = buildSessionWindowGroups(
      [
        buildSession({
          paneId: "%a1",
          sessionName: "alpha",
          windowIndex: 1,
          paneIndex: 0,
          lastInputAt: "2026-02-07T10:00:00.000Z",
        }),
        buildSession({
          paneId: "%a2",
          sessionName: "alpha",
          windowIndex: 1,
          paneIndex: 1,
          lastInputAt: "2026-02-07T09:00:00.000Z",
        }),
        buildSession({
          paneId: "%a3",
          sessionName: "alpha",
          windowIndex: 2,
          paneIndex: 0,
          lastInputAt: "2026-02-07T12:00:00.000Z",
        }),
        buildSession({
          paneId: "%b1",
          sessionName: "beta",
          windowIndex: 1,
          paneIndex: 0,
          lastInputAt: "2026-02-07T08:00:00.000Z",
        }),
      ],
      {
        isSessionPinned: (sessionName) => sessionName === "beta",
        isWindowPinned: (sessionName, windowIndex) => sessionName === "alpha" && windowIndex === 1,
        isPanePinned: (session) => session.paneId === "%a2",
      },
    );

    expect(groups[0]?.sessionName).toBe("beta");
    expect(groups.find((group) => group.sessionName === "alpha")?.windowIndex).toBe(1);
    expect(groups.find((group) => group.sessionName === "alpha")?.sessions[0]?.paneId).toBe("%a2");
  });
});
