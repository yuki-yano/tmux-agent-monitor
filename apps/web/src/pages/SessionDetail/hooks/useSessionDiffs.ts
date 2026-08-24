import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiffFile, DiffMode, DiffSummary } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import {
  diffErrorAtom,
  diffFilesAtom,
  diffLoadingFilesAtom,
  diffOpenAtom,
} from "../atoms/diffAtoms";
import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { AUTO_REFRESH_INTERVAL_MS, buildDiffSummarySnapshot } from "../sessionDetailUtils";

type UseSessionDiffsParams = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  worktreePath?: string | null;
  branch?: string | null;
  requestDiffSummary: (
    paneId: string,
    options: { mode: DiffMode; force?: boolean; worktreePath?: string; branch?: string },
    signal?: AbortSignal,
  ) => Promise<DiffSummary>;
  requestDiffFile: (
    paneId: string,
    path: string,
    rev: string | null | undefined,
    options: { mode: DiffMode; force?: boolean; worktreePath?: string; branch?: string },
  ) => Promise<DiffFile>;
};

type DiffScopeIdentity = {
  paneId: string;
  repoRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
  mode: DiffMode;
};

type BlockingSummaryRefresh = {
  scope: DiffScopeIdentity;
  generation: number;
  dataUpdateCount: number;
  errorUpdateCount: number;
};

type VisibleSummaryError = {
  error: unknown;
  snapshot: string | null;
};

type DiffSummaryUiState = {
  scope: DiffScopeIdentity;
  connected: boolean;
  generation: number;
  blocking: BlockingSummaryRefresh | null;
  forceHydrationDataUpdateCount: number | null;
  visibleError: VisibleSummaryError | null;
};

type ForceHydrationMarker = {
  scope: DiffScopeIdentity;
  generation: number;
  minimumDataUpdateCount: number;
};

const OFFLINE_DIFF_MESSAGE = "Offline: waiting to load diffs";

const subscribeBrowserOnline = (onStoreChange: () => void) =>
  onlineManager.subscribe(onStoreChange);
const getBrowserOnlineSnapshot = () => onlineManager.isOnline();
const getServerBrowserOnlineSnapshot = () => true;

// ---------------------------------------------------------------------------
// Module-level diff file cache (replaces TanStack Query cache)
// Key: `${paneId}\x00${worktreePath|__default__}:${branch|__no_branch__}:${mode}\x00${rev|unknown}\x00${path}`
// ---------------------------------------------------------------------------

const diffFileCache = new Map<string, DiffFile>();

const buildDiffFileCacheKey = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
) =>
  `${paneId}\x00${worktreePath ?? "__default__"}:${branch ?? "__no_branch__"}:${mode}\x00${rev ?? "unknown"}\x00${path}`;

const buildDiffFileCacheKeyPrefix = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
) => `${paneId}\x00${worktreePath ?? "__default__"}:${branch ?? "__no_branch__"}:${mode}\x00`;

const buildInFlightDiffFileKey = (
  scopeKey: string,
  generation: number,
  rev: string | null,
  path: string,
) => `${scopeKey}\x00${generation}\x00${rev ?? "unknown"}\x00${path}`;

const getDiffFileFromCache = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
): DiffFile | undefined =>
  diffFileCache.get(buildDiffFileCacheKey(paneId, worktreePath, branch, mode, rev, path));

const setDiffFileInCache = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
  file: DiffFile,
) => diffFileCache.set(buildDiffFileCacheKey(paneId, worktreePath, branch, mode, rev, path), file);

const clearDiffFileCacheForPane = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
) => {
  const prefix = buildDiffFileCacheKeyPrefix(paneId, worktreePath, branch, mode);
  for (const key of diffFileCache.keys()) {
    if (key.startsWith(prefix)) {
      diffFileCache.delete(key);
    }
  }
};

// Entries for stale revs are never read again (lookups always use the current
// summary rev), so drop them when the rev advances to keep the cache bounded.
const pruneDiffFileCacheToRev = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
) => {
  const prefix = buildDiffFileCacheKeyPrefix(paneId, worktreePath, branch, mode);
  const keepPrefix = `${prefix}${rev ?? "unknown"}\x00`;
  for (const key of diffFileCache.keys()) {
    if (key.startsWith(prefix) && !key.startsWith(keepPrefix)) {
      diffFileCache.delete(key);
    }
  }
};

// Cache writes happen only after the caller confirms that the scope/revision
// generation that started the request is still current.
const fetchCurrentDiffFileWithCache = async (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
  inFlightRequests: Map<string, Promise<DiffFile>>,
  inFlightKey: string,
  isCurrent: () => boolean,
  queryFn: () => Promise<DiffFile>,
): Promise<DiffFile | null> => {
  const cached = getDiffFileFromCache(paneId, worktreePath, branch, mode, rev, path);
  if (cached) {
    return isCurrent() ? cached : null;
  }
  let request = inFlightRequests.get(inFlightKey);
  if (!request) {
    request = queryFn();
    inFlightRequests.set(inFlightKey, request);
  }
  try {
    const file = await request;
    if (!isCurrent()) {
      return null;
    }
    setDiffFileInCache(paneId, worktreePath, branch, mode, rev, path, file);
    return file;
  } finally {
    if (inFlightRequests.get(inFlightKey) === request) {
      inFlightRequests.delete(inFlightKey);
    }
  }
};

export const useSessionDiffs = ({
  paneId,
  repoRoot,
  connected,
  worktreePath = null,
  branch = null,
  requestDiffSummary,
  requestDiffFile,
}: UseSessionDiffsParams) => {
  const queryClient = useQueryClient();
  const browserOnline = useSyncExternalStore(
    subscribeBrowserOnline,
    getBrowserOnlineSnapshot,
    getServerBrowserOnlineSnapshot,
  );
  const [worktreeDiffMode, setWorktreeDiffMode] = useState<DiffMode>("total");
  const diffMode: DiffMode = branch == null ? worktreeDiffMode : "committed";
  const [fileError, setFileError] = useAtom(diffErrorAtom);
  const [diffFiles, setDiffFiles] = useAtom(diffFilesAtom);
  const [diffOpen, setDiffOpen] = useAtom(diffOpenAtom);
  const [diffLoadingFiles, setDiffLoadingFiles] = useAtom(diffLoadingFilesAtom);

  const diffOpenRef = useRef<Record<string, boolean>>({});
  const diffSnapshotRef = useRef<string | null>(null);
  const diffSummaryRevRef = useRef<string | null>(null);
  const diffScopeGenerationRef = useRef(0);
  const [inFlightDiffFiles] = useState(() => new Map<string, Promise<DiffFile>>());
  const activeScopeRef = useRef<DiffScopeIdentity | null>(null);
  const previousConnectedRef = useRef(connected);
  const refreshGenerationRef = useRef(0);
  const forceHydrationRef = useRef<ForceHydrationMarker | null>(null);
  const lastUiForceHydrationDataUpdateCountRef = useRef<number | null>(null);

  const requestOptions = useMemo(
    () =>
      branch
        ? ({ force: true, branch, mode: "committed" } as const)
        : worktreePath
          ? ({ force: true, worktreePath, mode: diffMode } as const)
          : ({ force: true, mode: diffMode } as const),
    [branch, diffMode, worktreePath],
  );
  const queryKey = useMemo(
    () =>
      sessionDetailQueryKeys.diffSummary(paneId, {
        repoRoot,
        worktreePath,
        branch,
        mode: diffMode,
      }),
    [branch, diffMode, paneId, repoRoot, worktreePath],
  );
  const scope = useMemo<DiffScopeIdentity>(
    () => ({ paneId, repoRoot, worktreePath, branch, mode: diffMode }),
    [branch, diffMode, paneId, repoRoot, worktreePath],
  );
  const {
    data: querySummary,
    error: queryError,
    fetchStatus,
    isFetched,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestDiffSummary(paneId, requestOptions, signal),
    enabled: Boolean(paneId) && Boolean(repoRoot) && connected,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    refetchInterval: connected && browserOnline ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const subscribeQueryCache = useCallback(
    (onStoreChange: () => void) => {
      const queryCache = queryClient.getQueryCache();
      return queryCache.subscribe((event) => {
        const currentQuery = queryCache.find({ queryKey, exact: true });
        if (event.query === currentQuery) {
          onStoreChange();
        }
      });
    },
    [queryClient, queryKey],
  );
  const getDataUpdateCount = useCallback(
    () => queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0,
    [queryClient, queryKey],
  );
  const getErrorUpdateCount = useCallback(
    () => queryClient.getQueryState(queryKey)?.errorUpdateCount ?? 0,
    [queryClient, queryKey],
  );
  const dataUpdateCount = useSyncExternalStore(
    subscribeQueryCache,
    getDataUpdateCount,
    getDataUpdateCount,
  );
  const errorUpdateCount = useSyncExternalStore(
    subscribeQueryCache,
    getErrorUpdateCount,
    getErrorUpdateCount,
  );
  const [summaryUiState, setSummaryUiState] = useState<DiffSummaryUiState>(() => ({
    scope,
    connected,
    generation: 0,
    blocking: null,
    forceHydrationDataUpdateCount: null,
    visibleError: null,
  }));
  let currentSummaryUiState = summaryUiState;
  if (summaryUiState.scope !== scope) {
    currentSummaryUiState = {
      scope,
      connected,
      generation: summaryUiState.generation + 1,
      blocking: null,
      forceHydrationDataUpdateCount: null,
      visibleError: null,
    };
    setSummaryUiState(currentSummaryUiState);
  } else if (summaryUiState.connected !== connected) {
    const generation = summaryUiState.generation + 1;
    const blocking =
      connected && paneId && repoRoot
        ? { scope, generation, dataUpdateCount, errorUpdateCount }
        : null;
    currentSummaryUiState = {
      scope,
      connected,
      generation,
      blocking,
      forceHydrationDataUpdateCount: null,
      visibleError: null,
    };
    setSummaryUiState(currentSummaryUiState);
  } else if (summaryUiState.blocking) {
    if (dataUpdateCount > summaryUiState.blocking.dataUpdateCount) {
      currentSummaryUiState = {
        ...summaryUiState,
        blocking: null,
        forceHydrationDataUpdateCount: dataUpdateCount,
        visibleError: null,
      };
      setSummaryUiState(currentSummaryUiState);
    } else if (
      fetchStatus === "idle" &&
      errorUpdateCount > summaryUiState.blocking.errorUpdateCount
    ) {
      currentSummaryUiState = {
        ...summaryUiState,
        blocking: null,
        forceHydrationDataUpdateCount: null,
        visibleError: {
          error: queryError,
          snapshot: querySummary == null ? null : buildDiffSummarySnapshot(querySummary),
        },
      };
      setSummaryUiState(currentSummaryUiState);
    }
  } else if (
    summaryUiState.visibleError != null &&
    summaryUiState.visibleError.snapshot !==
      (querySummary == null ? null : buildDiffSummarySnapshot(querySummary))
  ) {
    currentSummaryUiState = {
      ...summaryUiState,
      visibleError: null,
    };
    setSummaryUiState(currentSummaryUiState);
  }

  // (1) The active scope is valid only for this mounted layout lifetime. Object identity, rather
  // than a serialised key, prevents A -> B -> A responses from re-entering the current scope.
  useLayoutEffect(() => {
    activeScopeRef.current = scope;
    diffScopeGenerationRef.current += 1;
    diffSnapshotRef.current = null;
    diffSummaryRevRef.current = null;
    lastUiForceHydrationDataUpdateCountRef.current = null;
    const activeScope = scope;
    return () => {
      if (activeScopeRef.current === activeScope) {
        activeScopeRef.current = null;
        diffScopeGenerationRef.current += 1;
        refreshGenerationRef.current += 1;
        forceHydrationRef.current = null;
      }
    };
  }, [scope]);

  // (2) App connection transitions own cancellation and error-reset semantics independently from
  // scope identity. Disabling a Query observer does not cancel a request that is already running.
  useLayoutEffect(() => {
    const wasConnected = previousConnectedRef.current;
    previousConnectedRef.current = connected;
    if (wasConnected && !connected) {
      refreshGenerationRef.current += 1;
      forceHydrationRef.current = null;
      void queryClient.cancelQueries({ queryKey, exact: true });
    } else if (!wasConnected && connected) {
      setFileError(null);
    }
  }, [connected, queryClient, queryKey, setFileError]);

  // (3) Reset the legacy file surface before paint when the Query summary scope changes.
  useLayoutEffect(() => {
    setDiffFiles({});
    setDiffOpen({});
    setDiffLoadingFiles({});
    setFileError(null);
    return () => {
      clearDiffFileCacheForPane(paneId, worktreePath, branch, diffMode);
    };
  }, [
    branch,
    diffMode,
    paneId,
    scope,
    setDiffFiles,
    setDiffLoadingFiles,
    setDiffOpen,
    setFileError,
    worktreePath,
  ]);

  const applyDiffSummary = useCallback(
    (summary: DiffSummary, targetScope: DiffScopeIdentity, forceHydrate: boolean) => {
      if (activeScopeRef.current !== targetScope) {
        return;
      }
      const targetSnapshot = buildDiffSummarySnapshot(summary);
      const snapshotChanged = diffSnapshotRef.current !== targetSnapshot;
      if (!snapshotChanged && !forceHydrate) {
        return;
      }
      setFileError(null);
      if (snapshotChanged) {
        diffScopeGenerationRef.current += 1;
        setDiffLoadingFiles({});
        clearDiffFileCacheForPane(paneId, worktreePath, branch, diffMode);
      }
      diffSummaryRevRef.current = summary.rev;
      diffSnapshotRef.current = targetSnapshot;
      const targetGeneration = diffScopeGenerationRef.current;
      const isCurrentRevision = () =>
        activeScopeRef.current === targetScope &&
        diffScopeGenerationRef.current === targetGeneration &&
        diffSummaryRevRef.current === summary.rev &&
        diffSnapshotRef.current === targetSnapshot;
      pruneDiffFileCacheToRev(paneId, worktreePath, branch, diffMode, summary.rev);
      const fileSet = new Set(summary.files.map((file) => file.path));
      setDiffOpen((prev) => {
        if (!summary.files.length) {
          return {};
        }
        const next: Record<string, boolean> = {};
        Object.entries(prev).forEach(([key, value]) => {
          if (fileSet.has(key)) {
            next[key] = value;
          }
        });
        return next;
      });
      const openTargets = Object.entries(diffOpenRef.current).filter(
        ([path, value]) => value && fileSet.has(path),
      );
      const cachedFiles = openTargets.reduce<Record<string, DiffFile>>((acc, [path]) => {
        const cached = getDiffFileFromCache(
          paneId,
          worktreePath,
          branch,
          diffMode,
          summary.rev,
          path,
        );
        if (cached) {
          acc[path] = cached;
        }
        return acc;
      }, {});
      setDiffFiles(cachedFiles);
      if (openTargets.length > 0) {
        void Promise.all(
          openTargets.map(async ([path]) => {
            const cacheMiss = cachedFiles[path] == null;
            if (cacheMiss) {
              setDiffLoadingFiles((prev) => ({ ...prev, [path]: true }));
            }
            try {
              const file = await fetchCurrentDiffFileWithCache(
                paneId,
                worktreePath,
                branch,
                diffMode,
                summary.rev,
                path,
                inFlightDiffFiles,
                buildInFlightDiffFileKey(
                  JSON.stringify(targetScope),
                  targetGeneration,
                  summary.rev,
                  path,
                ),
                isCurrentRevision,
                () => requestDiffFile(paneId, path, summary.rev, requestOptions),
              );
              if (file == null) {
                return;
              }
              setDiffFiles((prev) => ({ ...prev, [path]: file }));
            } catch (err) {
              if (!isCurrentRevision()) {
                return;
              }
              setFileError(resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.diffFile));
            } finally {
              if (cacheMiss && isCurrentRevision()) {
                setDiffLoadingFiles((prev) => ({ ...prev, [path]: false }));
              }
            }
          }),
        );
      }
    },
    [
      activeScopeRef,
      branch,
      diffMode,
      inFlightDiffFiles,
      paneId,
      requestDiffFile,
      requestOptions,
      setDiffFiles,
      setDiffLoadingFiles,
      setDiffOpen,
      setFileError,
      worktreePath,
    ],
  );

  // (4) Bridge every successful Query write, including structurally equal data, into the legacy
  // file/open cache before paint. Automatic equal-snapshot polls intentionally do no work.
  useLayoutEffect(() => {
    if (querySummary == null || activeScopeRef.current !== scope) {
      return;
    }
    const marker = forceHydrationRef.current;
    const forceHydrate =
      (marker != null &&
        marker.scope === scope &&
        dataUpdateCount >= marker.minimumDataUpdateCount) ||
      (currentSummaryUiState.scope === scope &&
        currentSummaryUiState.forceHydrationDataUpdateCount === dataUpdateCount &&
        lastUiForceHydrationDataUpdateCountRef.current !== dataUpdateCount);
    if (currentSummaryUiState.forceHydrationDataUpdateCount === dataUpdateCount && forceHydrate) {
      lastUiForceHydrationDataUpdateCountRef.current = dataUpdateCount;
    }
    applyDiffSummary(querySummary, scope, forceHydrate);
    if (forceHydrate && forceHydrationRef.current === marker) {
      forceHydrationRef.current = null;
    }
  }, [applyDiffSummary, currentSummaryUiState, dataUpdateCount, querySummary, scope]);

  const diffSummary = querySummary ?? null;
  const blockingRefresh = currentSummaryUiState.blocking != null;
  const summaryError =
    fetchStatus === "paused" && diffSummary == null
      ? OFFLINE_DIFF_MESSAGE
      : blockingRefresh
        ? null
        : (currentSummaryUiState.visibleError?.error ?? (diffSummary == null ? queryError : null));
  const diffError =
    fileError ??
    (summaryError == null
      ? null
      : resolveUnknownErrorMessage(summaryError, API_ERROR_MESSAGES.diffSummary));
  const diffLoading =
    (blockingRefresh && browserOnline) ||
    (connected && browserOnline && diffSummary == null && !isFetched && isLoading);

  const diffSummaryRev = diffSummary?.rev ?? null;
  const loadDiffFile = useCallback(
    async (path: string) => {
      if (!paneId || !diffSummaryRev || diffSnapshotRef.current == null) return;
      if (diffLoadingFiles[path]) return;
      const cached = getDiffFileFromCache(
        paneId,
        worktreePath,
        branch,
        diffMode,
        diffSummaryRev,
        path,
      );
      if (cached) {
        setDiffFiles((prev) => ({ ...prev, [path]: cached }));
        return;
      }
      const targetScope = scope;
      const targetRev = diffSummaryRev;
      const targetGeneration = diffScopeGenerationRef.current;
      const targetSnapshot = diffSnapshotRef.current;
      const isCurrentRevision = () =>
        activeScopeRef.current === targetScope &&
        diffScopeGenerationRef.current === targetGeneration &&
        diffSummaryRevRef.current === targetRev &&
        diffSnapshotRef.current === targetSnapshot;
      setDiffLoadingFiles((prev) => ({ ...prev, [path]: true }));
      try {
        // False positive: the scope/request guard depends on the resolved file.
        // react-doctor-disable-next-line async-defer-await
        const file = await fetchCurrentDiffFileWithCache(
          paneId,
          worktreePath,
          branch,
          diffMode,
          targetRev,
          path,
          inFlightDiffFiles,
          buildInFlightDiffFileKey(JSON.stringify(targetScope), targetGeneration, targetRev, path),
          isCurrentRevision,
          () => requestDiffFile(paneId, path, targetRev, requestOptions),
        );
        if (file == null) {
          return;
        }
        setDiffFiles((prev) => ({ ...prev, [path]: file }));
      } catch (err) {
        if (!isCurrentRevision()) {
          return;
        }
        setFileError(resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.diffFile));
      } finally {
        if (isCurrentRevision()) {
          setDiffLoadingFiles((prev) => ({ ...prev, [path]: false }));
        }
      }
    },
    [
      activeScopeRef,
      branch,
      diffMode,
      diffLoadingFiles,
      diffSummaryRev,
      inFlightDiffFiles,
      paneId,
      requestDiffFile,
      requestOptions,
      scope,
      setFileError,
      setDiffFiles,
      setDiffLoadingFiles,
      worktreePath,
    ],
  );

  const toggleDiff = useCallback(
    (path: string) => {
      setDiffOpen((prev) => {
        const nextOpen = !prev[path];
        if (nextOpen) {
          void loadDiffFile(path);
        }
        return { ...prev, [path]: nextOpen };
      });
    },
    [loadDiffFile, setDiffOpen],
  );

  // (5) File refreshes use the last committed open-state snapshot.
  useEffect(() => {
    diffOpenRef.current = diffOpen;
  }, [diffOpen]);

  const refreshDiff = useCallback(async () => {
    if (!paneId || !repoRoot || !connected) {
      return;
    }
    const targetScope = scope;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    const isCurrent = () =>
      activeScopeRef.current === targetScope && refreshGenerationRef.current === generation;
    setFileError(null);
    setSummaryUiState((current) => ({
      scope: targetScope,
      connected,
      generation: Math.max(current.generation, generation),
      blocking: { scope: targetScope, generation, dataUpdateCount, errorUpdateCount },
      forceHydrationDataUpdateCount: null,
      visibleError: null,
    }));
    await queryClient.cancelQueries({ queryKey, exact: true });
    if (!isCurrent()) {
      return;
    }
    const currentDataUpdateCount =
      queryClient.getQueryState(queryKey)?.dataUpdateCount ?? dataUpdateCount;
    const marker: ForceHydrationMarker = {
      scope: targetScope,
      generation,
      minimumDataUpdateCount: currentDataUpdateCount + 1,
    };
    forceHydrationRef.current = marker;
    try {
      await queryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => requestDiffSummary(paneId, requestOptions, signal),
        staleTime: 0,
        gcTime: 0,
        retry: false,
        networkMode: "online",
      });
    } catch (err) {
      if (isCurrent()) {
        const currentSummary = queryClient.getQueryData<DiffSummary>(queryKey);
        if (forceHydrationRef.current === marker) {
          forceHydrationRef.current = null;
        }
        setSummaryUiState((current) =>
          current.blocking?.generation === generation
            ? {
                ...current,
                blocking: null,
                visibleError: {
                  error: err,
                  snapshot:
                    currentSummary == null ? null : buildDiffSummarySnapshot(currentSummary),
                },
              }
            : current,
        );
      }
    }
  }, [
    connected,
    dataUpdateCount,
    errorUpdateCount,
    paneId,
    queryClient,
    queryKey,
    repoRoot,
    requestDiffSummary,
    requestOptions,
    scope,
    setFileError,
  ]);

  return {
    diffSummary,
    diffError,
    diffLoading,
    diffFiles,
    diffOpen,
    diffLoadingFiles,
    refreshDiff,
    diffMode,
    setDiffMode: setWorktreeDiffMode,
    toggleDiff,
    ensureDiffFile: loadDiffFile,
  };
};
