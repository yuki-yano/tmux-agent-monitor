import type { SessionSummary, WorktreeList } from "@vde-monitor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";

const VIRTUAL_WORKTREE_STORAGE_KEY_PREFIX = "vde-monitor:virtual-worktree:v1";

type StoredVirtualWorktreeSelection = {
  repoRoot: string | null;
  worktreePath: string;
  branch: string | null;
  updatedAt: string;
};

type UseSessionVirtualWorktreeArgs = {
  paneId: string;
  session: SessionSummary | null;
  requestWorktrees: (paneId: string, signal?: AbortSignal) => Promise<WorktreeList>;
};

const OFFLINE_WORKTREES_MESSAGE = "Offline: waiting to load worktrees";

const virtualWorktreeSelectionReducer = (current: string | null, next: string | null) =>
  current === next ? current : next;

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
  const queryClient = useQueryClient();
  const [virtualWorktreePath, setVirtualWorktreePath] = useReducer(
    virtualWorktreeSelectionReducer,
    null,
  );
  const repoRoot = session?.repoRoot ?? null;
  const queryKey = useMemo(
    () => sessionDetailQueryKeys.worktrees(paneId, repoRoot),
    [paneId, repoRoot],
  );
  const {
    data: worktreeList = null,
    error: queryError,
    fetchStatus,
    isLoading: loading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestWorktrees(paneId, signal),
    enabled: Boolean(paneId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
  const error =
    fetchStatus === "paused" && worktreeList == null
      ? OFFLINE_WORKTREES_MESSAGE
      : fetchStatus === "fetching"
        ? null
        : queryError == null
          ? null
          : resolveUnknownErrorMessage(queryError, "Failed to load worktrees");

  const actualWorktreePath = useMemo(
    // react-doctor-disable-next-line no-event-handler
    () => normalizePath(session?.worktreePath ?? null),
    [session?.worktreePath],
  );
  const actualBranch = session?.branch ?? null;

  const refreshWorktrees = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey, exact: true });
    await queryClient.refetchQueries({ queryKey, exact: true, type: "active" });
  }, [queryClient, queryKey]);

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
        setVirtualWorktreePath(null);
        return;
      }
      const selectedEntry = entries.find((entry) => entry.path === virtualWorktreePath);
      if (!selectedEntry) {
        if (entries.length > 0) {
          clearStoredSelection(paneId);
          setVirtualWorktreePath(null);
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
    setVirtualWorktreePath(normalizedStoredPath);
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
        setVirtualWorktreePath(null);
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
      setVirtualWorktreePath(normalizedNextPath);
    },
    [actualWorktreePath, entries, normalizedRepoRoot, paneId],
  );

  const clearVirtualWorktree = useCallback(() => {
    clearStoredSelection(paneId);
    setVirtualWorktreePath(null);
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
