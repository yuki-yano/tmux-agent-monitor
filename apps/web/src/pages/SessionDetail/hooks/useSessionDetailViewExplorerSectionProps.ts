import { useCallback, useMemo } from "react";

import { useSessionDetailContext } from "../SessionDetailProvider";
import { resolveSessionFileRoot, sumFileStats } from "../sessionDetailUtils";
import { useScreenPanelState } from "./useScreenPanelState";

export const useSessionDetailViewExplorerSectionProps = () => {
  const { base, diffs, files, terminal, logsActions } = useSessionDetailContext();
  const screen = useScreenPanelState();
  const { paneId, session, connectionIssue, resolvedTheme, launchConfig, capabilities } = base;
  const { handleLaunchAgentInSession } = logsActions.actions;
  const {
    mode,
    wrapMode,
    screenLines,
    imageBase64,
    fallbackReason,
    error,
    sendError,
    pollingPauseReason,
    isScreenLoading,
    isAtBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    shouldFollowOutput,
    scrollToBottom,
    handleModeChange,
    toggleWrapMode,
    viewportRef,
    scrollerRef,
    handleRefreshScreen,
    handleRefreshWorktrees,
    effectiveBranch,
    effectiveWorktreePath,
    worktreeRepoRoot,
    worktreeBaseBranch,
    worktreeSelectorEnabled,
    worktreeSelectorLoading,
    worktreeSelectorError,
    worktreeEntries,
    actualWorktreePath,
    virtualWorktreePath,
    selectVirtualWorktree,
    clearVirtualWorktree,
    notificationStatus,
    notificationPushEnabled,
    notificationSubscribed,
    notificationPaneEnabled,
    notificationErrorMessage,
    requestNotificationPermission,
    togglePaneNotification,
  } = screen;
  const sourceRepoRoot = resolveSessionFileRoot(session, effectiveWorktreePath);
  const screenAgent = session?.agent ?? "unknown";
  const { diffSummary, diffError, diffFiles, diffLoadingFiles, ensureDiffFile } = diffs;
  const { rawMode, allowDangerKeys } = terminal.controls;
  const {
    unavailable,
    selectedFilePath,
    searchQuery,
    searchActiveIndex,
    searchResult,
    searchLoading,
    searchError,
    searchMode,
    treeLoading,
    treeError,
    treeNodes,
    rootTreeHasMore,
    searchHasMore,
    fileModalOpen,
    fileModalPath,
    fileModalLoading,
    fileModalError,
    fileModalFile,
    fileModalMarkdownViewMode,
    fileModalShowLineNumbers,
    fileModalCopiedPath,
    fileModalCopyError,
    fileModalHighlightLine,
    fileResolveError,
    logFileCandidateModalOpen,
    logFileCandidateReference,
    logFileCandidateItems,
    onRefresh,
    onSearchQueryChange,
    onSearchMove,
    onSearchConfirm,
    onToggleDirectory,
    onSelectFile,
    onOpenFileModal,
    onCloseFileModal,
    onSetFileModalMarkdownViewMode,
    onToggleFileModalLineNumbers,
    onCopyFileModalPath,
    onResolveLogFileReference,
    onResolveLogFileReferenceCandidates,
    onSelectLogFileCandidate,
    onCloseLogFileCandidateModal,
    onLoadMoreTreeRoot,
    onLoadMoreSearch,
  } = files;
  const diffPathSet = useMemo(
    () => new Set(diffSummary?.files.map((file) => file.path) ?? []),
    [diffSummary],
  );
  const fileModalDiffAvailable = fileModalPath != null && diffPathSet.has(fileModalPath);
  const fileModalDiffPatch = fileModalPath ? (diffFiles[fileModalPath]?.patch ?? null) : null;
  const fileModalDiffBinary = fileModalPath ? Boolean(diffFiles[fileModalPath]?.binary) : false;
  const fileModalDiffLoading = fileModalPath ? Boolean(diffLoadingFiles[fileModalPath]) : false;
  const fileModalDiffError = fileModalDiffAvailable ? diffError : null;
  const onLoadFileModalDiff = useCallback(
    (path: string) => {
      if (!diffPathSet.has(path)) {
        return;
      }
      void ensureDiffFile(path);
    },
    [diffPathSet, ensureDiffFile],
  );
  const promptGitContext = useMemo(() => {
    const totals = sumFileStats(diffSummary?.files);
    const fileChanges = diffSummary
      ? diffSummary.files.reduce(
          (counts, file) => {
            if (file.status === "A") {
              counts.add += 1;
              return counts;
            }
            if (file.status === "?") {
              counts.add += 1;
              return counts;
            }
            if (file.status === "D") {
              counts.d += 1;
              return counts;
            }
            counts.m += 1;
            return counts;
          },
          { add: 0, m: 0, d: 0 },
        )
      : null;
    return {
      branch: effectiveBranch ?? session?.branch ?? null,
      fileChanges,
      additions: totals?.additions ?? null,
      deletions: totals?.deletions ?? null,
    };
  }, [diffSummary, effectiveBranch, session?.branch]);

  const fileNavigatorSectionProps = useMemo(
    () => ({
      state: {
        unavailable,
        selectedFilePath,
        searchQuery,
        searchActiveIndex,
        searchResult,
        searchLoading,
        searchError,
        searchMode,
        treeLoading,
        treeError,
        treeNodes,
        rootTreeHasMore,
        searchHasMore,
      },
      actions: {
        onRefresh,
        onSearchQueryChange,
        onSearchMove,
        onSearchConfirm,
        onToggleDirectory,
        onSelectFile,
        onOpenFileModal,
        onLoadMoreTreeRoot,
        onLoadMoreSearch,
      },
    }),
    [
      unavailable,
      selectedFilePath,
      searchQuery,
      searchActiveIndex,
      searchResult,
      searchLoading,
      searchError,
      searchMode,
      treeLoading,
      treeError,
      treeNodes,
      rootTreeHasMore,
      searchHasMore,
      onRefresh,
      onSearchQueryChange,
      onSearchMove,
      onSearchConfirm,
      onToggleDirectory,
      onSelectFile,
      onOpenFileModal,
      onLoadMoreTreeRoot,
      onLoadMoreSearch,
    ],
  );

  const fileContentModalProps = useMemo(
    () => ({
      state: {
        open: fileModalOpen,
        path: fileModalPath,
        loading: fileModalLoading,
        error: fileModalError,
        file: fileModalFile,
        markdownViewMode: fileModalMarkdownViewMode,
        diffAvailable: fileModalDiffAvailable,
        diffLoading: fileModalDiffLoading,
        diffPatch: fileModalDiffPatch,
        diffBinary: fileModalDiffBinary,
        diffError: fileModalDiffError,
        showLineNumbers: fileModalShowLineNumbers,
        copiedPath: fileModalCopiedPath,
        copyError: fileModalCopyError,
        highlightLine: fileModalHighlightLine,
        theme: resolvedTheme,
      },
      actions: {
        onClose: onCloseFileModal,
        onToggleLineNumbers: onToggleFileModalLineNumbers,
        onCopyPath: onCopyFileModalPath,
        onMarkdownViewModeChange: onSetFileModalMarkdownViewMode,
        onLoadDiff: onLoadFileModalDiff,
      },
    }),
    [
      fileModalOpen,
      fileModalPath,
      fileModalLoading,
      fileModalError,
      fileModalFile,
      fileModalMarkdownViewMode,
      fileModalDiffAvailable,
      fileModalDiffLoading,
      fileModalDiffPatch,
      fileModalDiffBinary,
      fileModalDiffError,
      fileModalShowLineNumbers,
      fileModalCopiedPath,
      fileModalCopyError,
      fileModalHighlightLine,
      resolvedTheme,
      onCloseFileModal,
      onToggleFileModalLineNumbers,
      onCopyFileModalPath,
      onSetFileModalMarkdownViewMode,
      onLoadFileModalDiff,
    ],
  );

  const handleResolveFileReference = useCallback(
    (rawToken: string) =>
      onResolveLogFileReference({
        rawToken,
        sourcePaneId: paneId,
        sourceRepoRoot,
      }),
    [onResolveLogFileReference, paneId, sourceRepoRoot],
  );

  const handleResolveFileReferenceCandidates = useCallback(
    (rawTokens: string[]) =>
      onResolveLogFileReferenceCandidates({
        rawTokens,
        sourcePaneId: paneId,
        sourceRepoRoot,
      }),
    [onResolveLogFileReferenceCandidates, paneId, sourceRepoRoot],
  );

  const screenPanelProps = useMemo(
    () => ({
      state: {
        mode,
        wrapMode,
        sessionName: session?.sessionName ?? "unknown",
        paneId,
        sourceRepoRoot,
        agent: screenAgent,
        connectionIssue,
        fallbackReason,
        error,
        sendError,
        pollingPauseReason,
        promptGitContext,
        isScreenLoading,
        imageBase64,
        screenLines,
        viewportRef,
        scrollerRef,
        isAtBottom,
        shouldFollowOutput,
        rawMode,
        allowDangerKeys,
        fileResolveError,
        worktreeSelectorEnabled,
        worktreeSelectorLoading,
        worktreeSelectorError,
        worktreeEntries,
        worktreeRepoRoot,
        worktreeBaseBranch,
        actualWorktreePath,
        virtualWorktreePath,
        sourceSession: session ?? null,
        launchConfig,
        screenImageAvailable: capabilities.screenImage,
        resumeAgentAvailable: capabilities.resumeAgent,
        notificationStatus,
        notificationPushEnabled,
        notificationSubscribed,
        notificationPaneEnabled,
        notificationErrorMessage,
      },
      actions: {
        onModeChange: handleModeChange,
        onToggleWrapMode: toggleWrapMode,
        onRefresh: handleRefreshScreen,
        onRefreshWorktrees: () => {
          void handleRefreshWorktrees();
        },
        onAtBottomChange: handleAtBottomChange,
        onScrollToBottom: scrollToBottom,
        onUserScrollStateChange: handleUserScrollStateChange,
        onSelectVirtualWorktree: selectVirtualWorktree,
        onClearVirtualWorktree: clearVirtualWorktree,
        onRequestNotificationPermission: () => {
          void requestNotificationPermission?.();
        },
        onTogglePaneNotification: () => {
          void togglePaneNotification?.();
        },
        onLaunchAgentInSession: handleLaunchAgentInSession,
        onResolveFileReference: handleResolveFileReference,
        onResolveFileReferenceCandidates: handleResolveFileReferenceCandidates,
      },
    }),
    [
      mode,
      wrapMode,
      paneId,
      sourceRepoRoot,
      screenAgent,
      connectionIssue,
      fallbackReason,
      error,
      sendError,
      pollingPauseReason,
      promptGitContext,
      isScreenLoading,
      imageBase64,
      screenLines,
      viewportRef,
      scrollerRef,
      isAtBottom,
      shouldFollowOutput,
      rawMode,
      allowDangerKeys,
      fileResolveError,
      worktreeSelectorEnabled,
      worktreeSelectorLoading,
      worktreeSelectorError,
      worktreeEntries,
      worktreeRepoRoot,
      worktreeBaseBranch,
      actualWorktreePath,
      virtualWorktreePath,
      session,
      launchConfig,
      capabilities.screenImage,
      capabilities.resumeAgent,
      notificationStatus,
      notificationPushEnabled,
      notificationSubscribed,
      notificationPaneEnabled,
      notificationErrorMessage,
      handleLaunchAgentInSession,
      handleModeChange,
      handleRefreshScreen,
      handleRefreshWorktrees,
      handleAtBottomChange,
      scrollToBottom,
      handleUserScrollStateChange,
      selectVirtualWorktree,
      clearVirtualWorktree,
      requestNotificationPermission,
      togglePaneNotification,
      toggleWrapMode,
      handleResolveFileReference,
      handleResolveFileReferenceCandidates,
    ],
  );

  const logFileCandidateModalProps = useMemo(
    () => ({
      state: {
        open: logFileCandidateModalOpen,
        reference: logFileCandidateReference,
        items: logFileCandidateItems,
      },
      actions: {
        onClose: onCloseLogFileCandidateModal,
        onSelect: onSelectLogFileCandidate,
      },
    }),
    [
      logFileCandidateModalOpen,
      logFileCandidateReference,
      logFileCandidateItems,
      onCloseLogFileCandidateModal,
      onSelectLogFileCandidate,
    ],
  );

  return {
    fileNavigatorSectionProps,
    fileContentModalProps,
    screenPanelProps,
    logFileCandidateModalProps,
  };
};
