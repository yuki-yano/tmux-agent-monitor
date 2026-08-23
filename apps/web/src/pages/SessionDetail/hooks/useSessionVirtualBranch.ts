import type { BranchList } from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

const VIRTUAL_BRANCH_STORAGE_KEY_PREFIX = "vde-monitor:virtual-branch:v1";

type StoredVirtualBranchSelection = {
  repoRoot: string | null;
  branch: string;
  updatedAt: string;
};

const buildStorageKey = (paneId: string) => `${VIRTUAL_BRANCH_STORAGE_KEY_PREFIX}:${paneId}`;

const readStoredSelection = (paneId: string): StoredVirtualBranchSelection | null => {
  if (typeof window === "undefined") {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(buildStorageKey(paneId));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredVirtualBranchSelection>;
    if (
      typeof parsed.branch !== "string" ||
      (parsed.repoRoot != null && typeof parsed.repoRoot !== "string")
    ) {
      return null;
    }
    return {
      repoRoot: parsed.repoRoot ?? null,
      branch: parsed.branch,
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    return null;
  }
};

const clearStoredSelection = (paneId: string) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(buildStorageKey(paneId));
  } catch {
    return;
  }
};

const writeStoredSelection = (paneId: string, value: StoredVirtualBranchSelection) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(buildStorageKey(paneId), JSON.stringify(value));
  } catch {
    return;
  }
};

type UseSessionVirtualBranchArgs = {
  paneId: string;
  branchList: BranchList | null;
};

export const useSessionVirtualBranch = ({ paneId, branchList }: UseSessionVirtualBranchArgs) => {
  const [virtualBranchState, setVirtualBranchState] = useState<{
    paneId: string;
    branch: string | null;
    invalidatedBranch: string | null;
    // react-doctor-disable-next-line no-event-handler
  }>(() => ({ paneId, branch: null, invalidatedBranch: null }));

  const branchNames = useMemo(
    // react-doctor-disable-next-line no-event-handler
    () => new Set((branchList?.entries ?? []).map((entry) => entry.name)),
    [branchList],
  );
  const defaultBranch = branchList?.defaultBranch ?? null;
  // react-doctor-disable-next-line no-event-handler
  const repoRoot = branchList?.repoRoot ?? null;
  const storedVirtualBranch =
    // react-doctor-disable-next-line no-event-handler
    virtualBranchState.paneId === paneId &&
    virtualBranchState.invalidatedBranch !== virtualBranchState.branch
      ? virtualBranchState.branch
      : null;
  const virtualBranch =
    storedVirtualBranch && (branchNames.size === 0 || branchNames.has(storedVirtualBranch))
      ? storedVirtualBranch
      : null;

  // Restore stored selection once the branch list is available.
  useEffect(() => {
    if (!branchList || !repoRoot) {
      return;
    }
    // react-doctor-disable-next-line no-event-handler
    const stored = readStoredSelection(paneId);
    if (!stored) {
      return;
    }
    if (stored.repoRoot && stored.repoRoot !== repoRoot) {
      clearStoredSelection(paneId);
      return;
    }
    if (!branchNames.has(stored.branch) || stored.branch === defaultBranch) {
      clearStoredSelection(paneId);
      return;
    }
    // oxlint-disable-next-line react/set-state-in-effect -- Storage is restored only after the matching branch list arrives.
    setVirtualBranchState((prev) =>
      prev.paneId === paneId && prev.branch === stored.branch
        ? prev
        : { paneId, branch: stored.branch, invalidatedBranch: null },
    );
  }, [branchList, branchNames, defaultBranch, paneId, repoRoot]);

  // Drop the selection when the branch disappears (e.g. deleted).
  // react-doctor-disable-next-line no-derived-state-effect
  useEffect(() => {
    if (!storedVirtualBranch) {
      return;
    }
    if (branchNames.size > 0 && !branchNames.has(storedVirtualBranch)) {
      clearStoredSelection(paneId);
      /* oxlint-disable react/set-state-in-effect -- Removed branches must invalidate the restored selection. */
      // react-doctor-disable-next-line no-derived-state
      setVirtualBranchState((previous) => ({
        ...previous,
        invalidatedBranch: storedVirtualBranch,
      }));
      /* oxlint-enable react/set-state-in-effect */
    }
  }, [branchNames, paneId, storedVirtualBranch]);

  useEffect(() => {
    if (!virtualBranch || !repoRoot) {
      return;
    }
    writeStoredSelection(paneId, {
      repoRoot,
      branch: virtualBranch,
      updatedAt: new Date().toISOString(),
    });
  }, [paneId, repoRoot, virtualBranch]);

  const selectVirtualBranch = useCallback(
    (name: string) => {
      if (name === defaultBranch) {
        clearStoredSelection(paneId);
        setVirtualBranchState({ paneId, branch: null, invalidatedBranch: null });
        return;
      }
      setVirtualBranchState({ paneId, branch: name, invalidatedBranch: null });
    },
    [defaultBranch, paneId],
  );

  const clearVirtualBranch = useCallback(() => {
    clearStoredSelection(paneId);
    setVirtualBranchState({ paneId, branch: null, invalidatedBranch: null });
  }, [paneId]);

  return {
    virtualBranch,
    selectVirtualBranch,
    clearVirtualBranch,
  };
};
