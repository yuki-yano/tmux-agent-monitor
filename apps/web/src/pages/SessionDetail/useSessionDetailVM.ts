import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { buildSessionGroups } from "@/lib/session-group";
import { useMediaQuery } from "@/lib/use-media-query";
import { useNowMs } from "@/lib/use-now-ms";
import { useSidebarWidth } from "@/lib/use-sidebar-width";
import { useSplitRatio } from "@/lib/use-split-ratio";
import { useSessions } from "@/state/session-context";
import { useTheme } from "@/state/theme-context";

import { useSessionCommits } from "./hooks/useSessionCommits";
import { useSessionControls } from "./hooks/useSessionControls";
import { useSessionDiffs } from "./hooks/useSessionDiffs";
import { useSessionLogs } from "./hooks/useSessionLogs";
import { useSessionScreen } from "./hooks/useSessionScreen";
import { useSessionTitleEditor } from "./hooks/useSessionTitleEditor";

export const useSessionDetailVM = (paneId: string) => {
  const {
    sessions,
    connected,
    connectionIssue,
    getSessionDetail,
    reconnect,
    requestCommitDetail,
    requestCommitFile,
    requestCommitLog,
    requestDiffFile,
    requestDiffSummary,
    requestScreen,
    sendText,
    sendKeys,
    sendRaw,
    touchSession,
    updateSessionTitle,
    readOnly,
    highlightCorrections,
  } = useSessions();
  const { resolvedTheme } = useTheme();
  const session = getSessionDetail(paneId);
  const navigate = useNavigate();
  const nowMs = useNowMs();

  const {
    mode,
    screenLines,
    imageBase64,
    fallbackReason,
    error,
    setScreenError,
    isScreenLoading,
    isAtBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    forceFollow,
    refreshScreen,
    scrollToBottom,
    handleModeChange,
    virtuosoRef,
    scrollerRef,
  } = useSessionScreen({
    paneId,
    connected,
    connectionIssue,
    requestScreen,
    resolvedTheme,
    agent: session?.agent,
    highlightCorrections,
  });

  const {
    textInputRef,
    autoEnter,
    shiftHeld,
    ctrlHeld,
    controlsOpen,
    rawMode,
    allowDangerKeys,
    handleSendKey,
    handleSendText,
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
    toggleAutoEnter,
    toggleControls,
    toggleShift,
    toggleCtrl,
    toggleRawMode,
    toggleAllowDangerKeys,
  } = useSessionControls({
    paneId,
    readOnly,
    mode,
    sendText,
    sendKeys,
    sendRaw,
    setScreenError,
    scrollToBottom,
  });

  const {
    diffSummary,
    diffError,
    diffLoading,
    diffFiles,
    diffOpen,
    diffLoadingFiles,
    refreshDiff,
    toggleDiff,
  } = useSessionDiffs({
    paneId,
    connected,
    requestDiffSummary,
    requestDiffFile,
  });

  const {
    commitLog,
    commitError,
    commitLoading,
    commitLoadingMore,
    commitHasMore,
    commitDetails,
    commitFileDetails,
    commitFileOpen,
    commitFileLoading,
    commitOpen,
    commitLoadingDetails,
    copiedHash,
    refreshCommitLog,
    loadMoreCommits,
    toggleCommit,
    toggleCommitFile,
    copyHash,
  } = useSessionCommits({
    paneId,
    connected,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
  });

  const {
    quickPanelOpen,
    logModalOpen,
    selectedPaneId,
    selectedSession,
    selectedLogLines,
    selectedLogLoading,
    selectedLogError,
    openLogModal,
    closeLogModal,
    toggleQuickPanel,
    closeQuickPanel,
  } = useSessionLogs({
    connected,
    connectionIssue,
    sessions,
    requestScreen,
    resolvedTheme,
    highlightCorrections,
  });

  const {
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    openTitleEditor,
    closeTitleEditor,
    updateTitleDraft,
    saveTitle,
    clearTitle,
  } = useSessionTitleEditor({
    session,
    paneId,
    readOnly,
    updateSessionTitle,
  });

  const sessionGroups = useMemo(() => buildSessionGroups(sessions), [sessions]);
  const is2xlUp = useMediaQuery("(min-width: 1536px)");
  const { sidebarWidth, handlePointerDown: handleSidebarPointerDown } = useSidebarWidth();
  const {
    ratio: detailSplitRatio,
    containerRef: detailSplitRef,
    handlePointerDown: handleDetailSplitPointerDown,
  } = useSplitRatio({
    storageKey: "vde.detail.split",
    defaultRatio: 0.5,
    minRatio: 0.35,
    maxRatio: 0.65,
  });

  const handleRefreshScreen = useCallback(() => {
    if (connected) {
      void refreshScreen();
    } else {
      reconnect();
    }
  }, [connected, reconnect, refreshScreen]);

  const handleOpenInNewTab = useCallback(() => {
    if (!selectedPaneId) return;
    const encoded = encodeURIComponent(selectedPaneId);
    window.open(`/sessions/${encoded}`, "_blank", "noopener,noreferrer");
  }, [selectedPaneId]);

  const handleTouchSession = useCallback(() => {
    void touchSession(paneId).catch(() => null);
  }, [paneId, touchSession]);

  const handleOpenHere = useCallback(() => {
    if (!selectedPaneId) return;
    closeQuickPanel();
    navigate({ to: "/sessions/$paneId", params: { paneId: selectedPaneId } });
    closeLogModal();
  }, [closeLogModal, closeQuickPanel, navigate, selectedPaneId]);

  return {
    paneId,
    session,
    sessionGroups,
    nowMs,
    connected,
    connectionIssue,
    readOnly,
    is2xlUp,
    sidebarWidth,
    handleSidebarPointerDown,
    detailSplitRatio,
    detailSplitRef,
    handleDetailSplitPointerDown,
    mode,
    screenLines,
    imageBase64,
    fallbackReason,
    error,
    isScreenLoading,
    isAtBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    forceFollow,
    scrollToBottom,
    handleModeChange,
    virtuosoRef,
    scrollerRef,
    handleRefreshScreen,
    textInputRef,
    autoEnter,
    shiftHeld,
    ctrlHeld,
    controlsOpen,
    rawMode,
    allowDangerKeys,
    handleSendKey,
    handleSendText,
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
    toggleAutoEnter,
    toggleControls,
    toggleShift,
    toggleCtrl,
    toggleRawMode,
    toggleAllowDangerKeys,
    handleTouchSession,
    diffSummary,
    diffError,
    diffLoading,
    diffFiles,
    diffOpen,
    diffLoadingFiles,
    refreshDiff,
    toggleDiff,
    commitLog,
    commitError,
    commitLoading,
    commitLoadingMore,
    commitHasMore,
    commitDetails,
    commitFileDetails,
    commitFileOpen,
    commitFileLoading,
    commitOpen,
    commitLoadingDetails,
    copiedHash,
    refreshCommitLog,
    loadMoreCommits,
    toggleCommit,
    toggleCommitFile,
    copyHash,
    quickPanelOpen,
    logModalOpen,
    selectedSession,
    selectedLogLines,
    selectedLogLoading,
    selectedLogError,
    openLogModal,
    closeLogModal,
    toggleQuickPanel,
    closeQuickPanel,
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    openTitleEditor,
    closeTitleEditor,
    updateTitleDraft,
    saveTitle,
    clearTitle,
    handleOpenHere,
    handleOpenInNewTab,
  };
};

export type SessionDetailVM = ReturnType<typeof useSessionDetailVM>;
