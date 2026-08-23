import { useNavigate } from "@tanstack/react-router";
import type { CommandResponse } from "@vde-monitor/shared";
import { useCallback } from "react";

import { useWorkspaceTabs } from "@/features/pwa-tabs/context/workspace-tabs-context";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";

type UseSessionDetailActionsParams = {
  paneId: string;
  selectedPaneId: string | null;
  closeQuickPanel: () => void;
  closeLogModal: () => void;
  moveSessionToTop: (paneId: string) => Promise<void>;
  focusPane: (paneId: string) => Promise<CommandResponse>;
  setScreenError: (message: string | null) => void;
};

export const useSessionDetailActions = ({
  paneId,
  selectedPaneId,
  closeQuickPanel,
  closeLogModal,
  moveSessionToTop,
  focusPane,
  setScreenError,
}: UseSessionDetailActionsParams) => {
  const navigate = useNavigate();
  const { enabled: pwaTabsEnabled, openSessionTab, dismissSessionTab } = useWorkspaceTabs();

  const handleOpenPaneInNewWindow = useCallback(
    (targetPaneId: string) => {
      closeQuickPanel();
      closeLogModal();
      if (pwaTabsEnabled) {
        openSessionTab(targetPaneId);
        return;
      }
      const encoded = encodeURIComponent(targetPaneId);
      window.open(`/sessions/${encoded}`, "_blank", "noopener,noreferrer");
    },
    [closeLogModal, closeQuickPanel, openSessionTab, pwaTabsEnabled],
  );

  const handleOpenInNewTab = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneInNewWindow(selectedPaneId);
  }, [handleOpenPaneInNewWindow, selectedPaneId]);

  const handleTouchSession = useCallback(() => {
    void moveSessionToTop(paneId).catch(() => null);
  }, [moveSessionToTop, paneId]);

  const handleTouchPane = useCallback(
    (targetPaneId: string) => {
      void moveSessionToTop(targetPaneId).catch(() => null);
    },
    [moveSessionToTop],
  );

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
      void navigate({ to: "/sessions/$paneId", params: { paneId: targetPaneId } });
      closeLogModal();
    },
    [closeLogModal, closeQuickPanel, navigate],
  );

  const handleOpenPaneAfterResumeWindow = useCallback(
    (targetPaneId: string, sourcePaneId: string) => {
      closeQuickPanel();
      void navigate({ to: "/sessions/$paneId", params: { paneId: targetPaneId } });
      closeLogModal();
      if (pwaTabsEnabled && sourcePaneId !== targetPaneId) {
        dismissSessionTab(sourcePaneId);
      }
    },
    [closeLogModal, closeQuickPanel, dismissSessionTab, navigate, pwaTabsEnabled],
  );

  const handleOpenHere = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneHere(selectedPaneId);
  }, [handleOpenPaneHere, selectedPaneId]);

  return {
    handleOpenPaneInNewWindow,
    handleOpenInNewTab,
    handleTouchSession,
    handleTouchPane,
    handleFocusPane,
    handleOpenPaneHere,
    handleOpenPaneAfterResumeWindow,
    handleOpenHere,
  };
};
