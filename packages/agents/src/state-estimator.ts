import type { HookStateSignal, SessionStateValue, StateSignals } from "@tmux-agent-monitor/shared";

const toTimestamp = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
};

const mapHookState = (hookState: HookStateSignal): { state: SessionStateValue; reason: string } => {
  return {
    state: hookState.state,
    reason: hookState.reason,
  };
};

export const estimateState = (
  signals: StateSignals,
): { state: SessionStateValue; reason: string } => {
  if (signals.paneDead) {
    return { state: "UNKNOWN", reason: "pane_dead" };
  }

  if (signals.hookState) {
    return mapHookState(signals.hookState);
  }

  const lastOutputTs = toTimestamp(signals.lastOutputAt);
  if (lastOutputTs !== null) {
    const diff = Date.now() - lastOutputTs;
    if (diff <= signals.thresholds.runningThresholdMs) {
      return { state: "RUNNING", reason: "recent_output" };
    }
    if (diff >= signals.thresholds.inactiveThresholdMs) {
      return { state: "WAITING_INPUT", reason: "inactive_timeout" };
    }
    return { state: "WAITING_INPUT", reason: "recently_inactive" };
  }

  return { state: "UNKNOWN", reason: "no_signal" };
};
