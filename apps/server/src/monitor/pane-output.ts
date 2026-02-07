import fs from "node:fs/promises";

import { resolveActivityTimestamp } from "../activity-resolver.js";
import { type PaneRuntimeState, updateOutputAt } from "./pane-state.js";

export type PaneOutputSnapshot = {
  paneId: string;
  paneActivity: number | null;
  windowActivity: number | null;
  paneActive: boolean;
  paneDead: boolean;
  alternateOn: boolean;
};

type PaneOutputDeps = {
  statLogMtime?: (logPath: string) => Promise<string | null>;
  resolveActivityAt?: typeof resolveActivityTimestamp;
  captureFingerprint: (paneId: string, useAlt: boolean) => Promise<string | null>;
  now?: () => Date;
};

type UpdatePaneOutputArgs = {
  pane: PaneOutputSnapshot;
  paneState: PaneRuntimeState;
  logPath: string | null;
  inactiveThresholdMs: number;
  deps: PaneOutputDeps;
};

const defaultStatLogMtime = async (logPath: string) => {
  const stat = await fs.stat(logPath).catch(() => null);
  if (!stat || stat.size <= 0) {
    return null;
  }
  return stat.mtime.toISOString();
};

const createOutputAtTracker = (paneState: PaneRuntimeState) => {
  let outputAt = paneState.lastOutputAt;
  const setOutputAt = (next: string | null) => {
    outputAt = updateOutputAt(paneState, next);
  };
  const getOutputAt = () => outputAt;
  return { setOutputAt, getOutputAt };
};

const updateOutputAtFromLog = async ({
  logPath,
  statLogMtime,
  setOutputAt,
}: {
  logPath: string | null;
  statLogMtime: (logPath: string) => Promise<string | null>;
  setOutputAt: (next: string | null) => void;
}) => {
  if (!logPath) {
    return;
  }
  const logMtime = await statLogMtime(logPath);
  if (logMtime) {
    setOutputAt(logMtime);
  }
};

const updateOutputAtFromActivity = ({
  pane,
  resolveActivityAt,
  setOutputAt,
}: {
  pane: PaneOutputSnapshot;
  resolveActivityAt: typeof resolveActivityTimestamp;
  setOutputAt: (next: string | null) => void;
}) => {
  const activityAt = resolveActivityAt({
    paneId: pane.paneId,
    paneActivity: pane.paneActivity,
    windowActivity: pane.windowActivity,
    paneActive: pane.paneActive,
  });
  if (activityAt) {
    setOutputAt(activityAt);
  }
};

const updateOutputAtFromFingerprint = async ({
  pane,
  paneState,
  captureFingerprint,
  now,
  setOutputAt,
}: {
  pane: PaneOutputSnapshot;
  paneState: PaneRuntimeState;
  captureFingerprint: PaneOutputDeps["captureFingerprint"];
  now: () => Date;
  setOutputAt: (next: string | null) => void;
}) => {
  if (pane.paneDead) {
    return;
  }
  const fingerprint = await captureFingerprint(pane.paneId, pane.alternateOn);
  if (!fingerprint || paneState.lastFingerprint === fingerprint) {
    return;
  }
  paneState.lastFingerprint = fingerprint;
  setOutputAt(now().toISOString());
};

const ensureFallbackOutputAt = ({
  outputAt,
  inactiveThresholdMs,
  now,
  setOutputAt,
}: {
  outputAt: string | null;
  inactiveThresholdMs: number;
  now: () => Date;
  setOutputAt: (next: string | null) => void;
}) => {
  if (outputAt) {
    return outputAt;
  }
  const fallbackTs = new Date(now().getTime() - inactiveThresholdMs - 1000).toISOString();
  setOutputAt(fallbackTs);
  return fallbackTs;
};

const shouldKeepHookState = (state: string) =>
  state === "WAITING_INPUT" || state === "WAITING_PERMISSION";

const resolveHookState = (paneState: PaneRuntimeState, outputAt: string | null) => {
  const hookState = paneState.hookState;
  if (!hookState || !outputAt || shouldKeepHookState(hookState.state)) {
    return hookState;
  }
  const hookTs = Date.parse(hookState.at);
  const outputTs = Date.parse(outputAt);
  const hasAdvanced = !Number.isNaN(hookTs) && !Number.isNaN(outputTs) && outputTs > hookTs;
  if (!hasAdvanced) {
    return hookState;
  }
  paneState.hookState = null;
  return null;
};

export const updatePaneOutputState = async ({
  pane,
  paneState,
  logPath,
  inactiveThresholdMs,
  deps,
}: UpdatePaneOutputArgs) => {
  const statLogMtime = deps.statLogMtime ?? defaultStatLogMtime;
  const resolveActivityAt = deps.resolveActivityAt ?? resolveActivityTimestamp;
  const now = deps.now ?? (() => new Date());

  const outputAtTracker = createOutputAtTracker(paneState);
  await updateOutputAtFromLog({
    logPath,
    statLogMtime,
    setOutputAt: outputAtTracker.setOutputAt,
  });
  updateOutputAtFromActivity({
    pane,
    resolveActivityAt,
    setOutputAt: outputAtTracker.setOutputAt,
  });
  await updateOutputAtFromFingerprint({
    pane,
    paneState,
    captureFingerprint: deps.captureFingerprint,
    now,
    setOutputAt: outputAtTracker.setOutputAt,
  });

  const outputAt = ensureFallbackOutputAt({
    outputAt: outputAtTracker.getOutputAt(),
    inactiveThresholdMs,
    now,
    setOutputAt: outputAtTracker.setOutputAt,
  });
  const hookState = resolveHookState(paneState, outputAt);

  return { outputAt, hookState };
};
