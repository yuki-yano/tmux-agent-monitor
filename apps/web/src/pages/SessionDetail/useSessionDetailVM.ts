import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { buildSessionGroups } from "@/lib/session-group";
import { useMediaQuery } from "@/lib/use-media-query";
import { useNowMs } from "@/lib/use-now-ms";
import { useSidebarWidth } from "@/lib/use-sidebar-width";
import { useSplitRatio } from "@/lib/use-split-ratio";

import {
  connectedAtom,
  connectionIssueAtom,
  connectionStatusAtom,
  currentSessionAtom,
  highlightCorrectionsAtom,
  resolvedThemeAtom,
  sessionApiAtom,
  sessionsAtom,
} from "./atoms/sessionDetailAtoms";
import { useSessionCommits } from "./hooks/useSessionCommits";
import { useSessionControls } from "./hooks/useSessionControls";
import { useSessionDiffs } from "./hooks/useSessionDiffs";
import { useSessionLogs } from "./hooks/useSessionLogs";
import { useSessionScreen } from "./hooks/useSessionScreen";
import { useSessionTimeline } from "./hooks/useSessionTimeline";
import { useSessionTitleEditor } from "./hooks/useSessionTitleEditor";

export const useSessionDetailVM = (paneId: string) => {
  const sessions = useAtomValue(sessionsAtom);
  const connected = useAtomValue(connectedAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const connectionIssue = useAtomValue(connectionIssueAtom);
  const highlightCorrections = useAtomValue(highlightCorrectionsAtom);
  const resolvedTheme = useAtomValue(resolvedThemeAtom);
  const session = useAtomValue(currentSessionAtom);
  const sessionApi = useAtomValue(sessionApiAtom);
  if (!sessionApi) {
    throw new Error("SessionDetailProvider is required");
  }
  const {
    requestCommitDetail,
    requestCommitFile,
    requestCommitLog,
    requestDiffFile,
    requestDiffSummary,
    requestStateTimeline,
    requestScreen,
    focusPane,
    uploadImageAttachment,
    sendText,
    sendKeys,
    sendRaw,
    touchSession,
    updateSessionTitle,
  } = sessionApi;
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
    handleUploadImage,
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
    mode,
    sendText,
    sendKeys,
    sendRaw,
    uploadImageAttachment,
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
    updateSessionTitle,
  });

  const sessionGroups = useMemo(() => buildSessionGroups(sessions), [sessions]);
  const is2xlUp = useMediaQuery("(min-width: 1536px)");
  const isMobile = useMediaQuery("(max-width: 767px)");

  const {
    timeline,
    timelineRange,
    timelineError,
    timelineLoading,
    timelineExpanded,
    setTimelineRange,
    toggleTimelineExpanded,
    refreshTimeline,
  } = useSessionTimeline({
    paneId,
    connected,
    requestStateTimeline,
    mobileDefaultCollapsed: true,
  });

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
    void refreshScreen();
  }, [refreshScreen]);

  const handleOpenInNewTab = useCallback(() => {
    if (!selectedPaneId) return;
    const encoded = encodeURIComponent(selectedPaneId);
    window.open(`/sessions/${encoded}`, "_blank", "noopener,noreferrer");
  }, [selectedPaneId]);

  const handleTouchSession = useCallback(() => {
    void touchSession(paneId).catch(() => null);
  }, [paneId, touchSession]);

  const handleFocusPane = useCallback(
    async (targetPaneId: string) => {
      const result = await focusPane(targetPaneId);
      if (!result.ok) {
        setScreenError(result.error?.message ?? API_ERROR_MESSAGES.focusPane);
      }
    },
    [focusPane, setScreenError],
  );

  const handleOpenPaneHere = useCallback(
    (targetPaneId: string) => {
      closeQuickPanel();
      navigate({ to: "/sessions/$paneId", params: { paneId: targetPaneId } });
      closeLogModal();
    },
    [closeLogModal, closeQuickPanel, navigate],
  );

  const handleOpenHere = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneHere(selectedPaneId);
  }, [handleOpenPaneHere, selectedPaneId]);

  return {
    meta: {
      paneId,
      session,
      nowMs,
      connected,
      connectionIssue,
    },
    sidebar: {
      sessionGroups,
    },
    layout: {
      is2xlUp,
      sidebarWidth,
      handleSidebarPointerDown,
      detailSplitRatio,
      detailSplitRef,
      handleDetailSplitPointerDown,
    },
    timeline: {
      timeline,
      timelineRange,
      timelineError,
      timelineLoading,
      timelineExpanded,
      isMobile,
      setTimelineRange,
      toggleTimelineExpanded,
      refreshTimeline,
    },
    screen: {
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
    },
    controls: {
      interactive: connectionStatus !== "disconnected",
      textInputRef,
      autoEnter,
      shiftHeld,
      ctrlHeld,
      controlsOpen,
      rawMode,
      allowDangerKeys,
      handleSendKey,
      handleSendText,
      handleUploadImage,
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
    },
    diffs: {
      diffSummary,
      diffError,
      diffLoading,
      diffFiles,
      diffOpen,
      diffLoadingFiles,
      refreshDiff,
      toggleDiff,
    },
    commits: {
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
    },
    logs: {
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
    },
    title: {
      titleDraft,
      titleEditing,
      titleSaving,
      titleError,
      openTitleEditor,
      closeTitleEditor,
      updateTitleDraft,
      saveTitle,
      clearTitle,
    },
    actions: {
      handleFocusPane,
      handleOpenPaneHere,
      handleOpenHere,
      handleOpenInNewTab,
    },
  };
};

export type SessionDetailVM = ReturnType<typeof useSessionDetailVM>;
