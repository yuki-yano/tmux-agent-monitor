import type { SessionSummary, WorktreeList } from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { createNextRequestId, isCurrentRequest } from "./session-request-guard";

const VIRTUAL_WORKTREE_STORAGE_KEY_PREFIX = "vde-monitor:virtual-worktree:v1";

type StoredVirtualWorktreeSelection = {
  repoRoot: string | null;
  worktreePath: string;
  branch: string | null;
  updatedAt: string;
};

type VirtualWorktreeState = {
  paneId: string;
  worktreeList: WorktreeList | null;
  loading: boolean;
  error: string | null;
  virtualWorktreePath: string | null;
};

type VirtualWorktreeAction =
  | { type: "resetPane"; paneId: string }
  | { type: "fetchStart"; resetEntries: boolean; showLoading: boolean }
  | { type: "fetchSuccess"; worktreeList: WorktreeList; showLoading: boolean }
  | { type: "fetchFailure"; error: string; resetEntries: boolean; showLoading: boolean }
  | { type: "setVirtualWorktreePath"; path: string | null };

const createInitialVirtualWorktreeState = (paneId: string): VirtualWorktreeState => ({
  paneId,
  worktreeList: null,
  loading: false,
  error: null,
  virtualWorktreePath: null,
});

const virtualWorktreeReducer = (
  state: VirtualWorktreeState,
  action: VirtualWorktreeAction,
): VirtualWorktreeState => {
  switch (action.type) {
    case "resetPane":
      return createInitialVirtualWorktreeState(action.paneId);
    case "fetchStart":
      return {
        ...state,
        worktreeList: action.resetEntries ? null : state.worktreeList,
        loading: action.showLoading ? true : state.loading,
        error: null,
      };
    case "fetchSuccess":
      return {
        ...state,
        worktreeList: action.worktreeList,
        loading: action.showLoading ? false : state.loading,
        error: null,
      };
    case "fetchFailure":
      return {
        ...state,
        worktreeList: action.resetEntries || action.showLoading ? null : state.worktreeList,
        loading: action.showLoading ? false : state.loading,
        error: action.error,
      };
    case "setVirtualWorktreePath":
      return {
        ...state,
        virtualWorktreePath:
          state.virtualWorktreePath === action.path ? state.virtualWorktreePath : action.path,
      };
  }
};

type UseSessionVirtualWorktreeArgs = {
  paneId: string;
  session: SessionSummary | null;
  requestWorktrees: (paneId: string) => Promise<WorktreeList>;
};

const normalizePath = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[\\/]+$/, "");
  if (normalized.length > 0) {
    return normalized;
  }
  return "/";
};

const buildStorageKey = (paneId: string) => `${VIRTUAL_WORKTREE_STORAGE_KEY_PREFIX}:${paneId}`;

const readStoredSelection = (paneId: string): StoredVirtualWorktreeSelection | null => {
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
    const parsed = JSON.parse(raw) as Partial<StoredVirtualWorktreeSelection>;
    if (
      typeof parsed.worktreePath !== "string" ||
      (parsed.repoRoot != null && typeof parsed.repoRoot !== "string") ||
      (parsed.branch != null && typeof parsed.branch !== "string")
    ) {
      return null;
    }
    return {
      repoRoot: parsed.repoRoot ?? null,
      worktreePath: parsed.worktreePath,
      branch: parsed.branch ?? null,
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

const writeStoredSelection = (paneId: string, value: StoredVirtualWorktreeSelection) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(buildStorageKey(paneId), JSON.stringify(value));
  } catch {
    return;
  }
};

export const useSessionVirtualWorktree = ({
  paneId,
  session,
  requestWorktrees,
}: UseSessionVirtualWorktreeArgs) => {
  const [state, dispatch] = useReducer(
    virtualWorktreeReducer,
    paneId,
    createInitialVirtualWorktreeState,
  );
  const latestRequestIdRef = useRef(0);
  const hasLoadedWorktreeListRef = useRef(false);
  const activePaneIdRef = useRef(paneId);
  const currentState = state.paneId === paneId ? state : createInitialVirtualWorktreeState(paneId);
  const { worktreeList, loading, error, virtualWorktreePath } = currentState;

  const actualWorktreePath = useMemo(
    // react-doctor-disable-next-line no-event-handler
    () => normalizePath(session?.worktreePath ?? null),
    [session?.worktreePath],
  );
  const actualBranch = session?.branch ?? null;

  const fetchWorktrees = useCallback(
    async (options?: { resetEntries?: boolean }) => {
      const requestId = createNextRequestId(latestRequestIdRef);
      const shouldResetEntries = options?.resetEntries === true;
      const shouldShowLoading = shouldResetEntries || !hasLoadedWorktreeListRef.current;
      if (shouldResetEntries) {
        hasLoadedWorktreeListRef.current = false;
      }
      dispatch({
        type: "fetchStart",
        resetEntries: shouldResetEntries,
        showLoading: shouldShowLoading,
      });
      try {
        // False positive: request freshness is checked immediately after the fetch resolves.
        // react-doctor-disable-next-line async-defer-await
        const next = await requestWorktrees(paneId);
        if (!isCurrentRequest(latestRequestIdRef, requestId)) {
          return;
        }
        hasLoadedWorktreeListRef.current = true;
        dispatch({
          type: "fetchSuccess",
          worktreeList: next,
          showLoading: shouldShowLoading,
        });
      } catch (nextError) {
        if (!isCurrentRequest(latestRequestIdRef, requestId)) {
          return;
        }
        dispatch({
          type: "fetchFailure",
          error: resolveUnknownErrorMessage(nextError, "Failed to load worktrees"),
          resetEntries: shouldResetEntries,
          showLoading: shouldShowLoading,
        });
      }
    },
    [paneId, requestWorktrees],
  );

  useEffect(() => {
    if (activePaneIdRef.current !== paneId) {
      activePaneIdRef.current = paneId;
      latestRequestIdRef.current += 1;
      hasLoadedWorktreeListRef.current = false;
      dispatch({ type: "resetPane", paneId });
    }
    void fetchWorktrees({ resetEntries: true });
  }, [fetchWorktrees, paneId, session?.repoRoot]);

  const refreshWorktrees = useCallback(async () => {
    await fetchWorktrees();
  }, [fetchWorktrees]);

  const entries = useMemo(() => worktreeList?.entries ?? [], [worktreeList]);
  const normalizedRepoRoot = normalizePath(worktreeList?.repoRoot ?? null);
  const baseBranch = worktreeList?.baseBranch ?? null;
  const pathSet = useMemo(() => new Set(entries.map((entry) => entry.path)), [entries]);

  // Reconcile the in-memory selection with the matching repository once its worktrees arrive.
  useEffect(() => {
    if (!worktreeList || !normalizedRepoRoot) {
      return;
    }
    if (virtualWorktreePath) {
      if (virtualWorktreePath === actualWorktreePath) {
        clearStoredSelection(paneId);
        dispatch({ type: "setVirtualWorktreePath", path: null });
        return;
      }
      const selectedEntry = entries.find((entry) => entry.path === virtualWorktreePath);
      if (!selectedEntry) {
        if (entries.length > 0) {
          clearStoredSelection(paneId);
          dispatch({ type: "setVirtualWorktreePath", path: null });
        }
        return;
      }
      const stored = readStoredSelection(paneId);
      if (
        normalizePath(stored?.repoRoot) !== normalizedRepoRoot ||
        normalizePath(stored?.worktreePath) !== selectedEntry.path ||
        stored?.branch !== selectedEntry.branch
      ) {
        writeStoredSelection(paneId, {
          repoRoot: normalizedRepoRoot,
          worktreePath: selectedEntry.path,
          branch: selectedEntry.branch,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }
    // react-doctor-disable-next-line no-event-handler
    const stored = readStoredSelection(paneId);
    if (!stored) {
      return;
    }
    const normalizedStoredPath = normalizePath(stored.worktreePath);
    if (!normalizedStoredPath) {
      clearStoredSelection(paneId);
      return;
    }
    if (stored.repoRoot && normalizePath(stored.repoRoot) !== normalizedRepoRoot) {
      clearStoredSelection(paneId);
      return;
    }
    if (normalizedStoredPath === actualWorktreePath) {
      clearStoredSelection(paneId);
      return;
    }
    if (!pathSet.has(normalizedStoredPath)) {
      if (entries.length > 0) {
        clearStoredSelection(paneId);
      }
      return;
    }
    dispatch({ type: "setVirtualWorktreePath", path: normalizedStoredPath });
  }, [
    actualWorktreePath,
    entries,
    normalizedRepoRoot,
    paneId,
    pathSet,
    virtualWorktreePath,
    worktreeList,
  ]);

  const selectedVirtualEntry = useMemo(
    () => entries.find((entry) => entry.path === virtualWorktreePath) ?? null,
    [entries, virtualWorktreePath],
  );

  const selectVirtualWorktree = useCallback(
    (nextPath: string) => {
      const normalizedNextPath = normalizePath(nextPath);
      if (!normalizedNextPath) {
        return;
      }
      if (normalizedNextPath === actualWorktreePath) {
        clearStoredSelection(paneId);
        dispatch({ type: "setVirtualWorktreePath", path: null });
        return;
      }
      const selectedEntry = entries.find((entry) => entry.path === normalizedNextPath);
      if (selectedEntry && normalizedRepoRoot) {
        writeStoredSelection(paneId, {
          repoRoot: normalizedRepoRoot,
          worktreePath: selectedEntry.path,
          branch: selectedEntry.branch,
          updatedAt: new Date().toISOString(),
        });
      }
      dispatch({ type: "setVirtualWorktreePath", path: normalizedNextPath });
    },
    [actualWorktreePath, entries, normalizedRepoRoot, paneId],
  );

  const clearVirtualWorktree = useCallback(() => {
    clearStoredSelection(paneId);
    dispatch({ type: "setVirtualWorktreePath", path: null });
  }, [paneId]);

  const selectorEnabled = entries.length > 0;

  return {
    selectorEnabled,
    loading,
    error,
    repoRoot: normalizedRepoRoot,
    baseBranch,
    entries,
    actualWorktreePath,
    virtualWorktreePath,
    effectiveWorktreePath: selectedVirtualEntry?.path ?? null,
    effectiveBranch: selectedVirtualEntry ? selectedVirtualEntry.branch : actualBranch,
    selectVirtualWorktree,
    clearVirtualWorktree,
    refreshWorktrees,
  };
};
