import { estimateState } from "@vde-monitor/agents";
import type { HookStateSignal } from "@vde-monitor/shared";

import type { AgentType } from "./agent-resolver-utils.js";

type ActivityThresholds = {
  runningThresholdMs: number;
  inactiveThresholdMs: number;
};

type EstimateSessionStateArgs = {
  agent: AgentType;
  paneDead: boolean;
  lastOutputAt: string | null;
  hookState: HookStateSignal | null;
  activity: ActivityThresholds;
};

export const estimateSessionState = ({
  agent,
  paneDead,
  lastOutputAt,
  hookState,
  activity,
}: EstimateSessionStateArgs) => {
  const runningThresholdMs =
    agent === "codex" ? Math.min(activity.runningThresholdMs, 10000) : activity.runningThresholdMs;

  return estimateState({
    paneDead,
    lastOutputAt,
    hookState,
    thresholds: {
      runningThresholdMs,
      inactiveThresholdMs: activity.inactiveThresholdMs,
    },
  });
};
