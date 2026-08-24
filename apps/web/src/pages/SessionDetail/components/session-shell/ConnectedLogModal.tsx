import { memo, useMemo } from "react";

import { LogModal } from "@/features/shared-session-ui/components/LogModal";

import { useSessionDetailLogModal } from "../../SessionDetailContexts";

export const ConnectedLogModal = memo(() => {
  const { logs, actions } = useSessionDetailLogModal();
  const state = useMemo(
    () => ({
      open: logs.logModalOpen,
      session: logs.selectedSession,
      logLines: logs.selectedLogLines,
      loading: logs.selectedLogLoading,
      error: logs.selectedLogError,
    }),
    [
      logs.logModalOpen,
      logs.selectedLogError,
      logs.selectedLogLines,
      logs.selectedLogLoading,
      logs.selectedSession,
    ],
  );
  const modalActions = useMemo(
    () => ({
      onClose: logs.closeLogModal,
      onOpenHere: actions.handleOpenHere,
      onOpenNewTab: actions.handleOpenInNewTab,
    }),
    [actions.handleOpenHere, actions.handleOpenInNewTab, logs.closeLogModal],
  );

  return <LogModal state={state} actions={modalActions} />;
});

ConnectedLogModal.displayName = "ConnectedLogModal";
