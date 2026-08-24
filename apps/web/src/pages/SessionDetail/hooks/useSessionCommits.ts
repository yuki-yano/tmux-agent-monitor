import {
  type UseQueryResult,
  isCancelledError,
  onlineManager,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { CommitDetail, CommitFileDiff, CommitLog } from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { useTimeout } from "@/lib/use-timeout";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import {
  AUTO_REFRESH_INTERVAL_MS,
  COMMIT_PAGE_SIZE,
  buildCommitLogSnapshot,
} from "../sessionDetailUtils";

export type UseSessionCommitsParams = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  worktreePath?: string | null;
  branch?: string | null;
  requestCommitLog: (
    paneId: string,
    options?: {
      limit?: number;
      skip?: number;
      force?: boolean;
      worktreePath?: string;
      branch?: string;
    },
    signal?: AbortSignal,
  ) => Promise<CommitLog>;
  requestCommitDetail: (
    paneId: string,
    hash: string,
    options?: { force?: boolean; worktreePath?: string },
    signal?: AbortSignal,
  ) => Promise<CommitDetail>;
  requestCommitFile: (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean; worktreePath?: string },
    signal?: AbortSignal,
  ) => Promise<CommitFileDiff>;
};

type CommitFileRequest = { hash: string; path: string };
type InteractiveRequest =
  | { kind: "detail"; hash: string }
  | { kind: "file"; hash: string; path: string };

type CommitsUiState = {
  scopeKey: string;
  headSnapshot: string | null;
  commitOpen: Record<string, boolean>;
  commitFileOpen: Record<string, boolean>;
  requestedDetails: string[];
  requestedFiles: CommitFileRequest[];
  copiedHash: string | null;
  manualLoading: boolean;
  manualError: unknown;
  manualToken: number;
  lastInteractiveRequest: InteractiveRequest | null;
};

const OFFLINE_COMMITS_MESSAGE = "Offline: waiting to load commits";

const subscribeBrowserOnline = (onStoreChange: () => void) =>
  onlineManager.subscribe(onStoreChange);
const getBrowserOnlineSnapshot = () => onlineManager.isOnline();
const getServerBrowserOnlineSnapshot = () => true;

const createCommitsUiState = (scopeKey: string): CommitsUiState => ({
  scopeKey,
  headSnapshot: null,
  commitOpen: {},
  commitFileOpen: {},
  requestedDetails: [],
  requestedFiles: [],
  copiedHash: null,
  manualLoading: false,
  manualError: null,
  manualToken: 0,
  lastInteractiveRequest: null,
});

const pruneBooleanRecord = (record: Record<string, boolean>, hashes: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([hash]) => hashes.has(hash)));

const commitFileRequestKey = ({ hash, path }: CommitFileRequest) => `${hash}\0${path}`;
const commitFileUiKey = ({ hash, path }: CommitFileRequest) => `${hash}:${path}`;

const pruneCommitFileRecord = (record: Record<string, boolean>, hashes: Set<string>) =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => hashes.has(key.slice(0, key.indexOf(":")))),
  );

const mergeCommitLogs = (
  head: CommitLog | null,
  tailPages: CommitLog[] | undefined,
): CommitLog | null => {
  if (head == null) return null;
  const commits = new Map(head.commits.map((commit) => [commit.hash, commit]));
  tailPages?.forEach((page) => {
    page.commits.forEach((commit) => {
      if (!commits.has(commit.hash)) commits.set(commit.hash, commit);
    });
  });
  return { ...head, commits: Array.from(commits.values()) };
};

export class CommitLogTailScopeMismatchError extends Error {
  constructor() {
    super("Commit log changed while loading more commits");
    this.name = "CommitLogTailScopeMismatchError";
  }
}

export const useSessionCommits = ({
  paneId,
  repoRoot,
  connected,
  worktreePath = null,
  branch = null,
  requestCommitLog,
  requestCommitDetail,
  requestCommitFile,
}: UseSessionCommitsParams) => {
  const queryClient = useQueryClient();
  const browserOnline = useSyncExternalStore(
    subscribeBrowserOnline,
    getBrowserOnlineSnapshot,
    getServerBrowserOnlineSnapshot,
  );
  const copyTimer = useTimeout();
  const nextManualTokenRef = useRef(0);
  const normalizedWorktreePath = branch == null ? worktreePath : null;
  const scope = useMemo(
    () => ({ repoRoot, worktreePath: normalizedWorktreePath, branch }),
    [branch, normalizedWorktreePath, repoRoot],
  );
  const scopeKey = `${paneId}\0${repoRoot ?? ""}\0${normalizedWorktreePath ?? ""}\0${branch ?? ""}`;
  const headQueryKey = useMemo(
    () => sessionDetailQueryKeys.commitLogHead(paneId, { ...scope, limit: COMMIT_PAGE_SIZE }),
    [paneId, scope],
  );
  const commitsRootQueryKey = useMemo(() => sessionDetailQueryKeys.commitsRoot(paneId), [paneId]);
  const requestScopeOptions = useMemo(
    () =>
      branch != null
        ? { branch }
        : normalizedWorktreePath != null
          ? { worktreePath: normalizedWorktreePath }
          : {},
    [branch, normalizedWorktreePath],
  );
  const headQueryOptions = useMemo(
    () => ({
      queryKey: headQueryKey,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        requestCommitLog(
          paneId,
          { limit: COMMIT_PAGE_SIZE, skip: 0, force: true, ...requestScopeOptions },
          signal,
        ),
      staleTime: 0,
      gcTime: 0,
      retry: false as const,
      networkMode: "online" as const,
    }),
    [headQueryKey, paneId, requestCommitLog, requestScopeOptions],
  );
  const headQuery = useQuery({
    ...headQueryOptions,
    enabled: Boolean(paneId) && connected,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: connected && browserOnline ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const headLog = headQuery.data ?? null;
  const headSnapshot = headLog == null ? null : buildCommitLogSnapshot(headLog);
  const [uiState, setUiState] = useState(() => createCommitsUiState(scopeKey));
  const currentUiState = (() => {
    if (uiState.scopeKey !== scopeKey) {
      const nextState = createCommitsUiState(scopeKey);
      setUiState(nextState);
      return nextState;
    }
    if (headSnapshot != null && uiState.headSnapshot !== headSnapshot) {
      const hashes = new Set(headLog?.commits.map((commit) => commit.hash) ?? []);
      const nextState = {
        ...uiState,
        headSnapshot,
        commitOpen: pruneBooleanRecord(uiState.commitOpen, hashes),
        commitFileOpen: pruneCommitFileRecord(uiState.commitFileOpen, hashes),
        requestedDetails: uiState.requestedDetails.filter((hash) => hashes.has(hash)),
        requestedFiles: uiState.requestedFiles.filter(({ hash }) => hashes.has(hash)),
        manualError: null,
        lastInteractiveRequest: null,
      };
      setUiState(nextState);
      return nextState;
    }
    return uiState;
  })();

  const expectedRev = headLog?.rev ?? null;
  const committedHeadSnapshot = currentUiState.headSnapshot;
  const tailQueryKey = useMemo(
    () =>
      sessionDetailQueryKeys.commitLogTail(paneId, {
        repoRoot,
        worktreePath: normalizedWorktreePath,
        branch,
        expectedRev,
        headSnapshot: committedHeadSnapshot,
        limit: COMMIT_PAGE_SIZE,
      }),
    [branch, committedHeadSnapshot, expectedRev, normalizedWorktreePath, paneId, repoRoot],
  );
  const tailQuery = useInfiniteQuery({
    queryKey: tailQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      const log = await requestCommitLog(
        paneId,
        { limit: COMMIT_PAGE_SIZE, skip: pageParam, force: true, ...requestScopeOptions },
        signal,
      );
      if (log.rev !== expectedRev || log.repoRoot !== headLog?.repoRoot) {
        throw new CommitLogTailScopeMismatchError();
      }
      return log;
    },
    enabled: false,
    initialPageParam: headLog?.commits.length ?? 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const nextSkip = lastPageParam + lastPage.commits.length;
      const totalCount = headLog?.totalCount;
      if (lastPage.commits.length === 0) return undefined;
      if (totalCount != null && nextSkip >= totalCount) return undefined;
      if (totalCount == null && lastPage.commits.length < COMMIT_PAGE_SIZE) return undefined;
      return nextSkip;
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const fetchNextCommitPage = tailQuery.fetchNextPage;

  const combineDetailQueries = useCallback(
    (results: UseQueryResult<CommitDetail>[]) => ({
      data: Object.fromEntries(
        currentUiState.requestedDetails.flatMap((hash, index) => {
          const detail = results[index]?.data;
          return detail == null ? [] : [[hash, detail]];
        }),
      ) as Record<string, CommitDetail>,
      loading: Object.fromEntries(
        currentUiState.requestedDetails.map((hash, index) => [
          hash,
          results[index]?.isFetching ?? false,
        ]),
      ) as Record<string, boolean>,
      errors: Object.fromEntries(
        currentUiState.requestedDetails.map((hash, index) => [hash, results[index]?.error ?? null]),
      ) as Record<string, unknown>,
    }),
    [currentUiState.requestedDetails],
  );
  const detailProjection = useQueries({
    queries: currentUiState.requestedDetails.map((hash) => {
      const queryKey = sessionDetailQueryKeys.commitDetail(paneId, { ...scope, hash });
      const open = currentUiState.commitOpen[hash] ?? false;
      const status = queryClient.getQueryState(queryKey)?.status;
      return {
        queryKey,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestCommitDetail(
            paneId,
            hash,
            normalizedWorktreePath == null
              ? { force: true }
              : { force: true, worktreePath: normalizedWorktreePath },
            signal,
          ),
        enabled: connected && (open || status !== "error"),
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
        networkMode: "online" as const,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      };
    }),
    combine: combineDetailQueries,
  });
  const combineFileQueries = useCallback(
    (results: UseQueryResult<CommitFileDiff>[]) => ({
      data: Object.fromEntries(
        currentUiState.requestedFiles.flatMap((request, index) => {
          const file = results[index]?.data;
          return file == null ? [] : [[commitFileUiKey(request), file]];
        }),
      ) as Record<string, CommitFileDiff>,
      loading: Object.fromEntries(
        currentUiState.requestedFiles.map((request, index) => [
          commitFileUiKey(request),
          results[index]?.isFetching ?? false,
        ]),
      ) as Record<string, boolean>,
      errors: Object.fromEntries(
        currentUiState.requestedFiles.map((request, index) => [
          commitFileRequestKey(request),
          results[index]?.error ?? null,
        ]),
      ) as Record<string, unknown>,
    }),
    [currentUiState.requestedFiles],
  );
  const fileProjection = useQueries({
    queries: currentUiState.requestedFiles.map(({ hash, path }) => {
      const queryKey = sessionDetailQueryKeys.commitFile(paneId, { ...scope, hash, path });
      const open = currentUiState.commitFileOpen[commitFileUiKey({ hash, path })] ?? false;
      const status = queryClient.getQueryState(queryKey)?.status;
      return {
        queryKey,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestCommitFile(
            paneId,
            hash,
            path,
            normalizedWorktreePath == null
              ? { force: true }
              : { force: true, worktreePath: normalizedWorktreePath },
            signal,
          ),
        enabled: connected && (open || status !== "error"),
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
        networkMode: "online" as const,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      };
    }),
    combine: combineFileQueries,
  });
  const commitLog = useMemo(
    () => mergeCommitLogs(headLog, tailQuery.data?.pages),
    [headLog, tailQuery.data?.pages],
  );
  const rawTailCount =
    tailQuery.data?.pages.reduce((total, page) => total + page.commits.length, 0) ?? 0;
  const rawLoadedCount = (headLog?.commits.length ?? 0) + rawTailCount;
  const commitHasMore =
    headLog != null &&
    (headLog.totalCount != null
      ? rawLoadedCount < headLog.totalCount
      : tailQuery.data?.pages.length
        ? (tailQuery.data.pages.at(-1)?.commits.length ?? 0) === COMMIT_PAGE_SIZE
        : headLog.commits.length === COMMIT_PAGE_SIZE);

  const lastInteractiveError = (() => {
    const target = currentUiState.lastInteractiveRequest;
    if (target == null) return null;
    if (target.kind === "detail") {
      return detailProjection.errors[target.hash] ?? null;
    }
    return fileProjection.errors[commitFileRequestKey(target)] ?? null;
  })();
  const commitError =
    currentUiState.manualError != null
      ? resolveUnknownErrorMessage(currentUiState.manualError, API_ERROR_MESSAGES.commitLog)
      : headLog == null && headQuery.fetchStatus === "paused"
        ? OFFLINE_COMMITS_MESSAGE
        : headLog == null && headQuery.error != null
          ? resolveUnknownErrorMessage(headQuery.error, API_ERROR_MESSAGES.commitLog)
          : lastInteractiveError == null
            ? null
            : resolveUnknownErrorMessage(
                lastInteractiveError,
                currentUiState.lastInteractiveRequest?.kind === "file"
                  ? API_ERROR_MESSAGES.commitFile
                  : API_ERROR_MESSAGES.commitDetail,
              );

  useEffect(() => {
    if (!connected) {
      void queryClient.cancelQueries({ queryKey: commitsRootQueryKey });
    }
  }, [commitsRootQueryKey, connected, queryClient]);

  const refreshCommitLog = useCallback(async () => {
    const targetScopeKey = scopeKey;
    const manualToken = nextManualTokenRef.current + 1;
    nextManualTokenRef.current = manualToken;
    if (!connected || !browserOnline) {
      setUiState((current) =>
        current.scopeKey === targetScopeKey
          ? {
              ...current,
              manualLoading: false,
              manualError: null,
              manualToken,
            }
          : current,
      );
      await queryClient.invalidateQueries({
        queryKey: headQueryKey,
        exact: true,
        refetchType: "none",
      });
      return;
    }
    setUiState((current) =>
      current.scopeKey === targetScopeKey
        ? { ...current, manualLoading: true, manualError: null, manualToken }
        : current,
    );
    try {
      await queryClient.cancelQueries({ queryKey: headQueryKey, exact: true });
      await queryClient.fetchQuery(headQueryOptions);
    } catch (error) {
      if (isCancelledError(error)) return;
      setUiState((current) =>
        current.scopeKey === targetScopeKey && current.manualToken === manualToken
          ? { ...current, manualError: error }
          : current,
      );
    } finally {
      setUiState((current) =>
        current.scopeKey === targetScopeKey && current.manualToken === manualToken
          ? { ...current, manualLoading: false }
          : current,
      );
    }
  }, [browserOnline, connected, headQueryKey, headQueryOptions, queryClient, scopeKey, setUiState]);

  const loadMoreCommits = useCallback(async () => {
    if (headLog == null || !commitHasMore || !connected || !browserOnline) return;
    try {
      await fetchNextCommitPage({ cancelRefetch: false, throwOnError: true });
    } catch (error) {
      if (error instanceof CommitLogTailScopeMismatchError) {
        queryClient.removeQueries({ queryKey: tailQueryKey, exact: true });
        await refreshCommitLog();
      }
    }
  }, [
    browserOnline,
    commitHasMore,
    connected,
    headLog,
    queryClient,
    refreshCommitLog,
    fetchNextCommitPage,
    tailQueryKey,
  ]);

  const retryDetail = useCallback(
    (hash: string) =>
      queryClient.fetchQuery({
        queryKey: sessionDetailQueryKeys.commitDetail(paneId, { ...scope, hash }),
        queryFn: ({ signal }) =>
          requestCommitDetail(
            paneId,
            hash,
            normalizedWorktreePath == null
              ? { force: true }
              : { force: true, worktreePath: normalizedWorktreePath },
            signal,
          ),
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
        networkMode: "online",
      }),
    [normalizedWorktreePath, paneId, queryClient, requestCommitDetail, scope],
  );
  const retryFile = useCallback(
    ({ hash, path }: CommitFileRequest) =>
      queryClient.fetchQuery({
        queryKey: sessionDetailQueryKeys.commitFile(paneId, { ...scope, hash, path }),
        queryFn: ({ signal }) =>
          requestCommitFile(
            paneId,
            hash,
            path,
            normalizedWorktreePath == null
              ? { force: true }
              : { force: true, worktreePath: normalizedWorktreePath },
            signal,
          ),
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
        networkMode: "online",
      }),
    [normalizedWorktreePath, paneId, queryClient, requestCommitFile, scope],
  );

  const toggleCommit = useCallback(
    (hash: string) => {
      const opening = !currentUiState.commitOpen[hash];
      const wasRequested = currentUiState.requestedDetails.includes(hash);
      setUiState((current) => ({
        ...current,
        commitOpen: { ...current.commitOpen, [hash]: opening },
        requestedDetails:
          opening && !current.requestedDetails.includes(hash)
            ? [...current.requestedDetails, hash]
            : current.requestedDetails,
        lastInteractiveRequest: opening ? { kind: "detail", hash } : current.lastInteractiveRequest,
      }));
      if (opening && wasRequested && connected && browserOnline) {
        void retryDetail(hash).catch(() => undefined);
      }
    },
    [
      browserOnline,
      connected,
      currentUiState.commitOpen,
      currentUiState.requestedDetails,
      retryDetail,
      setUiState,
    ],
  );

  const toggleCommitFile = useCallback(
    (hash: string, path: string) => {
      const request = { hash, path };
      const queryKey = commitFileRequestKey(request);
      const uiKey = commitFileUiKey(request);
      const opening = !currentUiState.commitFileOpen[uiKey];
      const wasRequested = currentUiState.requestedFiles.some(
        (current) => commitFileRequestKey(current) === queryKey,
      );
      setUiState((current) => ({
        ...current,
        commitFileOpen: { ...current.commitFileOpen, [uiKey]: opening },
        requestedFiles:
          opening &&
          !current.requestedFiles.some((candidate) => commitFileRequestKey(candidate) === queryKey)
            ? [...current.requestedFiles, request]
            : current.requestedFiles,
        lastInteractiveRequest: opening
          ? { kind: "file", hash, path }
          : current.lastInteractiveRequest,
      }));
      if (opening && wasRequested && connected && browserOnline) {
        void retryFile(request).catch(() => undefined);
      }
    },
    [
      browserOnline,
      connected,
      currentUiState.commitFileOpen,
      currentUiState.requestedFiles,
      retryFile,
      setUiState,
    ],
  );

  const copyHash = useCallback(
    async (hash: string) => {
      const targetScopeKey = scopeKey;
      const copied = await copyToClipboard(hash);
      if (!copied) return;
      setUiState((current) =>
        current.scopeKey === targetScopeKey ? { ...current, copiedHash: hash } : current,
      );
      copyTimer.set(() => {
        setUiState((current) =>
          current.scopeKey === targetScopeKey && current.copiedHash === hash
            ? { ...current, copiedHash: null }
            : current,
        );
      }, 1200);
    },
    [copyTimer, scopeKey, setUiState],
  );

  return {
    commitLog,
    commitError,
    commitLoading:
      currentUiState.manualLoading || (connected && headLog == null && headQuery.isLoading),
    commitLoadingMore: tailQuery.isFetchingNextPage,
    commitHasMore,
    commitDetails: detailProjection.data,
    commitFileDetails: fileProjection.data,
    commitFileOpen: currentUiState.commitFileOpen,
    commitFileLoading: fileProjection.loading,
    commitOpen: currentUiState.commitOpen,
    commitLoadingDetails: detailProjection.loading,
    copiedHash: currentUiState.copiedHash,
    refreshCommitLog,
    loadMoreCommits,
    toggleCommit,
    toggleCommitFile,
    copyHash,
  };
};
