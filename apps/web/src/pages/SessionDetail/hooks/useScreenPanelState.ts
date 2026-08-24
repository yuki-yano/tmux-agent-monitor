import { useMemo } from "react";

import { useSessionDetailContext } from "../SessionDetailProvider";

// Dedicated ScreenPanel state hook. This is the single place that reshapes the
// screen/worktree-selector/notification subhook outputs into the flat,
// disambiguated shape ScreenPanel expects, replacing the ad-hoc renaming that
// used to live inline inside the God Hook. Branch/worktree section state is not
// ScreenPanel's concern and is projected by those sections' connected entries.
// This hook should only ever be called from
// useSessionDetailViewExplorerSectionProps (ScreenPanel's props builder) so the
// underlying screen/controls subhooks are read from a single call site.
export const useScreenPanelState = () => {
  const { terminal, scope, pushNotifications } = useSessionDetailContext();
  const { screen, controls, handleRefreshScreen } = terminal;
  const { virtualWorktree } = scope;

  return useMemo(
    () => ({
      mode: screen.mode,
      wrapMode: screen.wrapMode,
      screenLines: screen.screenLines,
      imageBase64: screen.imageBase64,
      fallbackReason: screen.fallbackReason,
      error: screen.error,
      sendError: controls.sendError,
      pollingPauseReason: screen.pollingPauseReason,
      isScreenLoading: screen.isScreenLoading,
      isAtBottom: screen.isAtBottom,
      handleAtBottomChange: screen.handleAtBottomChange,
      handleUserScrollStateChange: screen.handleUserScrollStateChange,
      shouldFollowOutput: screen.shouldFollowOutput,
      scrollToBottom: screen.scrollToBottom,
      handleModeChange: screen.handleModeChange,
      toggleWrapMode: screen.toggleWrapMode,
      viewportRef: screen.viewportRef,
      scrollerRef: screen.scrollerRef,
      handleRefreshScreen,
      handleRefreshWorktrees: virtualWorktree.refreshWorktrees,
      effectiveBranch: virtualWorktree.effectiveBranch,
      effectiveWorktreePath: virtualWorktree.effectiveWorktreePath,
      worktreeRepoRoot: virtualWorktree.repoRoot,
      worktreeBaseBranch: virtualWorktree.baseBranch,
      worktreeSelectorEnabled: virtualWorktree.selectorEnabled,
      worktreeSelectorLoading: virtualWorktree.loading,
      worktreeSelectorError: virtualWorktree.error,
      worktreeEntries: virtualWorktree.entries,
      actualWorktreePath: virtualWorktree.actualWorktreePath,
      virtualWorktreePath: virtualWorktree.virtualWorktreePath,
      selectVirtualWorktree: scope.selectVirtualWorktree,
      clearVirtualWorktree: virtualWorktree.clearVirtualWorktree,
      notificationStatus: pushNotifications.status,
      notificationPushEnabled: pushNotifications.pushEnabled,
      notificationSubscribed: pushNotifications.isSubscribed,
      notificationPaneEnabled: pushNotifications.isPaneEnabled,
      notificationErrorMessage: pushNotifications.errorMessage,
      requestNotificationPermission: pushNotifications.requestPermissionAndSubscribe,
      togglePaneNotification: pushNotifications.togglePaneEnabled,
    }),
    [screen, controls, handleRefreshScreen, virtualWorktree, scope, pushNotifications],
  );
};
