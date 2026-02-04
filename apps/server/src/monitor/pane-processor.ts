import type { AgentMonitorConfig, PaneMeta, SessionDetail } from "@vde-monitor/shared";

import { resolvePaneAgent } from "./agent-resolver.js";
import type { PaneLogManager } from "./pane-log-manager.js";
import { updatePaneOutputState } from "./pane-output.js";
import type { PaneRuntimeState } from "./pane-state.js";
import { buildSessionDetail } from "./session-detail.js";
import { estimateSessionState } from "./session-state.js";

type PaneStateStore = {
  get: (paneId: string) => PaneRuntimeState;
};

type PaneProcessorDeps = {
  resolvePaneAgent?: typeof resolvePaneAgent;
  updatePaneOutputState?: typeof updatePaneOutputState;
  estimateSessionState?: typeof estimateSessionState;
};

type ProcessPaneArgs = {
  pane: PaneMeta;
  config: AgentMonitorConfig;
  paneStates: PaneStateStore;
  paneLogManager: PaneLogManager;
  capturePaneFingerprint: (paneId: string, useAlt: boolean) => Promise<string | null>;
  applyRestored: (paneId: string) => SessionDetail | null;
  getCustomTitle: (paneId: string) => string | null;
  resolveRepoRoot: (currentPath: string | null) => Promise<string | null>;
};

export const processPane = async (
  {
    pane,
    config,
    paneStates,
    paneLogManager,
    capturePaneFingerprint,
    applyRestored,
    getCustomTitle,
    resolveRepoRoot,
  }: ProcessPaneArgs,
  deps: PaneProcessorDeps = {},
): Promise<SessionDetail | null> => {
  const resolveAgent = deps.resolvePaneAgent ?? resolvePaneAgent;
  const updateOutput = deps.updatePaneOutputState ?? updatePaneOutputState;
  const estimateState = deps.estimateSessionState ?? estimateSessionState;

  const { agent, ignore } = await resolveAgent({
    currentCommand: pane.currentCommand,
    paneStartCommand: pane.paneStartCommand,
    paneTitle: pane.paneTitle,
    panePid: pane.panePid,
    paneTty: pane.paneTty,
  });
  const monitored = !ignore && agent !== "unknown";
  if (!monitored) {
    return null;
  }

  const { pipeAttached, pipeConflict, logPath } = await paneLogManager.preparePaneLogging({
    paneId: pane.paneId,
    panePipe: pane.panePipe,
    pipeTagValue: pane.pipeTagValue,
  });

  const paneState = paneStates.get(pane.paneId);
  const { outputAt, hookState } = await updateOutput({
    pane: {
      paneId: pane.paneId,
      paneActivity: pane.paneActivity,
      windowActivity: pane.windowActivity,
      paneActive: pane.paneActive,
      paneDead: pane.paneDead,
      alternateOn: pane.alternateOn,
    },
    paneState,
    logPath,
    inactiveThresholdMs: config.activity.inactiveThresholdMs,
    deps: {
      captureFingerprint: capturePaneFingerprint,
    },
  });

  const restoredSession = applyRestored(pane.paneId);
  const estimated = estimateState({
    agent,
    paneDead: pane.paneDead,
    lastOutputAt: outputAt,
    hookState,
    activity: config.activity,
  });
  const finalState = restoredSession ? restoredSession.state : estimated.state;
  const finalReason = restoredSession ? "restored" : estimated.reason;

  const customTitle = getCustomTitle(pane.paneId);
  const repoRoot = await resolveRepoRoot(pane.currentPath);
  const inputAt = paneState.lastInputAt;

  return buildSessionDetail({
    pane,
    agent,
    state: finalState,
    stateReason: finalReason,
    lastMessage: paneState.lastMessage,
    lastOutputAt: outputAt,
    lastEventAt: paneState.lastEventAt,
    lastInputAt: inputAt,
    pipeAttached,
    pipeConflict,
    customTitle,
    repoRoot,
  });
};
