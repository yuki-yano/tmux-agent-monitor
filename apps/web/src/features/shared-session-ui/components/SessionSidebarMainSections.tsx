import { Link, useRouter } from "@tanstack/react-router";
import { useStore } from "jotai";
import { type UIEvent, memo, useCallback, useRef } from "react";

import { FilterToggleGroup, TagPill } from "@/components/ui";
import {
  SIDEBAR_LIST_SCROLL_RESTORATION_ID,
  sidebarListNavigationPendingAtom,
  sidebarListScrollTopAtom,
} from "@/features/shared-session-ui/atoms/sidebarUiAtoms";
import {
  DEFAULT_SESSION_LIST_FILTER,
  SESSION_LIST_FILTER_VALUES,
  type SessionListFilter,
} from "@/features/shared-session-ui/model/session-list-filters";
import { useLazyRef } from "@/lib/use-lazy-ref";
import type { LaunchConfig, WorktreeList } from "@vde-monitor/shared";

import type { SidebarRepoGroup } from "../hooks/useSessionSidebarGroups";
import type { LaunchAgentHandler } from "@/state/launch-agent-options";

import { SessionSidebarGroupList } from "./SessionSidebarGroupList";

export type SessionSidebarListSectionViewModel = {
  onListScroll: () => void;
  sidebarGroups: SidebarRepoGroup[];
  sidebarWidth?: number;
  nowMs: number;
  currentPaneId?: string | null;
  focusPendingPaneIds: Set<string>;
  launchPendingSessions: Set<string>;
  launchConfig: LaunchConfig;
  launchAgentAvailable: boolean;
  requestWorktrees: (paneId: string) => Promise<WorktreeList>;
  onHoverStart: (paneId: string) => void;
  onHoverEnd: (paneId: string) => void;
  onFocus: (paneId: string) => void;
  onBlur: (paneId: string) => void;
  onSelect: (paneId: string) => void;
  onFocusPane: (paneId: string) => Promise<void> | void;
  onLaunchAgentInSession: LaunchAgentHandler;
  onTouchSession: (paneId: string) => void;
  onTouchRepoPin: (repoRoot: string | null) => void;
  registerItemRef: (paneId: string, node: HTMLDivElement | null) => void;
};

export type SessionSidebarMainSectionsViewModel = {
  header: {
    totalSessions: number;
    repoCount: number;
  };
  filter: {
    value: SessionListFilter;
    onChange: (next: string) => void;
  };
  list: SessionSidebarListSectionViewModel;
};

type SessionSidebarHeaderProps = {
  totalSessions: number;
  repoCount: number;
};

const SessionSidebarHeader = memo(({ totalSessions, repoCount }: SessionSidebarHeaderProps) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <Link
        to="/"
        search={{ filter: DEFAULT_SESSION_LIST_FILTER }}
        className="hover:text-latte-blue-text focus-visible:ring-latte-blue/40 group inline-flex flex-col rounded-md outline-hidden transition-colors duration-200 focus-visible:ring-2"
        aria-label="Go to top"
      >
        <p className="text-latte-subtext0 text-[11px] font-medium uppercase tracking-[0.14em]">
          VDE Monitor
        </p>
        <h2 className="font-display text-latte-text text-xl font-semibold tracking-[-0.02em]">
          Live Sessions
        </h2>
      </Link>
    </div>
    <div className="flex flex-col items-end gap-2">
      <TagPill
        tone="neutral"
        className="border-latte-green/30 bg-latte-green/10 text-latte-green-text text-[11px] uppercase tracking-[0.08em]"
      >
        {totalSessions} Active
      </TagPill>
      <TagPill
        tone="meta"
        className="border-latte-blue/30 bg-latte-blue/10 text-latte-blue-text text-[11px] uppercase tracking-[0.08em]"
      >
        {repoCount} repos
      </TagPill>
    </div>
  </div>
));

SessionSidebarHeader.displayName = "SessionSidebarHeader";

const SIDEBAR_FILTER_OPTIONS = SESSION_LIST_FILTER_VALUES.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

type SessionSidebarFilterSectionProps = {
  filter: SessionListFilter;
  onFilterChange: (next: string) => void;
};

const SessionSidebarFilterSection = ({
  filter,
  onFilterChange,
}: SessionSidebarFilterSectionProps) => (
  <FilterToggleGroup
    value={filter}
    onChange={onFilterChange}
    options={SIDEBAR_FILTER_OPTIONS}
    buttonClassName="px-2.5 text-[11px] uppercase tracking-[0.08em]"
  />
);

type SessionSidebarListSectionProps = {
  list: SessionSidebarListSectionViewModel;
};

const SessionSidebarListSection = ({ list }: SessionSidebarListSectionProps) => {
  const store = useStore();
  const router = useRouter();
  const initialScrollTopRef = useLazyRef(() => store.get(sidebarListScrollTopAtom));
  const restoringScrollRef = useRef(true);
  const restoreScrollTop = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        const scrollTop = initialScrollTopRef.current;
        node.scrollTop = scrollTop;
        requestAnimationFrame(() => {
          // TanStack Router restores destination scroll after descendants mount. Re-apply the
          // browser-lifetime sidebar position once that navigation lifecycle has completed.
          if (node.isConnected) {
            node.scrollTop = scrollTop;
            restoringScrollRef.current = false;
          }
        });
      }
    },
    [initialScrollTopRef, restoringScrollRef],
  );
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      list.onListScroll();
      // Router navigation also emits scroll events while replacing/restoring the destination.
      // Keep those lifecycle writes from overwriting the browser-lifetime sidebar position.
      if (
        store.get(sidebarListNavigationPendingAtom) ||
        router.state.status === "pending" ||
        (restoringScrollRef.current &&
          initialScrollTopRef.current > 0 &&
          event.currentTarget.scrollTop === 0)
      ) {
        return;
      }
      store.set(sidebarListScrollTopAtom, event.currentTarget.scrollTop);
    },
    [initialScrollTopRef, list, restoringScrollRef, router, store],
  );

  return (
    <div
      ref={restoreScrollTop}
      data-scroll-restoration-id={SIDEBAR_LIST_SCROLL_RESTORATION_ID}
      className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-2"
      onScroll={handleScroll}
    >
      <SessionSidebarGroupList
        sidebarGroups={list.sidebarGroups}
        sidebarWidth={list.sidebarWidth}
        nowMs={list.nowMs}
        currentPaneId={list.currentPaneId}
        focusPendingPaneIds={list.focusPendingPaneIds}
        launchPendingSessions={list.launchPendingSessions}
        launchConfig={list.launchConfig}
        launchAgentAvailable={list.launchAgentAvailable}
        requestWorktrees={list.requestWorktrees}
        onHoverStart={list.onHoverStart}
        onHoverEnd={list.onHoverEnd}
        onFocus={list.onFocus}
        onBlur={list.onBlur}
        onSelect={list.onSelect}
        onFocusPane={list.onFocusPane}
        onLaunchAgentInSession={list.onLaunchAgentInSession}
        onTouchSession={list.onTouchSession}
        onTouchRepoPin={list.onTouchRepoPin}
        registerItemRef={list.registerItemRef}
      />
    </div>
  );
};

type SessionSidebarMainSectionsProps = {
  viewModel: SessionSidebarMainSectionsViewModel;
};

export const SessionSidebarMainSections = ({ viewModel }: SessionSidebarMainSectionsProps) => {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-5">
      <SessionSidebarHeader
        totalSessions={viewModel.header.totalSessions}
        repoCount={viewModel.header.repoCount}
      />
      <SessionSidebarFilterSection
        filter={viewModel.filter.value}
        onFilterChange={viewModel.filter.onChange}
      />
      <SessionSidebarListSection list={viewModel.list} />
    </div>
  );
};
