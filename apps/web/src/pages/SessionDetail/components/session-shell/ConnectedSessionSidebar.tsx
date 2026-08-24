import { memo, useMemo } from "react";

import { SessionSidebar } from "@/features/shared-session-ui/components/SessionSidebar";

import {
  useSessionDetailBase,
  useSessionDetailRepoPins,
  useSessionDetailSidebarActions,
} from "../../SessionDetailContexts";

const SESSION_SIDEBAR_CLASS =
  "border-latte-surface1/80 h-full w-full rounded-none rounded-r-3xl border-r";

export const ConnectedSessionSidebar = memo(({ sidebarWidth }: { sidebarWidth: number }) => {
  const base = useSessionDetailBase();
  const repoPins = useSessionDetailRepoPins();
  const actions = useSessionDetailSidebarActions();
  const state = useMemo(
    () => ({
      sessionGroups: repoPins.sessionGroups,
      getRepoSortAnchorAt: repoPins.getRepoSortAnchorAt,
      sidebarWidth,
      nowMs: base.nowMs,
      connected: base.connected,
      connectionIssue: base.connectionIssue,
      launchConfig: base.launchConfig,
      launchAgentAvailable: base.capabilities.launchAgent,
      requestWorktrees: base.requestWorktrees,
      requestStateTimeline: base.requestStateTimeline,
      requestScreen: base.requestScreen,
      highlightCorrections: base.highlightCorrections,
      resolvedTheme: base.resolvedTheme,
      currentPaneId: base.paneId,
      className: SESSION_SIDEBAR_CLASS,
    }),
    [
      base.capabilities.launchAgent,
      base.connected,
      base.connectionIssue,
      base.highlightCorrections,
      base.launchConfig,
      base.nowMs,
      base.paneId,
      base.requestScreen,
      base.requestStateTimeline,
      base.requestWorktrees,
      base.resolvedTheme,
      repoPins.getRepoSortAnchorAt,
      repoPins.sessionGroups,
      sidebarWidth,
    ],
  );
  const sidebarActions = useMemo(
    () => ({
      onFocusPane: actions.handleFocusPane,
      onLaunchAgentInSession: actions.handleLaunchAgentInSession,
      onTouchSession: actions.handleTouchPaneSortAnchor,
      onTouchRepoPin: actions.handleTouchRepoPin,
    }),
    [
      actions.handleFocusPane,
      actions.handleLaunchAgentInSession,
      actions.handleTouchPaneSortAnchor,
      actions.handleTouchRepoPin,
    ],
  );

  return <SessionSidebar state={state} actions={sidebarActions} />;
});

ConnectedSessionSidebar.displayName = "ConnectedSessionSidebar";
