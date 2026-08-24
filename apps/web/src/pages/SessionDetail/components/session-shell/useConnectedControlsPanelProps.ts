import { useMemo } from "react";

import { buildPaneTextDraftStorageKey } from "@/features/shared-session-ui/lib/pane-text-draft-storage";

import { useSessionDetailBase, useSessionDetailTerminal } from "../../SessionDetailContexts";

export const useConnectedControlsPanelProps = () => {
  const base = useSessionDetailBase();
  const { controls } = useSessionDetailTerminal();
  const hasSession = base.session != null;
  const sessionAgent = base.session?.agent;
  const sessionState = base.session?.state;
  const state = useMemo(
    () => ({
      interactive: base.connectionStatus !== "disconnected",
      textInputRef: controls.textInputRef,
      draftStorageKey: buildPaneTextDraftStorageKey(base.paneId),
      autoEnter: controls.autoEnter,
      rawMode: controls.rawMode,
      allowDangerKeys: controls.allowDangerKeys,
      isSendingText: controls.isSendingText,
      showPermissionShortcuts: sessionState === "WAITING_PERMISSION",
      completion: hasSession
        ? {
            agent: sessionAgent ?? "unknown",
            paneId: base.paneId,
            requestPromptCompletions: base.requestPromptCompletions,
            requestRepoFileSearch: base.requestRepoFileSearch,
          }
        : undefined,
      shiftHeld: controls.shiftHeld,
      ctrlHeld: controls.ctrlHeld,
    }),
    [
      base.connectionStatus,
      base.paneId,
      base.requestPromptCompletions,
      base.requestRepoFileSearch,
      controls.allowDangerKeys,
      controls.autoEnter,
      controls.ctrlHeld,
      controls.isSendingText,
      controls.rawMode,
      controls.shiftHeld,
      controls.textInputRef,
      hasSession,
      sessionAgent,
      sessionState,
    ],
  );
  const actions = useMemo(
    () => ({
      onSendText: controls.handleSendText,
      onPickImage: controls.handleUploadImage,
      onToggleAutoEnter: controls.toggleAutoEnter,
      onToggleRawMode: controls.toggleRawMode,
      onToggleAllowDangerKeys: controls.toggleAllowDangerKeys,
      onToggleShift: controls.toggleShift,
      onToggleCtrl: controls.toggleCtrl,
      onSendKey: controls.handleSendKey,
      onSendPermissionShortcut: controls.handleSendPermissionShortcut,
      onKillPane: controls.handleKillPane,
      onKillWindow: controls.handleKillWindow,
      onRawBeforeInput: controls.handleRawBeforeInput,
      onRawInput: controls.handleRawInput,
      onRawKeyDown: controls.handleRawKeyDown,
      onRawCompositionStart: controls.handleRawCompositionStart,
      onRawCompositionEnd: controls.handleRawCompositionEnd,
    }),
    [
      controls.handleKillPane,
      controls.handleKillWindow,
      controls.handleRawBeforeInput,
      controls.handleRawCompositionEnd,
      controls.handleRawCompositionStart,
      controls.handleRawInput,
      controls.handleRawKeyDown,
      controls.handleSendKey,
      controls.handleSendPermissionShortcut,
      controls.handleSendText,
      controls.handleUploadImage,
      controls.toggleAllowDangerKeys,
      controls.toggleAutoEnter,
      controls.toggleCtrl,
      controls.toggleRawMode,
      controls.toggleShift,
    ],
  );

  return { state, actions };
};
