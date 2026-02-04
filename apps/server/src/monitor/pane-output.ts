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
  logPath: string;
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

  let outputAt = paneState.lastOutputAt;
  const updateOutputAtLocal = (next: string | null) => {
    outputAt = updateOutputAt(paneState, next);
  };

  const logMtime = await statLogMtime(logPath);
  if (logMtime) {
    updateOutputAtLocal(logMtime);
  }

  const activityAt = resolveActivityAt({
    paneId: pane.paneId,
    paneActivity: pane.paneActivity,
    windowActivity: pane.windowActivity,
    paneActive: pane.paneActive,
  });
  if (activityAt) {
    updateOutputAtLocal(activityAt);
  }

  if (!pane.paneDead) {
    const fingerprint = await deps.captureFingerprint(pane.paneId, pane.alternateOn);
    if (fingerprint) {
      const previous = paneState.lastFingerprint;
      if (previous !== fingerprint) {
        paneState.lastFingerprint = fingerprint;
        updateOutputAtLocal(now().toISOString());
      }
    }
  }

  if (!outputAt) {
    const fallbackTs = new Date(now().getTime() - inactiveThresholdMs - 1000).toISOString();
    updateOutputAtLocal(fallbackTs);
  }

  let hookState = paneState.hookState;
  if (hookState && outputAt) {
    const hookTs = Date.parse(hookState.at);
    const outputTs = Date.parse(outputAt);
    if (!Number.isNaN(hookTs) && !Number.isNaN(outputTs) && outputTs > hookTs) {
      paneState.hookState = null;
      hookState = null;
    }
  }

  return { outputAt, hookState };
};
