import { isCancelledError, onlineManager, useQueryClient } from "@tanstack/react-query";
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
import { createFilesLocalState } from "./session-files-local-state";
import {
  advanceFilesLookupGeneration,
  createFilesLookupController,
  resetFilesLookupController,
} from "./session-files-lookup-runtime";
import {
  type ContentTarget,
  type FilesScopeIdentity,
  createCommittedFilesLifetimeRef,
  createContentQueryCleanupCoordinator,
  createPreviewLeaseController,
  normalizeRepoFilePath,
  registerFilesOwner,
  sameFilesScope,
  unregisterFilesOwner,
} from "./session-files-query-runtime";
import { useSessionFilesContentQuery } from "./useSessionFiles-content-query";
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
import { useSessionFilesModalState } from "./useSessionFiles-modal-state";
import { useSessionFilesSearch } from "./useSessionFiles-search";
import { useSessionFilesTree } from "./useSessionFiles-tree";

export type { LogFileCandidateItem } from "./useSessionFiles-lookup-actions";

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
  const modal = useSessionFilesModalState(scope);
  const [committedLifetimeRef] = useState(createCommittedFilesLifetimeRef);
  const [previewLeases] = useState(() => createPreviewLeaseController(revokeRepoFilePreview));
  const [contentCleanup] = useState(createContentQueryCleanupCoordinator);
  const [copyController] = useState(createFileModalCopyController);
  const [lookupController] = useState(createFilesLookupController);
  const previousScopeRef = useRef(scope);
  const previousConnectedRef = useRef(connected);
  const previousContentTargetRef = useRef<ContentTarget | null>(null);

  const scopeChanged = !sameFilesScope(state.scope, scope);
  const currentState = scopeChanged ? createFilesLocalState(scope) : state;
  if (scopeChanged) setState(currentState);

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
    const lifetime = { scope, connected, contentTarget: modal.contentTarget };
    committedLifetimeRef.commit(lifetime);
    syncActiveContentTarget(copyController, modal.contentTarget);
    if (!sameFilesScope(previousScope, scope)) {
      resetFilesLookupController(lookupController);
      contentCleanup.cancelReopens();
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
      if (modal.contentTarget != null) {
        void queryClient.cancelQueries({
          queryKey: getContentQueryKey(modal.contentTarget),
          exact: true,
        });
      }
    }
    previousScopeRef.current = scope;
    previousConnectedRef.current = connected;
    previousContentTargetRef.current = modal.contentTarget;
    return () => committedLifetimeRef.clear(lifetime);
  }, [
    committedLifetimeRef,
    connected,
    contentCleanup,
    copyController,
    modal.contentTarget,
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

  const coldConnectionReason = !browserOnline
    ? OFFLINE_FILES_MESSAGE
    : !connected
      ? DISCONNECTED_FILES_MESSAGE
      : null;
  const isCurrentScope = useCallback(
    (candidate: FilesScopeIdentity) => sameFilesScope(candidate, previousScopeRef.current),
    [],
  );
  const tree = useSessionFilesTree({
    scope,
    connected,
    selectedFilePath: currentState.selectedFilePath,
    coldConnectionReason,
    isCurrentScope,
    requestRepoFileTree,
  });
  const search = useSessionFilesSearch({
    scope,
    connected,
    selectedFilePath: currentState.selectedFilePath,
    autoExpandMatchLimit,
    coldConnectionReason,
    requestRepoFileSearch,
  });
  const { revealFilePath, refresh: refreshTree } = tree;
  const { refresh: refreshSearch } = search;

  const contentTarget = modal.contentTarget;
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

  const selectNavigatorFile = useCallback(
    (path: string) => {
      setState((previous) => ({ ...previous, selectedFilePath: path }));
      revealFilePath(path);
    },
    [revealFilePath],
  );
  const reportResolveError = useCallback((message: string) => {
    setState((previous) => ({ ...previous, fileResolveError: message }));
  }, []);

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
    modal,
    getContentQueryKey,
    paneId,
    previewLeases,
    selectNavigatorFile,
    reportResolveError,
    scope,
  });

  const onRefresh = useCallback(() => {
    resetFilesLookupController(lookupController);
    void queryClient.cancelQueries({ queryKey: lookupRootKey });
    queryClient.removeQueries({ queryKey: lookupRootKey, type: "inactive" });
    refreshTree();
    refreshSearch();
  }, [lookupController, lookupRootKey, queryClient, refreshTree, refreshSearch]);

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

  const fileModalFile = contentQuery?.data ?? null;
  const inferredViewMode =
    modal.viewMode ??
    (fileModalFile != null && (isHtmlContent(fileModalFile) || isMarkdownContent(fileModalFile))
      ? "preview"
      : "code");

  return {
    unavailable: scope.resolvedRoot == null,
    selectedFilePath: currentState.selectedFilePath,
    searchQuery: search.query,
    searchActiveIndex: search.activeIndex,
    searchResult: search.result,
    searchLoading: search.loading,
    searchError: search.error,
    searchMode: search.mode,
    treeLoading: tree.loading,
    treeError: tree.error,
    treeNodes: search.active ? search.nodes : tree.getNodes(),
    rootTreeHasMore: tree.hasMore,
    searchHasMore: search.hasMore,
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
    fileModalShowLineNumbers: modal.showLineNumbers,
    fileModalCopiedPath: modal.copiedPath,
    fileModalCopyError: modal.copyError,
    fileModalHighlightLine: contentTarget?.highlightLine ?? null,
    fileResolveError: currentState.fileResolveError,
    logFileCandidateModalOpen: currentState.logCandidate != null,
    logFileCandidateReference: currentState.logCandidate?.reference ?? null,
    logFileCandidatePaneId: currentState.logCandidate?.targetPaneId ?? null,
    logFileCandidateItems: currentState.logCandidate?.items ?? [],
    onRefresh,
    onSearchQueryChange: search.changeQuery,
    onSearchMove: search.move,
    onSearchConfirm: () => {
      const item = search.activeItem;
      if (item == null) return;
      if (item.kind === "directory") search.toggleDirectory(item.path);
      else onOpenFileModal(item.path);
    },
    onToggleDirectory: search.active ? search.toggleDirectory : tree.toggleDirectory,
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
    onLoadMoreTreeRoot: tree.loadMore,
    onLoadMoreSearch: search.loadMore,
  };
};
