import type { SessionDetail } from "@vde-monitor/shared";

type RegistryLike = {
  removeMissing: (activePaneIds: Set<string>) => string[];
  values: () => SessionDetail[];
};

type PaneStateStoreLike = {
  remove: (paneId: string) => void;
  pruneMissing: (activePaneIds: Set<string>) => void;
};

type CleanupArgs = {
  registry: RegistryLike;
  paneStates: PaneStateStoreLike;
  customTitles: Map<string, string>;
  activePaneIds: Set<string>;
  saveState: (sessions: SessionDetail[]) => void;
};

export const cleanupRegistry = ({
  registry,
  paneStates,
  customTitles,
  activePaneIds,
  saveState,
}: CleanupArgs) => {
  const removed = registry.removeMissing(activePaneIds);
  removed.forEach((paneId) => {
    customTitles.delete(paneId);
    paneStates.remove(paneId);
  });
  paneStates.pruneMissing(activePaneIds);
  saveState(registry.values());
};
