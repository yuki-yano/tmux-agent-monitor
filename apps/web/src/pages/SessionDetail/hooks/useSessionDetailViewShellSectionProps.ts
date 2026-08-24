import { useMemo } from "react";

import { buildPaneTextDraftStorageKey } from "@/features/shared-session-ui/lib/pane-text-draft-storage";

import { useSessionDetailContext } from "../SessionDetailProvider";
import { useSessionTitleEditor } from "./useSessionTitleEditor";

export const useSessionDetailViewShellSectionProps = () => {
  const { base, repoPins, terminal, logsActions } = useSessionDetailContext();
  const { paneId, session, nowMs, connectionIssue } = base;
  const { sessionGroups, getRepoSortAnchorAt } = repoPins;
  const {
    connected,
    launchConfig,
    capabilities,
    requestWorktrees,
    requestStateTimeline,
    requestScreen,
  } = base;
  const { highlightCorrections, resolvedTheme } = base;
  const { controls } = terminal;
  const { autoEnter, shiftHeld, ctrlHeld, rawMode, allowDangerKeys, isSendingText } = controls;
  const {
    textInputRef,
    handleSendKey,
    handleSendPermissionShortcut,
    handleKillPane,
    handleKillWindow,
    handleSendText,
    handleUploadImage,
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
    toggleAutoEnter,
    toggleShift,
    toggleCtrl,
    toggleRawMode,
    toggleAllowDangerKeys,
  } = controls;
  const {
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
  } = logsActions.logs;
  const {
    handleFocusPane,
    handleLaunchAgentInSession,
    handleTouchRepoPin,
    handleOpenPaneHere,
    handleOpenPaneInNewWindow,
    handleOpenHere,
    handleOpenInNewTab,
    handleTouchCurrentSession,
    handleTouchPaneSortAnchor,
  } = logsActions.actions;
  const {
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    openTitleEditor,
    closeTitleEditor,
    updateTitleDraft,
    saveTitle,
    resetTitle,
  } = useSessionTitleEditor({
    session,
    paneId,
    updateSessionTitle: base.updateSessionTitle,
    resetSessionTitle: base.resetSessionTitle,
  });

  const quickPanelProps = useMemo(
    () => ({
      state: {
        open: quickPanelOpen,
        sessionGroups,
        allSessions: sessionGroups.flatMap((group) => group.sessions),
        nowMs,
        currentPaneId: paneId,
      },
      actions: {
        onOpenLogModal: openLogModal,
        onOpenSessionLink: handleOpenPaneHere,
        onOpenSessionLinkInNewWindow: handleOpenPaneInNewWindow,
        onClose: closeQuickPanel,
        onToggle: toggleQuickPanel,
      },
    }),
    [
      quickPanelOpen,
      sessionGroups,
      nowMs,
      paneId,
      openLogModal,
      handleOpenPaneHere,
      handleOpenPaneInNewWindow,
      closeQuickPanel,
      toggleQuickPanel,
    ],
  );

  const logModalProps = useMemo(
    () => ({
      state: {
        open: logModalOpen,
        session: selectedSession,
        logLines: selectedLogLines,
        loading: selectedLogLoading,
        error: selectedLogError,
      },
      actions: {
        onClose: closeLogModal,
        onOpenHere: handleOpenHere,
        onOpenNewTab: handleOpenInNewTab,
      },
    }),
    [
      logModalOpen,
      selectedSession,
      selectedLogLines,
      selectedLogLoading,
      selectedLogError,
      closeLogModal,
      handleOpenHere,
      handleOpenInNewTab,
    ],
  );

  const sessionHeaderProps = useMemo(() => {
    if (!session) {
      return null;
    }

    return {
      state: {
        session,
        connectionIssue,
        nowMs,
        titleDraft,
        titleEditing,
        titleSaving,
        titleError,
      },
      actions: {
        onTitleDraftChange: updateTitleDraft,
        onTitleSave: saveTitle,
        onTitleReset: resetTitle,
        onOpenTitleEditor: openTitleEditor,
        onCloseTitleEditor: closeTitleEditor,
        onTouchSession: handleTouchCurrentSession,
      },
    };
  }, [
    session,
    connectionIssue,
    nowMs,
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    updateTitleDraft,
    saveTitle,
    resetTitle,
    openTitleEditor,
    closeTitleEditor,
    handleTouchCurrentSession,
  ]);

  const sessionSidebarProps = useMemo(
    () => ({
      state: {
        sessionGroups,
        getRepoSortAnchorAt,
        nowMs,
        connected,
        connectionIssue,
        launchConfig,
        launchAgentAvailable: capabilities.launchAgent,
        requestWorktrees,
        requestStateTimeline,
        requestScreen,
        highlightCorrections,
        resolvedTheme,
        currentPaneId: paneId,
        className: "border-latte-surface1/80 h-full w-full rounded-none rounded-r-3xl border-r",
      },
      actions: {
        onFocusPane: handleFocusPane,
        onLaunchAgentInSession: handleLaunchAgentInSession,
        onTouchSession: handleTouchPaneSortAnchor,
        onTouchRepoPin: handleTouchRepoPin,
      },
    }),
    [
      sessionGroups,
      getRepoSortAnchorAt,
      nowMs,
      connected,
      connectionIssue,
      launchConfig,
      capabilities.launchAgent,
      requestWorktrees,
      requestStateTimeline,
      requestScreen,
      highlightCorrections,
      resolvedTheme,
      paneId,
      handleFocusPane,
      handleLaunchAgentInSession,
      handleTouchPaneSortAnchor,
      handleTouchRepoPin,
    ],
  );

  const controlsPanelProps = useMemo(
    () => ({
      state: {
        interactive: base.connectionStatus !== "disconnected",
        textInputRef,
        draftStorageKey: buildPaneTextDraftStorageKey(paneId),
        autoEnter,
        rawMode,
        allowDangerKeys,
        isSendingText,
        showPermissionShortcuts: session?.state === "WAITING_PERMISSION",
        completion: session
          ? {
              agent: session.agent,
              paneId,
              requestPromptCompletions: base.requestPromptCompletions,
              requestRepoFileSearch: base.requestRepoFileSearch,
            }
          : undefined,
        shiftHeld,
        ctrlHeld,
      },
      actions: {
        onSendText: handleSendText,
        onPickImage: handleUploadImage,
        onToggleAutoEnter: toggleAutoEnter,
        onToggleRawMode: toggleRawMode,
        onToggleAllowDangerKeys: toggleAllowDangerKeys,
        onToggleShift: toggleShift,
        onToggleCtrl: toggleCtrl,
        onSendKey: handleSendKey,
        onSendPermissionShortcut: handleSendPermissionShortcut,
        onKillPane: handleKillPane,
        onKillWindow: handleKillWindow,
        onRawBeforeInput: handleRawBeforeInput,
        onRawInput: handleRawInput,
        onRawKeyDown: handleRawKeyDown,
        onRawCompositionStart: handleRawCompositionStart,
        onRawCompositionEnd: handleRawCompositionEnd,
      },
    }),
    [
      base.connectionStatus,
      textInputRef,
      paneId,
      autoEnter,
      rawMode,
      allowDangerKeys,
      isSendingText,
      session,
      base.requestPromptCompletions,
      base.requestRepoFileSearch,
      shiftHeld,
      ctrlHeld,
      handleSendText,
      handleUploadImage,
      toggleAutoEnter,
      toggleRawMode,
      toggleAllowDangerKeys,
      toggleShift,
      toggleCtrl,
      handleSendKey,
      handleSendPermissionShortcut,
      handleKillPane,
      handleKillWindow,
      handleRawBeforeInput,
      handleRawInput,
      handleRawKeyDown,
      handleRawCompositionStart,
      handleRawCompositionEnd,
    ],
  );

  return {
    quickPanelProps,
    logModalProps,
    sessionHeaderProps,
    sessionSidebarProps,
    controlsPanelProps,
  };
};
