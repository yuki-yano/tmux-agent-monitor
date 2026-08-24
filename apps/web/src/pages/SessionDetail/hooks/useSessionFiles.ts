import {
  advanceFilesLookupGeneration,
  createFilesLookupController,
  resetFilesLookupController,
} from "./session-files-lookup-runtime";
import {
  CancelledError,
  isCancelledError,
  onlineManager,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import type { RepoFileContent, RepoFileSearchPage, RepoFileTreePage } from "@vde-monitor/shared";
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
import { buildSearchExpandPlan } from "../file-tree-search-expand";
import {
  type PageDescriptor,
  projectSearchQueryData,
  projectTreeQueryData,
  rootDescriptor,
  sameCursor,
} from "./session-files-query-projection";
import {
  type ContentTarget,
  type FilesScopeIdentity,
  createCommittedFilesLifetimeRef,
  createContentQueryCleanupCoordinator,
  createPreviewLeaseController,
  normalizeFilesQuery,
  normalizeRepoFilePath,
  registerFilesOwner,
  sameFilesScope,
  unregisterFilesOwner,
} from "./session-files-query-runtime";
import {
  buildNormalRenderNodes,
  buildSearchRenderNodes,
  collectAncestorDirectories,
  collectVisibleExpandedTreeDirectories,
  resolveTreeLoadMoreTarget,
} from "./session-files-tree-utils";
import { useSessionFilesContentQuery } from "./useSessionFiles-content-query";
import { createFilesLocalState } from "./session-files-local-state";
import {
  type LogCandidateState,
  useSessionFilesLookupActions,
} from "./useSessionFiles-lookup-actions";
import {
  clearFileModalCopyTimers,
  createFileModalCopyController,
  syncActiveContentTarget,
  useSessionFilesModalActions,
} from "./useSessionFiles-modal-actions";

export type { LogFileCandidateItem } from "./useSessionFiles-lookup-actions";

const TREE_PAGE_LIMIT = 200;
const SEARCH_PAGE_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 120;
const FILE_CONTENT_MAX_BYTES = 256 * 1024;
const OFFLINE_FILES_MESSAGE = "Offline: waiting to load files";
const DISCONNECTED_FILES_MESSAGE = "Disconnected: waiting to load files";

export type UseSessionFilesParams = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  worktreePath?: string | null;
  autoExpandMatchLimit: number;
  requestRepoFileTree: (
    paneId: string,
    options?: { path?: string; cursor?: string; limit?: number; worktreePath?: string },
    signal?: AbortSignal,
  ) => Promise<RepoFileTreePage>;
  requestRepoFileSearch: (
    paneId: string,
    query: string,
    options?: {
      cursor?: string;
      limit?: number;
      worktreePath?: string;
      exactReference?: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<RepoFileSearchPage>;
  requestRepoFileContent: (
    paneId: string,
    path: string,
    options?: { maxBytes?: number; worktreePath?: string },
    signal?: AbortSignal,
  ) => Promise<RepoFileContent>;
  revokeRepoFilePreview: (paneId: string, token: string) => Promise<void>;
};

export type { FileTreeRenderNode } from "./session-files-tree-utils";

const subscribeBrowserOnline = (listener: () => void) => onlineManager.subscribe(listener);
const getBrowserOnline = () => onlineManager.isOnline();
const getServerBrowserOnline = () => true;
const treeScopeParams = (scope: FilesScopeIdentity) => ({
  resolvedRoot: scope.resolvedRoot,
  worktreePath: scope.worktreePath,
});
const isMarkdownContent = (file: RepoFileContent) =>
  file.languageHint === "markdown" || /\.(md|markdown)$/i.test(file.path);
const isHtmlContent = (file: RepoFileContent) =>
  file.languageHint === "html" || /\.html?$/i.test(file.path);

export const useSessionFiles = ({
  paneId,
  repoRoot,
  connected,
  worktreePath = null,
  autoExpandMatchLimit,
  requestRepoFileTree,
  requestRepoFileSearch,
  requestRepoFileContent,
  revokeRepoFilePreview,
}: UseSessionFilesParams) => {
  const queryClient = useQueryClient();
  const browserOnline = useSyncExternalStore(
    subscribeBrowserOnline,
    getBrowserOnline,
    getServerBrowserOnline,
  );
  const scope = useMemo<FilesScopeIdentity>(
    () => ({ paneId, resolvedRoot: repoRoot, worktreePath }),
    [paneId, repoRoot, worktreePath],
  );
  const [state, setState] = useState(() => createFilesLocalState(scope));
  const [committedLifetimeRef] = useState(createCommittedFilesLifetimeRef);
  const [previewLeases] = useState(() => createPreviewLeaseController(revokeRepoFilePreview));
  const [contentCleanup] = useState(createContentQueryCleanupCoordinator);
  const searchTimerRef = useRef<number | null>(null);
  const [copyController] = useState(createFileModalCopyController);
  const [lookupController] = useState(createFilesLookupController);
  const previousScopeRef = useRef(scope);
  const previousConnectedRef = useRef(connected);
  const previousContentTargetRef = useRef<ContentTarget | null>(null);

  const scopeChanged = !sameFilesScope(state.scope, scope);
  const currentState = scopeChanged
    ? createFilesLocalState(scope, state.scopeGeneration + 1)
    : state;

  const filesRootKey = useMemo(() => sessionDetailQueryKeys.filesRoot(paneId), [paneId]);
  const filesRootHash = JSON.stringify(filesRootKey);
  const filesScopeKey = useMemo(
    () => sessionDetailQueryKeys.filesScope(paneId, treeScopeParams(scope)),
    [paneId, scope],
  );
  const lookupRootKey = useMemo(
    () => sessionDetailQueryKeys.filesLookupRoot(paneId, treeScopeParams(scope)),
    [paneId, scope],
  );
  const getContentQueryKey = useCallback(
    (target: ContentTarget) =>
      sessionDetailQueryKeys.filesContent(paneId, treeScopeParams(scope), {
        targetPaneId: target.targetPaneId,
        targetRoot: target.targetRoot,
        targetWorktreePath: target.targetWorktreePath,
        path: target.path,
        maxBytes: FILE_CONTENT_MAX_BYTES,
      }),
    [paneId, scope],
  );

  useLayoutEffect(() => {
    const previousScope = previousScopeRef.current;
    const lifetime = { scope, connected, contentTarget: currentState.contentTarget };
    committedLifetimeRef.commit(lifetime);
    syncActiveContentTarget(copyController, currentState.contentTarget);
    if (!sameFilesScope(previousScope, scope)) {
      resetFilesLookupController(lookupController);
      contentCleanup.cancelReopens();
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
      const previousKey = sessionDetailQueryKeys.filesScope(
        previousScope.paneId,
        treeScopeParams(previousScope),
      );
      const previousTarget = previousContentTargetRef.current;
      if (previousTarget != null) {
        const previousContentKey = sessionDetailQueryKeys.filesContent(
          previousScope.paneId,
          treeScopeParams(previousScope),
          {
            targetPaneId: previousTarget.targetPaneId,
            targetRoot: previousTarget.targetRoot,
            targetWorktreePath: previousTarget.targetWorktreePath,
            path: previousTarget.path,
            maxBytes: FILE_CONTENT_MAX_BYTES,
          },
        );
        const previousFile = queryClient.getQueryData<RepoFileContent>(previousContentKey);
        previewLeases.releaseToken(previousTarget.targetPaneId, previousFile?.preview?.token);
        void queryClient.cancelQueries({ queryKey: previousContentKey, exact: true });
        contentCleanup.invalidate(queryClient, previousContentKey);
      }
      void queryClient.cancelQueries({ queryKey: previousKey });
      queryClient.removeQueries({ queryKey: previousKey, type: "inactive" });
    }
    const wasConnected = previousConnectedRef.current;
    if (wasConnected && !connected) {
      advanceFilesLookupGeneration(lookupController);
      void queryClient.cancelQueries({ queryKey: filesScopeKey });
      void queryClient.cancelQueries({ queryKey: lookupRootKey });
      if (currentState.contentTarget != null) {
        void queryClient.cancelQueries({
          queryKey: getContentQueryKey(currentState.contentTarget),
          exact: true,
        });
      }
    }
    previousScopeRef.current = scope;
    previousConnectedRef.current = connected;
    previousContentTargetRef.current = currentState.contentTarget;
    return () => committedLifetimeRef.clear(lifetime);
  }, [
    committedLifetimeRef,
    connected,
    contentCleanup,
    copyController,
    currentState.contentTarget,
    filesScopeKey,
    getContentQueryKey,
    lookupController,
    lookupRootKey,
    paneId,
    previewLeases,
    queryClient,
    scope,
  ]);

  useLayoutEffect(() => {
    const ownerGeneration = registerFilesOwner(filesRootHash);
    previewLeases.cancelScheduledRelease();
    return () => {
      resetFilesLookupController(lookupController);
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      clearFileModalCopyTimers(copyController);
      contentCleanup.dispose();
      previewLeases.scheduleReleaseAll();
      unregisterFilesOwner(filesRootHash, ownerGeneration, () => {
        void queryClient.cancelQueries({ queryKey: filesRootKey });
        queryClient.removeQueries({ queryKey: filesRootKey, type: "inactive" });
      });
    };
  }, [
    contentCleanup,
    copyController,
    filesRootHash,
    filesRootKey,
    lookupController,
    previewLeases,
    queryClient,
  ]);

  const getTreeQueryOptions = useCallback(
    (path: string, descriptor: PageDescriptor) => ({
      queryKey: sessionDetailQueryKeys.filesTree(paneId, {
        ...treeScopeParams(scope),
        path,
        cursor: descriptor.cursor,
        limit: TREE_PAGE_LIMIT,
      }),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const page = await requestRepoFileTree(
          paneId,
          {
            ...(path === "." ? {} : { path }),
            ...(descriptor.cursor == null ? {} : { cursor: descriptor.cursor }),
            limit: TREE_PAGE_LIMIT,
            ...(scope.resolvedRoot == null ? {} : { worktreePath: scope.resolvedRoot }),
          },
          signal,
        );
        if (signal.aborted) throw new CancelledError();
        if (normalizeRepoFilePath(page.basePath, true) !== path) {
          throw new Error(API_ERROR_MESSAGES.fileTree);
        }
        return page;
      },
      staleTime: Infinity,
      gcTime: 0,
      retry: false as const,
      networkMode: "online" as const,
      refetchOnMount: false as const,
      refetchOnWindowFocus: false as const,
      refetchOnReconnect: false as const,
      enabled: connected && scope.resolvedRoot != null,
    }),
    [connected, paneId, requestRepoFileTree, scope],
  );
  const treeQueryEntries = Object.entries(currentState.treeDescriptors).flatMap(
    ([path, descriptors]) => descriptors.map((descriptor) => ({ path, descriptor })),
  );
  const treeResults = useQueries({
    queries: treeQueryEntries.map(({ path, descriptor }) => getTreeQueryOptions(path, descriptor)),
  });
  const treeResultByKey = new Map(
    treeQueryEntries.map((entry, index) => [
      `${entry.path}\0${entry.descriptor.cursor ?? ""}`,
      treeResults[index],
    ]),
  );
  const treeProjection = projectTreeQueryData({
    descriptorsByPath: currentState.treeDescriptors,
    headDataUpdateCountByPath: Object.fromEntries(
      Object.entries(currentState.treeDescriptors).map(([path, descriptors]) => [
        path,
        descriptors[0] == null
          ? 0
          : (queryClient.getQueryState(getTreeQueryOptions(path, descriptors[0]).queryKey)
              ?.dataUpdateCount ?? 0),
      ]),
    ),
    resultByKey: treeResultByKey,
  });
  const {
    pages: treePages,
    reachableKeys: reachableTreeKeys,
    nextDescriptors: nextTreeDescriptors,
    descriptorsChanged: treeDescriptorsChanged,
  } = treeProjection;
  const searchQueries = [currentState.desiredSearchQuery, currentState.displayedSearchQuery].filter(
    (query, index, values): query is string => query != null && values.indexOf(query) === index,
  );
  const searchQueryEntries = searchQueries.flatMap((query) =>
    (currentState.searchDescriptors[query] ?? []).map((descriptor) => ({ query, descriptor })),
  );
  const getSearchQueryOptions = useCallback(
    (query: string, descriptor: PageDescriptor) => ({
      queryKey: sessionDetailQueryKeys.filesSearch(paneId, {
        ...treeScopeParams(scope),
        query,
        cursor: descriptor.cursor,
        limit: SEARCH_PAGE_LIMIT,
      }),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const page = await requestRepoFileSearch(
          paneId,
          query,
          {
            ...(descriptor.cursor == null ? {} : { cursor: descriptor.cursor }),
            limit: SEARCH_PAGE_LIMIT,
            ...(scope.resolvedRoot == null ? {} : { worktreePath: scope.resolvedRoot }),
          },
          signal,
        );
        if (signal.aborted) throw new CancelledError();
        if (normalizeFilesQuery(page.query) !== query)
          throw new Error(API_ERROR_MESSAGES.fileSearch);
        return page;
      },
      staleTime: Infinity,
      gcTime: 0,
      retry: false as const,
      networkMode: "online" as const,
      refetchOnMount: false as const,
      refetchOnWindowFocus: false as const,
      refetchOnReconnect: false as const,
      enabled: connected && scope.resolvedRoot != null,
    }),
    [connected, paneId, requestRepoFileSearch, scope],
  );
  const searchResults = useQueries({
    queries: searchQueryEntries.map(({ query, descriptor }) =>
      getSearchQueryOptions(query, descriptor),
    ),
  });
  const searchResultByKey = new Map(
    searchQueryEntries.map((entry, index) => [
      `${entry.query}\0${entry.descriptor.cursor ?? ""}`,
      searchResults[index],
    ]),
  );
  const searchProjection = projectSearchQueryData({
    queries: searchQueries,
    descriptorsByQuery: currentState.searchDescriptors,
    headDataUpdateCountByQuery: Object.fromEntries(
      searchQueries.map((query) => {
        const head = currentState.searchDescriptors[query]?.[0];
        return [
          query,
          head == null
            ? 0
            : (queryClient.getQueryState(getSearchQueryOptions(query, head).queryKey)
                ?.dataUpdateCount ?? 0),
        ];
      }),
    ),
    resultByKey: searchResultByKey,
  });
  const {
    pages: mergedSearchByQuery,
    reachableKeys: reachableSearchKeys,
    nextDescriptors: nextSearchDescriptors,
    descriptorsChanged: searchDescriptorsChanged,
  } = searchProjection;
  const desiredSearchResult =
    currentState.desiredSearchQuery == null
      ? null
      : (mergedSearchByQuery.get(currentState.desiredSearchQuery) ?? null);
  const displayedSearchChanged =
    desiredSearchResult != null &&
    currentState.displayedSearchQuery !== currentState.desiredSearchQuery;
  const reconciledDisplayedSearchQuery = displayedSearchChanged
    ? currentState.desiredSearchQuery
    : currentState.displayedSearchQuery;
  const displayedSearchResult =
    reconciledDisplayedSearchQuery == null
      ? null
      : (mergedSearchByQuery.get(reconciledDisplayedSearchQuery) ?? null);
  const nextSearchActiveIndex = displayedSearchChanged ? 0 : currentState.searchActiveIndex;
  const clampedSearchActiveIndex = Math.max(
    0,
    Math.min((displayedSearchResult?.items.length ?? 1) - 1, nextSearchActiveIndex),
  );
  if (
    scopeChanged ||
    treeDescriptorsChanged ||
    displayedSearchChanged ||
    searchDescriptorsChanged ||
    clampedSearchActiveIndex !== currentState.searchActiveIndex
  ) {
    const reconciledState = {
      ...currentState,
      treeDescriptors: treeDescriptorsChanged ? nextTreeDescriptors : currentState.treeDescriptors,
      displayedSearchQuery: reconciledDisplayedSearchQuery,
      searchActiveIndex: clampedSearchActiveIndex,
      searchDescriptors: searchDescriptorsChanged
        ? nextSearchDescriptors
        : currentState.searchDescriptors,
    };
    setState(() => reconciledState);
  }

  const contentTarget = currentState.contentTarget;
  const contentQueryKey = contentTarget == null ? null : getContentQueryKey(contentTarget);
  const contentQuery = useSessionFilesContentQuery({
    connected,
    contentTarget,
    contentQueryKey,
    maxBytes: FILE_CONTENT_MAX_BYTES,
    scope,
    committedLifetimeRef,
    previewLeases,
    requestRepoFileContent,
  });

  const retryOrAddTreeDescriptor = useCallback(
    (path: string, cursor: string | null, parentCursor: string | null) => {
      const descriptors = currentState.treeDescriptors[path] ?? [];
      const existing = descriptors.find((descriptor) => sameCursor(descriptor.cursor, cursor));
      if (existing != null) {
        const options = getTreeQueryOptions(path, existing);
        if (queryClient.getQueryState(options.queryKey)?.status === "error") {
          void queryClient.refetchQueries({ queryKey: options.queryKey, exact: true });
        }
        return;
      }
      setState((previous) => {
        const previousDescriptors = previous.treeDescriptors[path] ?? [];
        if (previousDescriptors.some((descriptor) => sameCursor(descriptor.cursor, cursor))) {
          return previous;
        }
        const previousHead = previousDescriptors[0] ?? rootDescriptor();
        const headDataUpdateCount =
          queryClient.getQueryState(getTreeQueryOptions(path, previousHead).queryKey)
            ?.dataUpdateCount ?? previousHead.headDataUpdateCount;
        return {
          ...previous,
          treeDescriptors: {
            ...previous.treeDescriptors,
            [path]: [
              ...previousDescriptors.map((descriptor, index) =>
                index === 0 ? { ...descriptor, headDataUpdateCount } : descriptor,
              ),
              {
                cursor,
                parentCursor,
                headDataUpdateCount,
              },
            ],
          },
        };
      });
    },
    [currentState.treeDescriptors, getTreeQueryOptions, queryClient],
  );
  const revealFilePath = useCallback(
    (path: string) => {
      const ancestors = collectAncestorDirectories(path);
      if (ancestors.length === 0) return;
      setState((previous) => {
        const expandedDirSet = new Set(previous.expandedDirSet);
        const treeDescriptors = { ...previous.treeDescriptors };
        ancestors.forEach((ancestor) => {
          expandedDirSet.add(ancestor);
          if (treeDescriptors[ancestor] == null) treeDescriptors[ancestor] = [rootDescriptor()];
        });
        return { ...previous, expandedDirSet, treeDescriptors };
      });
      if (!connected || scope.resolvedRoot == null) return;
      ancestors.forEach((ancestor) => {
        void (async () => {
          let cursor: string | null = null;
          let parentCursor: string | null = null;
          const visited = new Set<string>();
          for (;;) {
            const descriptor: PageDescriptor = { cursor, parentCursor, headDataUpdateCount: 0 };
            const page = await queryClient.fetchQuery(getTreeQueryOptions(ancestor, descriptor));
            if (!sameFilesScope(scope, previousScopeRef.current)) return;
            retryOrAddTreeDescriptor(ancestor, cursor, parentCursor);
            const nextCursor = page.nextCursor ?? null;
            if (nextCursor == null || visited.has(nextCursor)) return;
            visited.add(nextCursor);
            parentCursor = cursor;
            cursor = nextCursor;
          }
        })().catch(() => undefined);
      });
    },
    [connected, getTreeQueryOptions, queryClient, retryOrAddTreeDescriptor, scope],
  );

  const {
    openFileModalByPath,
    onOpenFileModal,
    onCloseFileModal,
    onCopyFileModalPath,
    onSetFileModalMarkdownViewMode,
    onToggleFileModalLineNumbers,
  } = useSessionFilesModalActions({
    contentCleanup,
    copyController,
    currentState,
    getContentQueryKey,
    paneId,
    previewLeases,
    revealFilePath,
    scope,
    setState,
  });

  const onSearchQueryChange = useCallback(
    (value: string) => {
      const normalized = normalizeFilesQuery(value);
      const previousNormalized = normalizeFilesQuery(currentState.rawSearchQuery);
      setState((previous) => ({ ...previous, rawSearchQuery: value }));
      if (normalized === previousNormalized) return;
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
      if (currentState.desiredSearchQuery != null) {
        void queryClient.cancelQueries({
          queryKey: sessionDetailQueryKeys.filesSearchRoot(paneId, treeScopeParams(scope)),
        });
      }
      if (normalized === "") {
        setState((previous) => ({
          ...previous,
          desiredSearchQuery: null,
          displayedSearchQuery: null,
          searchDescriptors: {},
          searchActiveIndex: 0,
          searchExpandedDirSet: new Set(),
          searchCollapsedDirSet: new Set(),
        }));
        return;
      }
      const revisit = currentState.searchDescriptors[normalized] != null;
      searchTimerRef.current = window.setTimeout(() => {
        searchTimerRef.current = null;
        setState((previous) => ({
          ...previous,
          desiredSearchQuery: normalized,
          searchDescriptors: {
            ...previous.searchDescriptors,
            [normalized]: [rootDescriptor()],
          },
          searchExpandedDirSet: new Set(),
          searchCollapsedDirSet: new Set(),
        }));
        if (revisit) {
          queueMicrotask(() => {
            void queryClient.refetchQueries({
              queryKey: getSearchQueryOptions(normalized, rootDescriptor()).queryKey,
              exact: true,
            });
          });
        }
      }, SEARCH_DEBOUNCE_MS);
    },
    [
      currentState.desiredSearchQuery,
      currentState.rawSearchQuery,
      currentState.searchDescriptors,
      getSearchQueryOptions,
      paneId,
      queryClient,
      scope,
    ],
  );
  const onRefresh = useCallback(() => {
    resetFilesLookupController(lookupController);
    void queryClient.cancelQueries({ queryKey: lookupRootKey });
    queryClient.removeQueries({ queryKey: lookupRootKey, type: "inactive" });
    const rootHead = currentState.treeDescriptors["."]?.[0];
    if (rootHead != null) {
      void queryClient.refetchQueries(
        {
          queryKey: getTreeQueryOptions(".", rootHead).queryKey,
          exact: true,
        },
        { cancelRefetch: false },
      );
    }
    const desired = currentState.desiredSearchQuery;
    const searchHead = desired == null ? null : currentState.searchDescriptors[desired]?.[0];
    if (desired != null && searchHead != null) {
      void queryClient.refetchQueries(
        {
          queryKey: getSearchQueryOptions(desired, searchHead).queryKey,
          exact: true,
        },
        { cancelRefetch: false },
      );
    }
  }, [
    currentState.desiredSearchQuery,
    currentState.searchDescriptors,
    currentState.treeDescriptors,
    getSearchQueryOptions,
    getTreeQueryOptions,
    lookupRootKey,
    lookupController,
    queryClient,
  ]);

  const setResolutionState = useCallback((error: string | null, candidate: LogCandidateState) => {
    setState((previous) => ({
      ...previous,
      fileResolveError: error,
      logCandidate: candidate,
    }));
  }, []);
  const { onResolveLogFileReference, onResolveLogFileReferenceCandidates } =
    useSessionFilesLookupActions({
      connected,
      controller: lookupController,
      paneId,
      scope,
      requestRepoFileSearch,
      openFileModalByPath,
      setResolutionState,
    });

  const searchResult = displayedSearchResult;
  const searchExpandPlan = buildSearchExpandPlan({
    matchedPaths: searchResult?.items.map((item) => item.path) ?? [],
    activeIndex: currentState.searchActiveIndex,
    autoExpandMatchLimit,
    truncated: searchResult?.truncated ?? false,
    totalMatchedCount: searchResult?.totalMatchedCount ?? 0,
  });
  const effectiveSearchExpandedDirSet = new Set(searchExpandPlan.expandedDirSet);
  currentState.searchExpandedDirSet.forEach((path) => effectiveSearchExpandedDirSet.add(path));
  currentState.searchCollapsedDirSet.forEach((path) => effectiveSearchExpandedDirSet.delete(path));
  const isSearchActive = normalizeFilesQuery(currentState.rawSearchQuery) !== "";
  const treeNodes = isSearchActive
    ? buildSearchRenderNodes({
        searchItems: searchResult?.items ?? [],
        selectedFilePath: currentState.selectedFilePath,
        activeMatchPath: searchResult?.items[currentState.searchActiveIndex]?.path ?? null,
        expandedDirSet: effectiveSearchExpandedDirSet,
      })
    : buildNormalRenderNodes({
        treePages,
        expandedDirSet: currentState.expandedDirSet,
        selectedFilePath: currentState.selectedFilePath,
      });
  const visibleExpandedDirSet = collectVisibleExpandedTreeDirectories({
    treePages,
    expandedDirSet: currentState.expandedDirSet,
  });
  const loadMoreTreeTarget = resolveTreeLoadMoreTarget({
    treePages,
    expandedDirSet: visibleExpandedDirSet,
  });
  const desiredHeadResult =
    currentState.desiredSearchQuery == null
      ? null
      : searchResultByKey.get(`${currentState.desiredSearchQuery}\0`);
  const treeRootResult = treeResultByKey.get(".\0");
  const treeErrorPriority = [
    { path: ".", cursor: null },
    ...[...visibleExpandedDirSet].flatMap((path) =>
      (currentState.treeDescriptors[path] ?? [rootDescriptor()]).map((descriptor) => ({
        path,
        cursor: descriptor.cursor,
      })),
    ),
    ...(loadMoreTreeTarget == null
      ? []
      : [{ path: loadMoreTreeTarget.path, cursor: loadMoreTreeTarget.cursor }]),
  ];
  let treeErrorResult: (typeof treeResults)[number] | undefined;
  for (const { path, cursor } of treeErrorPriority) {
    const key = `${path}\0${cursor ?? ""}`;
    if (!reachableTreeKeys.has(key)) continue;
    const result = treeResultByKey.get(key);
    if (result?.error == null || isCancelledError(result.error)) continue;
    treeErrorResult = result;
    break;
  }
  const searchErrorResult = searchQueryEntries
    .map((entry, index) => ({ entry, result: searchResults[index] }))
    .find(
      ({ entry, result }) =>
        entry.query === currentState.desiredSearchQuery &&
        reachableSearchKeys.has(`${entry.query}\0${entry.descriptor.cursor ?? ""}`) &&
        result?.error != null &&
        !isCancelledError(result.error),
    )?.result;
  const searchError =
    searchErrorResult?.error != null
      ? resolveUnknownErrorMessage(searchErrorResult.error, API_ERROR_MESSAGES.fileSearch)
      : null;
  const coldConnectionReason = !browserOnline
    ? OFFLINE_FILES_MESSAGE
    : !connected
      ? DISCONNECTED_FILES_MESSAGE
      : null;
  const fileModalFile = contentQuery?.data ?? null;
  const inferredViewMode =
    currentState.fileModalMarkdownViewMode ??
    (fileModalFile != null && (isHtmlContent(fileModalFile) || isMarkdownContent(fileModalFile))
      ? "preview"
      : "code");

  return {
    unavailable: scope.resolvedRoot == null,
    selectedFilePath: currentState.selectedFilePath,
    searchQuery: currentState.rawSearchQuery,
    searchActiveIndex: currentState.searchActiveIndex,
    searchResult,
    searchLoading:
      desiredHeadResult?.fetchStatus === "fetching" && desiredSearchResult == null && connected,
    searchError:
      searchError ??
      (desiredSearchResult == null && currentState.desiredSearchQuery != null
        ? coldConnectionReason
        : null),
    searchMode: searchExpandPlan.mode,
    treeLoading: treeRootResult?.fetchStatus === "fetching" && treePages["."] == null && connected,
    treeError:
      treeErrorResult?.error != null
        ? resolveUnknownErrorMessage(treeErrorResult.error, API_ERROR_MESSAGES.fileTree)
        : treePages["."] == null
          ? coldConnectionReason
          : null,
    treeNodes,
    rootTreeHasMore: loadMoreTreeTarget != null,
    searchHasMore:
      currentState.desiredSearchQuery === currentState.displayedSearchQuery &&
      Boolean(searchResult?.nextCursor),
    fileModalOpen: contentTarget != null,
    fileModalPath: contentTarget?.path ?? null,
    fileModalLoading:
      contentTarget != null && contentQuery?.fetchStatus === "fetching" && fileModalFile == null,
    fileModalError:
      contentQuery?.error != null && !isCancelledError(contentQuery.error)
        ? resolveUnknownErrorMessage(contentQuery.error, API_ERROR_MESSAGES.fileContent)
        : contentTarget != null && fileModalFile == null
          ? coldConnectionReason
          : null,
    fileModalFile,
    fileModalMarkdownViewMode: inferredViewMode,
    fileModalShowLineNumbers: currentState.fileModalShowLineNumbers,
    fileModalCopiedPath: currentState.fileModalCopiedPath,
    fileModalCopyError: currentState.fileModalCopyError,
    fileModalHighlightLine: contentTarget?.highlightLine ?? null,
    fileResolveError: currentState.fileResolveError,
    logFileCandidateModalOpen: currentState.logCandidate != null,
    logFileCandidateReference: currentState.logCandidate?.reference ?? null,
    logFileCandidatePaneId: currentState.logCandidate?.targetPaneId ?? null,
    logFileCandidateItems: currentState.logCandidate?.items ?? [],
    onRefresh,
    onSearchQueryChange,
    onSearchMove: (delta: number) =>
      setState((previous) => ({
        ...previous,
        searchActiveIndex: Math.max(
          0,
          Math.min((searchResult?.items.length ?? 1) - 1, previous.searchActiveIndex + delta),
        ),
      })),
    onSearchConfirm: () => {
      const item = searchResult?.items[currentState.searchActiveIndex];
      if (item == null) return;
      if (item.kind === "directory") {
        setState((previous) => {
          const expanded = new Set(previous.searchExpandedDirSet);
          const collapsed = new Set(previous.searchCollapsedDirSet);
          if (effectiveSearchExpandedDirSet.has(item.path)) {
            expanded.delete(item.path);
            collapsed.add(item.path);
          } else {
            collapsed.delete(item.path);
            expanded.add(item.path);
          }
          return { ...previous, searchExpandedDirSet: expanded, searchCollapsedDirSet: collapsed };
        });
      } else onOpenFileModal(item.path);
    },
    onToggleDirectory: (path: string) => {
      if (isSearchActive) {
        setState((previous) => {
          const expanded = new Set(previous.searchExpandedDirSet);
          const collapsed = new Set(previous.searchCollapsedDirSet);
          if (effectiveSearchExpandedDirSet.has(path)) {
            expanded.delete(path);
            collapsed.add(path);
          } else {
            collapsed.delete(path);
            expanded.add(path);
          }
          return { ...previous, searchExpandedDirSet: expanded, searchCollapsedDirSet: collapsed };
        });
        return;
      }
      const wasExpanded = currentState.expandedDirSet.has(path);
      setState((previous) => {
        const expandedDirSet = new Set(previous.expandedDirSet);
        if (expandedDirSet.has(path)) expandedDirSet.delete(path);
        else expandedDirSet.add(path);
        return { ...previous, expandedDirSet };
      });
      if (!wasExpanded) {
        retryOrAddTreeDescriptor(path, null, null);
      }
    },
    onSelectFile: (path: string) => {
      const normalized = normalizeRepoFilePath(path);
      if (normalized == null) return;
      setState((previous) => ({ ...previous, selectedFilePath: normalized }));
      revealFilePath(normalized);
    },
    onOpenFileModal,
    onCloseFileModal,
    onSetFileModalMarkdownViewMode,
    onToggleFileModalLineNumbers,
    onCopyFileModalPath,
    onResolveLogFileReference,
    onResolveLogFileReferenceCandidates,
    onSelectLogFileCandidate: (path: string) => {
      const candidate = currentState.logCandidate;
      if (candidate == null) return;
      setState((previous) => ({ ...previous, logCandidate: null }));
      openFileModalByPath(path, {
        paneId: candidate.targetPaneId,
        targetRoot: candidate.targetRoot,
        targetWorktreePath: candidate.targetRoot,
        origin: "log",
        highlightLine: candidate.line,
      });
    },
    onCloseLogFileCandidateModal: () =>
      setState((previous) => ({ ...previous, logCandidate: null })),
    onLoadMoreTreeRoot: () => {
      if (loadMoreTreeTarget == null) return;
      const descriptors = currentState.treeDescriptors[loadMoreTreeTarget.path] ?? [];
      retryOrAddTreeDescriptor(
        loadMoreTreeTarget.path,
        loadMoreTreeTarget.cursor,
        descriptors.at(-1)?.cursor ?? null,
      );
    },
    onLoadMoreSearch: () => {
      const desired = currentState.desiredSearchQuery;
      if (
        desired == null ||
        desired !== currentState.displayedSearchQuery ||
        searchResult?.nextCursor == null
      ) {
        return;
      }
      const descriptors = currentState.searchDescriptors[desired] ?? [];
      const existing = descriptors.find(
        (descriptor) => descriptor.cursor === searchResult.nextCursor,
      );
      if (existing != null) {
        const options = getSearchQueryOptions(desired, existing);
        if (queryClient.getQueryState(options.queryKey)?.status === "error") {
          void queryClient.refetchQueries({ queryKey: options.queryKey, exact: true });
        }
        return;
      }
      setState((previous) => {
        if (
          previous.searchDescriptors[desired]?.some(
            (descriptor) => descriptor.cursor === searchResult.nextCursor,
          )
        )
          return previous;
        return {
          ...previous,
          searchDescriptors: {
            ...previous.searchDescriptors,
            [desired]: [
              ...(previous.searchDescriptors[desired] ?? []),
              {
                cursor: searchResult.nextCursor ?? null,
                parentCursor: descriptors.at(-1)?.cursor ?? null,
                headDataUpdateCount: descriptors[0]?.headDataUpdateCount ?? 0,
              },
            ],
          },
        };
      });
    },
  };
};
