import {
  CancelledError,
  isCancelledError,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { buildSearchExpandPlan } from "../file-tree-search-expand";
import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import {
  type PageDescriptor,
  type SearchDescriptors,
  projectSearchQueryData,
  rootDescriptor,
} from "./session-files-query-projection";
import {
  type FilesScopeIdentity,
  normalizeFilesQuery,
  sameFilesScope,
} from "./session-files-query-runtime";
import { buildSearchRenderNodes } from "./session-files-tree-utils";
import type { UseSessionFilesParams } from "./useSessionFiles";

const SEARCH_PAGE_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 120;
const createSearchState = (scope: FilesScopeIdentity) => ({
  scope,
  rawSearchQuery: "",
  desiredSearchQuery: null as string | null,
  displayedSearchQuery: null as string | null,
  searchActiveIndex: 0,
  searchExpandedDirSet: new Set<string>(),
  searchCollapsedDirSet: new Set<string>(),
  searchDescriptors: {} as SearchDescriptors,
});
const treeScopeParams = (scope: FilesScopeIdentity) => ({
  resolvedRoot: scope.resolvedRoot,
  worktreePath: scope.worktreePath,
});

export const useSessionFilesSearch = ({
  scope,
  connected,
  selectedFilePath,
  autoExpandMatchLimit,
  coldConnectionReason,
  requestRepoFileSearch,
}: {
  scope: FilesScopeIdentity;
  connected: boolean;
  selectedFilePath: string | null;
  autoExpandMatchLimit: number;
  coldConnectionReason: string | null;
  requestRepoFileSearch: UseSessionFilesParams["requestRepoFileSearch"];
}) => {
  const queryClient = useQueryClient();
  const paneId = scope.paneId;
  const [state, setState] = useState(() => createSearchState(scope));
  const scopeChanged = !sameFilesScope(state.scope, scope);
  const currentState = scopeChanged ? createSearchState(scope) : state;
  const searchTimerRef = useRef<number | null>(null);
  useLayoutEffect(
    () => () => {
      if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    },
    [scope],
  );

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
    displayedSearchChanged ||
    searchDescriptorsChanged ||
    clampedSearchActiveIndex !== currentState.searchActiveIndex
  ) {
    const reconciledState = {
      ...currentState,
      displayedSearchQuery: reconciledDisplayedSearchQuery,
      searchActiveIndex: clampedSearchActiveIndex,
      searchDescriptors: searchDescriptorsChanged
        ? nextSearchDescriptors
        : currentState.searchDescriptors,
    };
    setState(() => reconciledState);
  }

  const onSearchQueryChange = (value: string) => {
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
  };
  const searchResult = displayedSearchResult;
  const searchExpandPlan = buildSearchExpandPlan({
    matchedPaths: searchResult?.items.map((item) => item.path) ?? [],
    activeIndex: currentState.searchActiveIndex,
    autoExpandMatchLimit,
    truncated: searchResult?.truncated ?? false,
    totalMatchedCount: searchResult?.totalMatchedCount ?? 0,
  });
  const effectiveSearchExpandedDirSet = new Set(searchExpandPlan.expandedDirSet);
  for (const path of currentState.searchExpandedDirSet) effectiveSearchExpandedDirSet.add(path);
  for (const path of currentState.searchCollapsedDirSet) effectiveSearchExpandedDirSet.delete(path);
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
  const desiredHeadResult =
    currentState.desiredSearchQuery == null
      ? null
      : searchResultByKey.get(`${currentState.desiredSearchQuery}\0`);
  const refresh = () => {
    const desired = currentState.desiredSearchQuery;
    const searchHead = desired == null ? null : currentState.searchDescriptors[desired]?.[0];
    if (desired == null || searchHead == null) return;
    void queryClient.refetchQueries(
      { queryKey: getSearchQueryOptions(desired, searchHead).queryKey, exact: true },
      { cancelRefetch: false },
    );
  };

  return {
    query: currentState.rawSearchQuery,
    active: normalizeFilesQuery(currentState.rawSearchQuery) !== "",
    activeIndex: currentState.searchActiveIndex,
    activeItem: searchResult?.items[currentState.searchActiveIndex] ?? null,
    result: searchResult,
    mode: searchExpandPlan.mode,
    nodes: buildSearchRenderNodes({
      searchItems: searchResult?.items ?? [],
      selectedFilePath,
      activeMatchPath: searchResult?.items[currentState.searchActiveIndex]?.path ?? null,
      expandedDirSet: effectiveSearchExpandedDirSet,
    }),
    loading:
      desiredHeadResult?.fetchStatus === "fetching" && desiredSearchResult == null && connected,
    error:
      searchError ??
      (desiredSearchResult == null && currentState.desiredSearchQuery != null
        ? coldConnectionReason
        : null),
    hasMore:
      currentState.desiredSearchQuery === currentState.displayedSearchQuery &&
      Boolean(searchResult?.nextCursor),
    changeQuery: onSearchQueryChange,
    refresh,
    move: (delta: number) =>
      setState((previous) => ({
        ...previous,
        searchActiveIndex: Math.max(
          0,
          Math.min((searchResult?.items.length ?? 1) - 1, previous.searchActiveIndex + delta),
        ),
      })),
    toggleDirectory: (path: string) => {
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
    },
    loadMore: () => {
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
