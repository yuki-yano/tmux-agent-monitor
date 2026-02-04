import { estimateState } from "@vde-monitor/agents";
import { describe, expect, it } from "vitest";

import { estimateSessionState } from "./session-state.js";

describe("estimateSessionState", () => {
  it("caps codex running threshold at 10 seconds", () => {
    const args = {
      agent: "codex" as const,
      paneDead: false,
      lastOutputAt: new Date().toISOString(),
      hookState: null,
      activity: { runningThresholdMs: 20000, inactiveThresholdMs: 60000 },
    };
    const result = estimateSessionState(args);
    const expected = estimateState({
      paneDead: args.paneDead,
      lastOutputAt: args.lastOutputAt,
      hookState: args.hookState,
      thresholds: { runningThresholdMs: 10000, inactiveThresholdMs: 60000 },
    });
    expect(result).toEqual(expected);
  });
});
