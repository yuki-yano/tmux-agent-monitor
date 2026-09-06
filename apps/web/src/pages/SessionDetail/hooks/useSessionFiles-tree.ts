import {
  CancelledError,
  isCancelledError,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import {
  type PageDescriptor,
  type TreeDescriptors,
  projectTreeQueryData,
  rootDescriptor,
  sameCursor,
} from "./session-files-query-projection";
import {
  type FilesScopeIdentity,
  normalizeRepoFilePath,
  sameFilesScope,
} from "./session-files-query-runtime";
import {
  buildNormalRenderNodes,
  collectAncestorDirectories,
  collectVisibleExpandedTreeDirectories,
  resolveTreeLoadMoreTarget,
} from "./session-files-tree-utils";
import type { UseSessionFilesParams } from "./useSessionFiles";

const TREE_PAGE_LIMIT = 200;
const createTreeState = (scope: FilesScopeIdentity) => ({
  scope,
  expandedDirSet: new Set<string>(),
  treeDescriptors: (scope.resolvedRoot == null
    ? {}
    : { ".": [rootDescriptor()] }) as TreeDescriptors,
});

export const useSessionFilesTree = ({
  scope,
  connected,
  selectedFilePath,
  coldConnectionReason,
  isCurrentScope,
  requestRepoFileTree,
}: {
  scope: FilesScopeIdentity;
  connected: boolean;
  selectedFilePath: string | null;
  coldConnectionReason: string | null;
  isCurrentScope: (scope: FilesScopeIdentity) => boolean;
  requestRepoFileTree: UseSessionFilesParams["requestRepoFileTree"];
}) => {
  const queryClient = useQueryClient();
  const paneId = scope.paneId;
  const [state, setState] = useState(() => createTreeState(scope));
  const scopeChanged = !sameFilesScope(state.scope, scope);
  const currentState = scopeChanged ? createTreeState(scope) : state;
  const getTreeQueryOptions = useCallback(
    (path: string, descriptor: PageDescriptor) => ({
      queryKey: sessionDetailQueryKeys.filesTree(paneId, {
        resolvedRoot: scope.resolvedRoot,
        worktreePath: scope.worktreePath,
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
  if (scopeChanged || treeDescriptorsChanged) {
    setState({
      ...currentState,
      treeDescriptors: treeDescriptorsChanged ? nextTreeDescriptors : currentState.treeDescriptors,
    });
  }

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
            if (!isCurrentScope(scope)) return;
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
    [connected, getTreeQueryOptions, isCurrentScope, queryClient, retryOrAddTreeDescriptor, scope],
  );

  const visibleExpandedDirSet = collectVisibleExpandedTreeDirectories({
    treePages,
    expandedDirSet: currentState.expandedDirSet,
  });
  const loadMoreTreeTarget = resolveTreeLoadMoreTarget({
    treePages,
    expandedDirSet: visibleExpandedDirSet,
  });
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
  const refresh = useCallback(() => {
    const rootHead = currentState.treeDescriptors["."]?.[0];
    if (rootHead == null) return;
    void queryClient.refetchQueries(
      { queryKey: getTreeQueryOptions(".", rootHead).queryKey, exact: true },
      { cancelRefetch: false },
    );
  }, [currentState.treeDescriptors, getTreeQueryOptions, queryClient]);

  return {
    getNodes: () =>
      buildNormalRenderNodes({
        treePages,
        expandedDirSet: currentState.expandedDirSet,
        selectedFilePath,
      }),
    loading: treeRootResult?.fetchStatus === "fetching" && treePages["."] == null && connected,
    error:
      treeErrorResult?.error != null
        ? resolveUnknownErrorMessage(treeErrorResult.error, API_ERROR_MESSAGES.fileTree)
        : treePages["."] == null
          ? coldConnectionReason
          : null,
    hasMore: loadMoreTreeTarget != null,
    revealFilePath,
    refresh,
    toggleDirectory: (path: string) => {
      const wasExpanded = currentState.expandedDirSet.has(path);
      setState((previous) => {
        const expandedDirSet = new Set(previous.expandedDirSet);
        if (expandedDirSet.has(path)) expandedDirSet.delete(path);
        else expandedDirSet.add(path);
        return { ...previous, expandedDirSet };
      });
      if (!wasExpanded) retryOrAddTreeDescriptor(path, null, null);
    },
    loadMore: () => {
      if (loadMoreTreeTarget == null) return;
      const descriptors = currentState.treeDescriptors[loadMoreTreeTarget.path] ?? [];
      retryOrAddTreeDescriptor(
        loadMoreTreeTarget.path,
        loadMoreTreeTarget.cursor,
        descriptors.at(-1)?.cursor ?? null,
      );
    },
  };
};
