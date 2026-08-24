import {
  type UseQueryResult,
  isCancelledError,
  onlineManager,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { DiffFile, DiffMode, DiffSummary } from "@vde-monitor/shared";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { AUTO_REFRESH_INTERVAL_MS, buildDiffSummarySnapshot } from "../sessionDetailUtils";
import {
  createCommittedDiffFileLifetimeRef,
  createGuardedDiffFileQuery,
} from "./diff-file-lifetime";

export type UseSessionDiffsParams = {
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
    signal?: AbortSignal,
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
  visibleError: VisibleSummaryError | null;
};

type DiffFileRequestSource = "open" | "external";

type DiffFileRequestEntry = {
  path: string;
  source: DiffFileRequestSource;
  connectionGeneration: number;
};

type DiffFileUiState = {
  scope: DiffScopeIdentity;
  connected: boolean;
  connectionGeneration: number;
  summarySnapshot: string | null;
  openPaths: Record<string, boolean>;
  requestedEntries: DiffFileRequestEntry[];
};

type DiffFileErrorEntry = {
  path: string;
  error: unknown;
  updatedAt: number;
};

class DiffFileResponseMismatchError extends Error {
  constructor() {
    super(API_ERROR_MESSAGES.diffFile);
    this.name = "DiffFileResponseMismatchError";
  }
}

const OFFLINE_DIFF_MESSAGE = "Offline: waiting to load diffs";

const subscribeBrowserOnline = (onStoreChange: () => void) =>
  onlineManager.subscribe(onStoreChange);
const getBrowserOnlineSnapshot = () => onlineManager.isOnline();
const getServerBrowserOnlineSnapshot = () => true;

const createDiffFileUiState = (scope: DiffScopeIdentity, connected: boolean): DiffFileUiState => ({
  scope,
  connected,
  connectionGeneration: 0,
  summarySnapshot: null,
  openPaths: {},
  requestedEntries: [],
});

const upsertDiffFileRequest = (
  entries: DiffFileRequestEntry[],
  path: string,
  source: DiffFileRequestSource,
  connectionGeneration: number,
): DiffFileRequestEntry[] => {
  const existing = entries.find((entry) => entry.path === path);
  if (existing == null) {
    return [...entries, { path, source, connectionGeneration }];
  }
  const nextSource = existing.source === "open" || source === "open" ? "open" : "external";
  if (existing.source === nextSource && existing.connectionGeneration === connectionGeneration) {
    return entries;
  }
  return entries.map((entry) =>
    entry.path === path ? { path, source: nextSource, connectionGeneration } : entry,
  );
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
  const activeScopeRef = useRef<DiffScopeIdentity | null>(null);
  const [committedFileLifetimeRef] = useState(() =>
    createCommittedDiffFileLifetimeRef<DiffScopeIdentity>(),
  );
  const previousConnectedRef = useRef(connected);
  const refreshGenerationRef = useRef(0);

  const requestOptions = useMemo(
    () =>
      branch
        ? ({ force: true, branch, mode: "committed" } as const)
        : worktreePath
          ? ({ force: true, worktreePath, mode: diffMode } as const)
          : ({ force: true, mode: diffMode } as const),
    [branch, diffMode, worktreePath],
  );
  const summaryQueryKey = useMemo(
    () =>
      sessionDetailQueryKeys.diffSummary(paneId, {
        repoRoot,
        worktreePath,
        branch,
        mode: diffMode,
      }),
    [branch, diffMode, paneId, repoRoot, worktreePath],
  );
  const diffFileRootQueryKey = useMemo(() => sessionDetailQueryKeys.diffFileRoot(paneId), [paneId]);
  const scope = useMemo<DiffScopeIdentity>(
    () => ({ paneId, repoRoot, worktreePath, branch, mode: diffMode }),
    [branch, diffMode, paneId, repoRoot, worktreePath],
  );
  const summaryQueryOptions = useMemo(
    () => ({
      queryKey: summaryQueryKey,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        requestDiffSummary(paneId, requestOptions, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false as const,
      networkMode: "online" as const,
    }),
    [paneId, requestDiffSummary, requestOptions, summaryQueryKey],
  );
  const {
    data: querySummary,
    error: queryError,
    fetchStatus,
    isFetched,
    isLoading,
  } = useQuery({
    ...summaryQueryOptions,
    enabled: Boolean(paneId) && Boolean(repoRoot) && connected,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    refetchInterval: connected && browserOnline ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const subscribeSummaryQuery = useCallback(
    (onStoreChange: () => void) => {
      const queryCache = queryClient.getQueryCache();
      return queryCache.subscribe((event) => {
        const currentQuery = queryCache.find({ queryKey: summaryQueryKey, exact: true });
        if (event.query === currentQuery) onStoreChange();
      });
    },
    [queryClient, summaryQueryKey],
  );
  const getDataUpdateCount = useCallback(
    () => queryClient.getQueryState(summaryQueryKey)?.dataUpdateCount ?? 0,
    [queryClient, summaryQueryKey],
  );
  const getErrorUpdateCount = useCallback(
    () => queryClient.getQueryState(summaryQueryKey)?.errorUpdateCount ?? 0,
    [queryClient, summaryQueryKey],
  );
  const dataUpdateCount = useSyncExternalStore(
    subscribeSummaryQuery,
    getDataUpdateCount,
    getDataUpdateCount,
  );
  const errorUpdateCount = useSyncExternalStore(
    subscribeSummaryQuery,
    getErrorUpdateCount,
    getErrorUpdateCount,
  );
  const [summaryUiState, setSummaryUiState] = useState<DiffSummaryUiState>(() => ({
    scope,
    connected,
    generation: 0,
    blocking: null,
    visibleError: null,
  }));
  let currentSummaryUiState = summaryUiState;
  if (summaryUiState.scope !== scope) {
    currentSummaryUiState = {
      scope,
      connected,
      generation: summaryUiState.generation + 1,
      blocking: null,
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
      visibleError: null,
    };
    setSummaryUiState(currentSummaryUiState);
  } else if (summaryUiState.blocking) {
    if (dataUpdateCount > summaryUiState.blocking.dataUpdateCount) {
      currentSummaryUiState = { ...summaryUiState, blocking: null, visibleError: null };
      setSummaryUiState(currentSummaryUiState);
    } else if (
      fetchStatus === "idle" &&
      errorUpdateCount > summaryUiState.blocking.errorUpdateCount
    ) {
      currentSummaryUiState = {
        ...summaryUiState,
        blocking: null,
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
    currentSummaryUiState = { ...summaryUiState, visibleError: null };
    setSummaryUiState(currentSummaryUiState);
  }

  const diffSummary = querySummary ?? null;
  const summarySnapshot = diffSummary == null ? null : buildDiffSummarySnapshot(diffSummary);
  const summaryFilePaths = useMemo(
    () => new Set(diffSummary?.files.map((file) => file.path) ?? []),
    [diffSummary],
  );
  const [fileUiState, setFileUiState] = useState(() => createDiffFileUiState(scope, connected));
  let currentFileUiState = fileUiState;
  if (fileUiState.scope !== scope) {
    currentFileUiState = createDiffFileUiState(scope, connected);
    setFileUiState(currentFileUiState);
  } else if (fileUiState.connected !== connected) {
    currentFileUiState = {
      ...fileUiState,
      connected,
      connectionGeneration:
        !fileUiState.connected && connected
          ? fileUiState.connectionGeneration + 1
          : fileUiState.connectionGeneration,
    };
    setFileUiState(currentFileUiState);
  } else if (fileUiState.summarySnapshot !== summarySnapshot) {
    const openPaths = Object.fromEntries(
      Object.entries(fileUiState.openPaths).filter(
        ([path, open]) => open && summaryFilePaths.has(path),
      ),
    );
    currentFileUiState = {
      ...fileUiState,
      summarySnapshot,
      openPaths,
      requestedEntries: Object.keys(openPaths).map((path) => ({
        path,
        source: "open" as const,
        connectionGeneration: fileUiState.connectionGeneration,
      })),
    };
    setFileUiState(currentFileUiState);
  }
  useLayoutEffect(() => {
    activeScopeRef.current = scope;
    const activeScope = scope;
    return () => {
      if (activeScopeRef.current === activeScope) {
        activeScopeRef.current = null;
        refreshGenerationRef.current += 1;
      }
    };
  }, [scope]);

  useLayoutEffect(() => {
    const lifetime = { scope, summarySnapshot, connected };
    committedFileLifetimeRef.commit(lifetime);
    const wasConnected = previousConnectedRef.current;
    previousConnectedRef.current = connected;
    if (wasConnected && !connected) {
      refreshGenerationRef.current += 1;
      void queryClient.cancelQueries({ queryKey: summaryQueryKey, exact: true });
      void queryClient.cancelQueries({ queryKey: diffFileRootQueryKey });
    }
    return () => {
      committedFileLifetimeRef.clear(lifetime);
    };
  }, [
    committedFileLifetimeRef,
    connected,
    diffFileRootQueryKey,
    queryClient,
    scope,
    summaryQueryKey,
    summarySnapshot,
  ]);

  const getDiffFileQueryOptions = useCallback(
    (path: string) => {
      const revision = diffSummary?.rev ?? null;
      const targetScope = scope;
      const targetSnapshot = summarySnapshot;
      const queryKey = sessionDetailQueryKeys.diffFile(paneId, {
        repoRoot,
        worktreePath,
        branch,
        mode: diffMode,
        revision,
        summarySnapshot,
        path,
      });
      return {
        queryKey,
        queryFn: createGuardedDiffFileQuery({
          lifetimeRef: committedFileLifetimeRef,
          targetScope,
          targetSnapshot,
          revision,
          path,
          request: (signal) => requestDiffFile(paneId, path, revision, requestOptions, signal),
          handleMismatch: () => {
            void queryClient.fetchQuery(summaryQueryOptions).catch(() => undefined);
            throw new DiffFileResponseMismatchError();
          },
        }),
        staleTime: Infinity,
        gcTime: 0,
        retry: false as const,
        networkMode: "online" as const,
        refetchOnMount: false as const,
        refetchOnWindowFocus: false as const,
        refetchOnReconnect: false as const,
      };
    },
    [
      branch,
      committedFileLifetimeRef,
      diffMode,
      diffSummary?.rev,
      paneId,
      queryClient,
      repoRoot,
      requestDiffFile,
      requestOptions,
      scope,
      summaryQueryOptions,
      summarySnapshot,
      worktreePath,
    ],
  );
  const combineFileQueries = useCallback(
    (results: UseQueryResult<DiffFile>[]) => ({
      data: Object.fromEntries(
        currentFileUiState.requestedEntries.flatMap((entry, index) => {
          const file = results[index]?.data;
          return file == null ? [] : [[entry.path, file]];
        }),
      ) as Record<string, DiffFile>,
      loading: Object.fromEntries(
        currentFileUiState.requestedEntries.map((entry, index) => [
          entry.path,
          results[index]?.fetchStatus === "fetching",
        ]),
      ) as Record<string, boolean>,
      errors: currentFileUiState.requestedEntries.flatMap((entry, index) => {
        const result = results[index];
        return result?.error == null || isCancelledError(result.error)
          ? []
          : [{ path: entry.path, error: result.error, updatedAt: result.errorUpdatedAt }];
      }) as DiffFileErrorEntry[],
    }),
    [currentFileUiState.requestedEntries],
  );
  const fileProjection = useQueries({
    queries: currentFileUiState.requestedEntries.map((entry) => {
      const options = getDiffFileQueryOptions(entry.path);
      const status = queryClient.getQueryState(options.queryKey)?.status;
      const open = currentFileUiState.openPaths[entry.path] ?? false;
      const sameConnection = entry.connectionGeneration === currentFileUiState.connectionGeneration;
      const continuePending = sameConnection && status === "pending";
      const externalAttempt = entry.source === "external" && status !== "error";
      return {
        ...options,
        enabled:
          connected &&
          summarySnapshot != null &&
          diffSummary?.rev != null &&
          (open || continuePending || externalAttempt),
      };
    }),
    combine: combineFileQueries,
  });

  const blockingRefresh = currentSummaryUiState.blocking != null;
  const summaryError =
    fetchStatus === "paused" && diffSummary == null
      ? OFFLINE_DIFF_MESSAGE
      : blockingRefresh
        ? null
        : (currentSummaryUiState.visibleError?.error ?? (diffSummary == null ? queryError : null));
  const latestFileError = [...fileProjection.errors].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.path.localeCompare(right.path);
  })[0]?.error;
  const diffError = blockingRefresh
    ? null
    : summaryError != null
      ? resolveUnknownErrorMessage(summaryError, API_ERROR_MESSAGES.diffSummary)
      : latestFileError == null
        ? null
        : resolveUnknownErrorMessage(latestFileError, API_ERROR_MESSAGES.diffFile);
  const diffLoading =
    (blockingRefresh && browserOnline) ||
    (connected && browserOnline && diffSummary == null && !isFetched && isLoading);

  const toggleDiff = useCallback(
    (path: string) => {
      if (summarySnapshot == null || !summaryFilePaths.has(path)) return;
      setFileUiState((current) => {
        if (current.scope !== scope || current.summarySnapshot !== summarySnapshot) return current;
        const open = !(current.openPaths[path] ?? false);
        return {
          ...current,
          openPaths: { ...current.openPaths, [path]: open },
          requestedEntries: open
            ? upsertDiffFileRequest(
                current.requestedEntries,
                path,
                "open",
                current.connectionGeneration,
              )
            : current.requestedEntries,
        };
      });
    },
    [scope, summaryFilePaths, summarySnapshot],
  );

  const ensureDiffFile = useCallback(
    async (path: string) => {
      if (summarySnapshot == null || diffSummary?.rev == null || !summaryFilePaths.has(path)) {
        return;
      }
      const targetScope = scope;
      const targetSnapshot = summarySnapshot;
      setFileUiState((current) =>
        current.scope === targetScope && current.summarySnapshot === targetSnapshot
          ? {
              ...current,
              requestedEntries: upsertDiffFileRequest(
                current.requestedEntries,
                path,
                "external",
                current.connectionGeneration,
              ),
            }
          : current,
      );
      if (!connected) return;
      try {
        await queryClient.fetchQuery(getDiffFileQueryOptions(path));
      } catch {
        // Query state is the visible error source; callers only request observation.
      }
    },
    [
      connected,
      diffSummary?.rev,
      getDiffFileQueryOptions,
      queryClient,
      scope,
      summaryFilePaths,
      summarySnapshot,
    ],
  );

  const refreshDiff = useCallback(async () => {
    if (!paneId || !repoRoot || !connected) return;
    const targetScope = scope;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    const isCurrent = () =>
      activeScopeRef.current === targetScope && refreshGenerationRef.current === generation;
    setSummaryUiState((current) => ({
      scope: targetScope,
      connected,
      generation: Math.max(current.generation, generation),
      blocking: { scope: targetScope, generation, dataUpdateCount, errorUpdateCount },
      visibleError: null,
    }));
    await queryClient.cancelQueries({ queryKey: summaryQueryKey, exact: true });
    if (!isCurrent()) return;
    try {
      const summary = await queryClient.fetchQuery(summaryQueryOptions);
      if (!isCurrent()) return;
      const refreshedSnapshot = buildDiffSummarySnapshot(summary);
      if (
        currentFileUiState.scope === targetScope &&
        currentFileUiState.summarySnapshot === refreshedSnapshot
      ) {
        const openPaths = Object.entries(currentFileUiState.openPaths).flatMap(([path, open]) =>
          open ? [path] : [],
        );
        await Promise.all(
          openPaths.map((path) =>
            queryClient.refetchQueries({
              queryKey: getDiffFileQueryOptions(path).queryKey,
              exact: true,
              type: "active",
            }),
          ),
        );
      }
    } catch (error) {
      if (!isCurrent() || isCancelledError(error)) return;
      const currentSummary = queryClient.getQueryData<DiffSummary>(summaryQueryKey);
      setSummaryUiState((current) =>
        current.blocking?.generation === generation
          ? {
              ...current,
              blocking: null,
              visibleError: {
                error,
                snapshot: currentSummary == null ? null : buildDiffSummarySnapshot(currentSummary),
              },
            }
          : current,
      );
    }
  }, [
    connected,
    currentFileUiState,
    dataUpdateCount,
    errorUpdateCount,
    getDiffFileQueryOptions,
    paneId,
    queryClient,
    repoRoot,
    scope,
    summaryQueryKey,
    summaryQueryOptions,
  ]);

  return {
    diffSummary,
    diffError,
    diffLoading,
    diffFiles: fileProjection.data,
    diffOpen: currentFileUiState.openPaths,
    diffLoadingFiles: fileProjection.loading,
    refreshDiff,
    diffMode,
    setDiffMode: setWorktreeDiffMode,
    toggleDiff,
    ensureDiffFile,
  };
};
