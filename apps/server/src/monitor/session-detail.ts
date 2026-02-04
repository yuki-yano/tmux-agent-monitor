import type { SessionDetail } from "@vde-monitor/shared";

import type { AgentType } from "./agent-resolver-utils.js";
import { buildDefaultTitle, hostCandidates, normalizeTitle } from "./monitor-utils.js";

export type PaneSnapshot = {
  paneId: string;
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  windowActivity: number | null;
  paneActive: boolean;
  currentCommand: string | null;
  currentPath: string | null;
  paneTty: string | null;
  paneTitle: string | null;
  paneStartCommand: string | null;
  panePid: number | null;
  paneDead: boolean;
  alternateOn: boolean;
};

export const resolveSessionTitle = (
  paneTitle: string | null,
  currentPath: string | null,
  paneId: string,
  sessionName: string,
) => {
  const normalized = normalizeTitle(paneTitle);
  const defaultTitle = buildDefaultTitle(currentPath, paneId, sessionName);
  return normalized && !hostCandidates.has(normalized) ? normalized : defaultTitle;
};

type BuildSessionDetailArgs = {
  pane: PaneSnapshot;
  agent: AgentType;
  state: SessionDetail["state"];
  stateReason: string;
  lastMessage: string | null;
  lastOutputAt: string | null;
  lastEventAt: string | null;
  lastInputAt: string | null;
  pipeAttached: boolean;
  pipeConflict: boolean;
  customTitle: string | null;
  repoRoot: string | null;
};

export const buildSessionDetail = ({
  pane,
  agent,
  state,
  stateReason,
  lastMessage,
  lastOutputAt,
  lastEventAt,
  lastInputAt,
  pipeAttached,
  pipeConflict,
  customTitle,
  repoRoot,
}: BuildSessionDetailArgs): SessionDetail => ({
  paneId: pane.paneId,
  sessionName: pane.sessionName,
  windowIndex: pane.windowIndex,
  paneIndex: pane.paneIndex,
  windowActivity: pane.windowActivity,
  paneActive: pane.paneActive,
  currentCommand: pane.currentCommand,
  currentPath: pane.currentPath,
  paneTty: pane.paneTty,
  title: resolveSessionTitle(pane.paneTitle, pane.currentPath, pane.paneId, pane.sessionName),
  customTitle,
  repoRoot,
  agent,
  state,
  stateReason,
  lastMessage,
  lastOutputAt,
  lastEventAt,
  lastInputAt,
  paneDead: pane.paneDead,
  alternateOn: pane.alternateOn,
  pipeAttached,
  pipeConflict,
  startCommand: pane.paneStartCommand,
  panePid: pane.panePid,
});
