import type { SessionSummary } from "@tmux-agent-monitor/shared";
import { describe, expect, it } from "vitest";

import { buildSessionGroups } from "./session-group";

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

describe("buildSessionGroups", () => {
  it("sorts groups by latest lastInputAt desc and puts no-repo last", () => {
    const sessions = [
      buildSession({
        paneId: "%1",
        repoRoot: "/repo/a",
        lastInputAt: "2026-02-01T00:00:00Z",
      }),
      buildSession({
        paneId: "%2",
        repoRoot: "/repo/b",
        lastInputAt: "2026-02-01T01:00:00Z",
      }),
      buildSession({
        paneId: "%3",
        repoRoot: "/repo/a",
        lastInputAt: null,
      }),
      buildSession({
        paneId: "%4",
        repoRoot: null,
        lastInputAt: null,
      }),
    ];

    const groups = buildSessionGroups(sessions);

    expect(groups.map((group) => group.repoRoot)).toEqual(["/repo/b", "/repo/a", null]);
  });

  it("sorts sessions within a group by lastInputAt then lastOutputAt desc", () => {
    const sessions = [
      buildSession({
        paneId: "%1",
        repoRoot: "/repo/a",
        lastInputAt: "2026-02-01T00:00:00Z",
        lastOutputAt: "2026-02-01T00:05:00Z",
      }),
      buildSession({
        paneId: "%2",
        repoRoot: "/repo/a",
        lastInputAt: "2026-02-01T00:00:00Z",
        lastOutputAt: "2026-02-01T00:10:00Z",
      }),
      buildSession({
        paneId: "%3",
        repoRoot: "/repo/a",
        lastInputAt: null,
        lastOutputAt: "2026-02-01T00:20:00Z",
      }),
    ];

    const groups = buildSessionGroups(sessions);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions.map((session) => session.paneId)).toEqual(["%2", "%1", "%3"]);
  });
});
