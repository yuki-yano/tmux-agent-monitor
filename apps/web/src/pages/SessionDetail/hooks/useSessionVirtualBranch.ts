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
  }>(() => ({ paneId, branch: null, invalidatedBranch: null }));

  if (virtualBranchState.paneId !== paneId) {
    setVirtualBranchState({ paneId, branch: null, invalidatedBranch: null });
  }

  const branchNames = useMemo(
    () => new Set((branchList?.entries ?? []).map((entry) => entry.name)),
    [branchList],
  );
  const defaultBranch = branchList?.defaultBranch ?? null;
  const repoRoot = branchList?.repoRoot ?? null;
  const storedVirtualBranch =
    virtualBranchState.paneId === paneId &&
    virtualBranchState.invalidatedBranch !== virtualBranchState.branch
      ? virtualBranchState.branch
      : null;
  const virtualBranch =
    storedVirtualBranch && (branchNames.size === 0 || branchNames.has(storedVirtualBranch))
      ? storedVirtualBranch
      : null;

  // Reconcile the in-memory selection with the matching repository once its branch list arrives.
  // react-doctor-disable-next-line no-derived-state-effect -- Branch-list and localStorage updates invalidate persisted selections.
  useEffect(() => {
    if (!branchList || !repoRoot) {
      return;
    }
    if (storedVirtualBranch) {
      if (
        (branchNames.size > 0 && !branchNames.has(storedVirtualBranch)) ||
        storedVirtualBranch === defaultBranch
      ) {
        clearStoredSelection(paneId);
        /* oxlint-disable react/set-state-in-effect -- An external branch-list update invalidated the selection. */
        // react-doctor-disable-next-line no-derived-state
        setVirtualBranchState((previous) => ({
          ...previous,
          invalidatedBranch: storedVirtualBranch,
        }));
        /* oxlint-enable react/set-state-in-effect */
        return;
      }
      const stored = readStoredSelection(paneId);
      if (stored?.repoRoot !== repoRoot || stored.branch !== storedVirtualBranch) {
        writeStoredSelection(paneId, {
          repoRoot,
          branch: storedVirtualBranch,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }
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
    setVirtualBranchState((prev) =>
      prev.paneId === paneId && prev.branch === stored.branch
        ? prev
        : { paneId, branch: stored.branch, invalidatedBranch: null },
    );
  }, [branchList, branchNames, defaultBranch, paneId, repoRoot, storedVirtualBranch]);

  const selectVirtualBranch = useCallback(
    (name: string) => {
      if (name === defaultBranch) {
        clearStoredSelection(paneId);
        setVirtualBranchState({ paneId, branch: null, invalidatedBranch: null });
        return;
      }
      if (repoRoot && (branchNames.size === 0 || branchNames.has(name))) {
        writeStoredSelection(paneId, {
          repoRoot,
          branch: name,
          updatedAt: new Date().toISOString(),
        });
      }
      setVirtualBranchState({ paneId, branch: name, invalidatedBranch: null });
    },
    [branchNames, defaultBranch, paneId, repoRoot],
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
