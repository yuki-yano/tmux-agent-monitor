import type {
  AgentMonitorConfig,
  HookStateSignal,
  PaneMeta,
  SessionDetail,
} from "@vde-monitor/shared";

import { resolvePaneAgent } from "./agent-resolver.js";
import { isShellCommand } from "./agent-resolver-utils.js";
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

type EstimatedPaneState = {
  state: SessionDetail["state"];
  reason: string;
};

const resolvePaneKind = (agent: SessionDetail["agent"], pane: PaneMeta) => {
  const isShellCommandPane =
    isShellCommand(pane.paneStartCommand) || isShellCommand(pane.currentCommand);
  return {
    isAgent: agent !== "unknown",
    isShell: agent === "unknown" && isShellCommandPane,
  };
};

const resolvePipeStatus = async ({
  isAgent,
  pane,
  paneLogManager,
}: {
  isAgent: boolean;
  pane: PaneMeta;
  paneLogManager: PaneLogManager;
}) => {
  if (!isAgent) {
    return {
      pipeAttached: false,
      pipeConflict: false,
      logPath: paneLogManager.getPaneLogPath(pane.paneId),
    };
  }
  return paneLogManager.preparePaneLogging({
    paneId: pane.paneId,
    panePipe: pane.panePipe,
    pipeTagValue: pane.pipeTagValue,
  });
};

const resolveEstimatedState = ({
  isAgent,
  isShell,
  agent,
  paneDead,
  outputAt,
  hookState,
  activity,
  estimateState,
}: {
  isAgent: boolean;
  isShell: boolean;
  agent: SessionDetail["agent"];
  paneDead: boolean;
  outputAt: string | null;
  hookState: HookStateSignal | null;
  activity: AgentMonitorConfig["activity"];
  estimateState: typeof estimateSessionState;
}): EstimatedPaneState => {
  if (isAgent) {
    return estimateState({
      agent,
      paneDead,
      lastOutputAt: outputAt,
      hookState,
      activity,
    });
  }
  return {
    state: isShell ? "SHELL" : "UNKNOWN",
    reason: isShell ? "shell" : "process:unknown",
  };
};

const resolveFinalPaneState = (
  restoredSession: SessionDetail | null,
  estimatedState: EstimatedPaneState,
) => {
  if (!restoredSession) {
    return estimatedState;
  }
  return {
    state: restoredSession.state,
    reason: "restored",
  };
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
  if (ignore) {
    return null;
  }

  const { isAgent, isShell } = resolvePaneKind(agent, pane);
  const { pipeAttached, pipeConflict, logPath } = await resolvePipeStatus({
    isAgent,
    pane,
    paneLogManager,
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
  const estimatedState = resolveEstimatedState({
    isAgent,
    isShell,
    agent,
    paneDead: pane.paneDead,
    outputAt,
    hookState,
    activity: config.activity,
    estimateState,
  });
  const finalState = resolveFinalPaneState(restoredSession, estimatedState);

  const customTitle = getCustomTitle(pane.paneId);
  const repoRoot = await resolveRepoRoot(pane.currentPath);
  const inputAt = paneState.lastInputAt;

  return buildSessionDetail({
    pane,
    agent,
    state: finalState.state,
    stateReason: finalState.reason,
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
