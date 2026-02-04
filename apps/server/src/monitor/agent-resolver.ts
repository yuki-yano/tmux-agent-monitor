import {
  findAgentFromPidTree,
  getAgentFromTty,
  getProcessCommand,
} from "./agent-resolver-process.js";
import type { AgentType } from "./agent-resolver-utils.js";
import {
  buildAgent,
  editorCommandHasAgentArg,
  hasAgentHint,
  isEditorCommand,
  mergeHints,
} from "./agent-resolver-utils.js";

export type { AgentType } from "./agent-resolver-utils.js";

export type PaneAgentHints = {
  currentCommand: string | null;
  paneStartCommand: string | null;
  paneTitle: string | null;
  panePid: number | null;
  paneTty: string | null;
};

type AgentResolution = {
  agent: AgentType;
  ignore: boolean;
};

export const resolvePaneAgent = async (pane: PaneAgentHints): Promise<AgentResolution> => {
  const baseHint = mergeHints(pane.currentCommand, pane.paneStartCommand, pane.paneTitle);
  const isEditorPane =
    isEditorCommand(pane.currentCommand) || isEditorCommand(pane.paneStartCommand);
  let processCommand: string | null = null;
  if (isEditorPane) {
    if (editorCommandHasAgentArg(pane.paneStartCommand) || hasAgentHint(pane.paneTitle)) {
      return { agent: "unknown", ignore: true };
    }
    processCommand = await getProcessCommand(pane.panePid);
    if (editorCommandHasAgentArg(processCommand)) {
      return { agent: "unknown", ignore: true };
    }
  }

  let agent = buildAgent(baseHint);
  if (agent === "unknown") {
    if (!processCommand) {
      processCommand = await getProcessCommand(pane.panePid);
    }
    if (processCommand) {
      agent = buildAgent(processCommand);
    }
  }
  if (agent === "unknown") {
    agent = await findAgentFromPidTree(pane.panePid);
  }
  if (agent === "unknown") {
    agent = await getAgentFromTty(pane.paneTty);
  }

  return { agent, ignore: false };
};
