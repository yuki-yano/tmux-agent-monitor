import type { PaneMeta } from "@vde-monitor/shared";

type PanePrepDeps = {
  readUserOption: (paneId: string, key: string) => Promise<string | null>;
};

export const ensurePipeTagValue = async (pane: PaneMeta, deps: PanePrepDeps): Promise<PaneMeta> => {
  if (pane.pipeTagValue != null) {
    return pane;
  }
  const fallback = await deps.readUserOption(pane.paneId, "@vde-monitor_pipe");
  return { ...pane, pipeTagValue: fallback };
};
