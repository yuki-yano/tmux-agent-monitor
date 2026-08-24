import { memo, useMemo } from "react";

import { QuickPanel } from "@/features/shared-session-ui/components/QuickPanel";

import {
  useSessionDetailBase,
  useSessionDetailQuickPanel,
  useSessionDetailRepoPins,
} from "../../SessionDetailContexts";

export const ConnectedQuickPanel = memo(() => {
  const base = useSessionDetailBase();
  const repoPins = useSessionDetailRepoPins();
  const { logs, actions } = useSessionDetailQuickPanel();
  const state = useMemo(
    () => ({
      open: logs.quickPanelOpen,
      sessionGroups: repoPins.sessionGroups,
      allSessions: repoPins.sessionGroups.flatMap((group) => group.sessions),
      nowMs: base.nowMs,
      currentPaneId: base.paneId,
    }),
    [base.nowMs, base.paneId, logs.quickPanelOpen, repoPins.sessionGroups],
  );
  const panelActions = useMemo(
    () => ({
      onOpenLogModal: logs.openLogModal,
      onOpenSessionLink: actions.handleOpenPaneHere,
      onOpenSessionLinkInNewWindow: actions.handleOpenPaneInNewWindow,
      onClose: logs.closeQuickPanel,
      onToggle: logs.toggleQuickPanel,
    }),
    [
      actions.handleOpenPaneHere,
      actions.handleOpenPaneInNewWindow,
      logs.closeQuickPanel,
      logs.openLogModal,
      logs.toggleQuickPanel,
    ],
  );

  return <QuickPanel state={state} actions={panelActions} />;
});

ConnectedQuickPanel.displayName = "ConnectedQuickPanel";
