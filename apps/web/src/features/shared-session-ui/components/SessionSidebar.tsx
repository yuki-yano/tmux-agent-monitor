import type {
  HighlightCorrectionConfig,
  LaunchConfig,
  ScreenResponse,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
  WorktreeList,
} from "@vde-monitor/shared";
import { useStore } from "jotai";
import { memo, useCallback } from "react";

import { Card } from "@/components/ui";
import {
  SIDEBAR_LIST_SCROLL_RESTORATION_ID,
  sidebarListNavigationPendingAtom,
  sidebarListScrollTopAtom,
} from "@/features/shared-session-ui/atoms/sidebarUiAtoms";
import { SessionSidebarMainSections } from "@/features/shared-session-ui/components/SessionSidebarMainSections";
import { SessionSidebarPreviewPopover } from "@/features/shared-session-ui/components/SessionSidebarPreviewPopover";
import type { SessionSidebarMainSectionsViewModel } from "@/features/shared-session-ui/components/SessionSidebarMainSections";
import { useSessionSidebarActions } from "@/features/shared-session-ui/hooks/useSessionSidebarActions";
import { useSessionSidebarGroups } from "@/features/shared-session-ui/hooks/useSessionSidebarGroups";
import { useSessionSidebarPreviewPopover } from "@/features/shared-session-ui/hooks/useSessionSidebarPreviewPopover";
import { useSidebarPreview } from "@/features/shared-session-ui/hooks/useSidebarPreview";
import { cn } from "@/lib/cn";
import type { SessionGroup } from "@/lib/session-group";
import type { Theme } from "@/lib/theme";
import type { LaunchAgentHandler } from "@/state/launch-agent-options";

type SessionSidebarState = {
  sessionGroups: SessionGroup[];
  getRepoSortAnchorAt?: (repoRoot: string | null) => number | null;
  sidebarWidth?: number;
  nowMs: number;
  connected: boolean;
  connectionIssue: string | null;
  launchConfig: LaunchConfig;
  launchAgentAvailable: boolean;
  requestWorktrees: (paneId: string) => Promise<WorktreeList>;
  requestStateTimeline: (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
  ) => Promise<SessionStateTimeline>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  highlightCorrections: HighlightCorrectionConfig;
  resolvedTheme: Theme;
  currentPaneId?: string | null;
  className?: string;
};

type SessionSidebarActions = {
  onSelectSession?: (paneId: string) => void;
  onFocusPane?: (paneId: string) => Promise<void> | void;
  onLaunchAgentInSession?: LaunchAgentHandler;
  onTouchSession?: (paneId: string) => void;
  onTouchRepoPin?: (repoRoot: string | null) => void;
};

type SessionSidebarProps = {
  state: SessionSidebarState;
  actions: SessionSidebarActions;
};

const SidebarBackdrop = memo(() => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-none rounded-r-3xl">
    <div className="from-latte-blue/55 via-latte-lavender/30 absolute left-0 top-0 h-full w-[2px] bg-linear-to-b to-transparent" />
    <div className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-white/8 to-transparent" />
  </div>
));

SidebarBackdrop.displayName = "SidebarBackdrop";

export const SessionSidebar = ({ state, actions }: SessionSidebarProps) => {
  const store = useStore();
  const {
    sessionGroups,
    getRepoSortAnchorAt,
    sidebarWidth,
    nowMs,
    connected,
    connectionIssue,
    launchConfig,
    launchAgentAvailable,
    requestWorktrees,
    requestStateTimeline,
    requestScreen,
    highlightCorrections,
    resolvedTheme,
    currentPaneId,
    className,
  } = state;
  const { onSelectSession, onFocusPane, onLaunchAgentInSession, onTouchSession, onTouchRepoPin } =
    actions;

  const {
    filter,
    focusPendingPaneIds,
    launchPendingSessions,
    handleSelectSession,
    handleFocusPane,
    handleLaunchAgentInSession,
    handleFilterChange,
    handleTouchRepoPin,
    handleTouchPane,
  } = useSessionSidebarActions({
    onSelectSession,
    onFocusPane,
    onLaunchAgentInSession,
    onTouchSession,
    onTouchRepoPin,
  });

  const { sidebarGroups, totalSessions, repoCount, sessionIndex } = useSessionSidebarGroups({
    sessionGroups,
    filter,
    getRepoSortAnchorAt,
  });

  const {
    preview,
    handleHoverStart,
    handleHoverEnd,
    handleFocus,
    handleBlur,
    handleSelect: handlePreviewSelect,
    handleListScroll,
    registerItemRef,
  } = useSidebarPreview({
    sessionIndex,
    currentPaneId,
    connected,
    connectionIssue,
    requestStateTimeline,
    requestScreen,
    resolvedTheme,
    highlightCorrections,
  });

  const handleSelect = useCallback(
    (paneId: string) => {
      const listElement = document.querySelector<HTMLElement>(
        `[data-scroll-restoration-id="${SIDEBAR_LIST_SCROLL_RESTORATION_ID}"]`,
      );
      if (listElement) {
        store.set(sidebarListScrollTopAtom, listElement.scrollTop);
      }
      store.set(sidebarListNavigationPendingAtom, true);
      handleSelectSession(paneId);
      handlePreviewSelect();
      requestAnimationFrame(() => {
        store.set(sidebarListNavigationPendingAtom, false);
      });
    },
    [handlePreviewSelect, handleSelectSession, store],
  );
  const mainSectionsViewModel: SessionSidebarMainSectionsViewModel = {
    header: {
      totalSessions,
      repoCount,
    },
    filter: {
      value: filter,
      onChange: handleFilterChange,
    },
    list: {
      onListScroll: handleListScroll,
      sidebarGroups,
      sidebarWidth,
      nowMs,
      currentPaneId,
      focusPendingPaneIds,
      launchPendingSessions,
      launchConfig,
      launchAgentAvailable,
      requestWorktrees,
      onHoverStart: handleHoverStart,
      onHoverEnd: handleHoverEnd,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onSelect: handleSelect,
      onFocusPane: handleFocusPane,
      onLaunchAgentInSession: handleLaunchAgentInSession,
      onTouchSession: handleTouchPane,
      onTouchRepoPin: handleTouchRepoPin,
      registerItemRef,
    },
  };
  const previewPopover = useSessionSidebarPreviewPopover({
    preview,
    currentPaneId,
  });

  return (
    <Card
      className={cn(
        "relative flex h-full flex-col border-[var(--material-stroke)] bg-[var(--material-raised)] p-4 shadow-[var(--shadow-popover)] backdrop-blur-2xl",
        className,
      )}
    >
      <SidebarBackdrop />

      <SessionSidebarMainSections viewModel={mainSectionsViewModel} />

      {previewPopover && <SessionSidebarPreviewPopover {...previewPopover} />}
    </Card>
  );
};
