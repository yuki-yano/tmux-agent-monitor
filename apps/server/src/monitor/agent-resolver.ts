import { findAgentFromPidTree, getAgentFromTty, getProcessCommand } from "./agent-resolver-process";
import type { AgentType } from "./agent-resolver-utils";
import {
  buildAgent,
  editorCommandHasAgentArg,
  isEditorCommand,
  mergeHints,
} from "./agent-resolver-utils";

export type { AgentType } from "./agent-resolver-utils";

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

const resolveEditorPaneContext = async (pane: PaneAgentHints, isEditorPane: boolean) => {
  if (!isEditorPane) {
    return { ignore: false, processCommand: null as string | null };
  }
  if (editorCommandHasAgentArg(pane.paneStartCommand)) {
    return { ignore: true, processCommand: null as string | null };
  }
  const processCommand = await getProcessCommand(pane.panePid);
  if (editorCommandHasAgentArg(processCommand)) {
    return { ignore: true, processCommand };
  }
  return { ignore: false, processCommand };
};

const resolveFallbackAgent = async ({
  agent,
  processCommand,
  pane,
}: {
  agent: AgentType;
  processCommand: string | null;
  pane: PaneAgentHints;
}) => {
  let resolved = agent;
  let command = processCommand;
  if (resolved === "unknown") {
    if (!command) {
      command = await getProcessCommand(pane.panePid);
    }
    if (command) {
      resolved = buildAgent(command);
    }
  }
  if (resolved === "unknown") {
    resolved = await findAgentFromPidTree(pane.panePid);
  }
  if (resolved === "unknown") {
    resolved = await getAgentFromTty(pane.paneTty);
  }
  return resolved;
};

export const resolvePaneAgent = async (pane: PaneAgentHints): Promise<AgentResolution> => {
  const baseHint = mergeHints(pane.currentCommand, pane.paneStartCommand);
  const isEditorPane =
    isEditorCommand(pane.currentCommand) || isEditorCommand(pane.paneStartCommand);
  const editorContext = await resolveEditorPaneContext(pane, isEditorPane);
  if (editorContext.ignore) {
    return { agent: "unknown", ignore: true };
  }

  const hintedAgent = buildAgent(baseHint);
  const agent = await resolveFallbackAgent({
    agent: hintedAgent,
    processCommand: editorContext.processCommand,
    pane,
  });

  return { agent, ignore: false };
};
