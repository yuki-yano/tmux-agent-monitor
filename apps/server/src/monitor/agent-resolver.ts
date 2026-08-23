import {
  type AgentProcessSnapshot,
  findAgentFromPidTree,
  getAgentFromTty,
  getProcessCommand,
} from "./agent-resolver-process";
import type { AgentType } from "./agent-resolver-utils";
import { buildAgent, editorCommandHasAgentArg, isEditorCommand } from "./agent-resolver-utils";

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
  presence: "present" | "absent" | "indeterminate";
};

const resolveEditorPaneContext = (
  pane: PaneAgentHints,
  isEditorPane: boolean,
  snapshot: AgentProcessSnapshot | null,
) => {
  if (!isEditorPane) {
    return { ignore: false, processCommand: null as string | null };
  }
  if (editorCommandHasAgentArg(pane.paneStartCommand)) {
    return { ignore: true, processCommand: null as string | null };
  }
  const processCommand = snapshot == null ? null : getProcessCommand(snapshot, pane.panePid);
  if (editorCommandHasAgentArg(processCommand)) {
    return { ignore: true, processCommand };
  }
  return { ignore: false, processCommand };
};

const resolveFallbackAgent = ({
  agent,
  processCommand,
  pane,
  snapshot,
}: {
  agent: AgentType;
  processCommand: string | null;
  pane: PaneAgentHints;
  snapshot: AgentProcessSnapshot | null;
}) => {
  let resolved = agent;
  let command = processCommand;
  if (resolved === "unknown") {
    if (!command) {
      command = snapshot == null ? null : getProcessCommand(snapshot, pane.panePid);
    }
    if (command) {
      resolved = buildAgent(command);
    }
  }
  if (resolved === "unknown") {
    resolved = snapshot == null ? "unknown" : findAgentFromPidTree(snapshot, pane.panePid);
  }
  if (resolved === "unknown") {
    resolved = snapshot == null ? "unknown" : getAgentFromTty(snapshot, pane.paneTty);
  }
  return resolved;
};

export const resolvePaneAgent = async (
  pane: PaneAgentHints,
  snapshot: AgentProcessSnapshot | null,
): Promise<AgentResolution> => {
  const isEditorPane =
    isEditorCommand(pane.currentCommand) || isEditorCommand(pane.paneStartCommand);
  const editorContext = resolveEditorPaneContext(pane, isEditorPane, snapshot);
  if (editorContext.ignore) {
    return { agent: "unknown", ignore: true, presence: "absent" };
  }

  const currentCommandAgent = buildAgent(pane.currentCommand ?? "");
  const hintedAgent =
    currentCommandAgent === "unknown"
      ? buildAgent(pane.paneStartCommand ?? "")
      : currentCommandAgent;
  const agent = resolveFallbackAgent({
    agent: hintedAgent,
    processCommand: editorContext.processCommand,
    pane,
    snapshot,
  });

  const presence =
    agent !== "unknown"
      ? "present"
      : snapshot == null || snapshot.status === "failed"
        ? "indeterminate"
        : "absent";
  return { agent, ignore: false, presence };
};
