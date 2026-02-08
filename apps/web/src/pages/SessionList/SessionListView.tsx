import { MonitorX, RefreshCw, Search } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button, EmptyCard } from "@/components/ui";
import { LogModal } from "@/pages/SessionDetail/components/LogModal";
import { QuickPanel } from "@/pages/SessionDetail/components/QuickPanel";
import { SessionSidebar } from "@/pages/SessionDetail/components/SessionSidebar";

import { SessionGroupSection } from "./components/SessionGroupSection";
import { SessionListHeader } from "./components/SessionListHeader";
import { createRepoPinKey } from "./sessionListPins";
import type { SessionListVM } from "./useSessionListVM";

export type SessionListViewProps = SessionListVM;

type PinScrollTarget = { scope: "repo"; key: string } | { scope: "pane"; key: string };

export const SessionListView = ({
  sessions,
  groups,
  sidebarSessionGroups,
  visibleSessionCount,
  quickPanelGroups,
  filter,
  filterOptions,
  connectionStatus,
  connectionIssue,
  nowMs,
  sidebarWidth,
  onFilterChange,
  onRefresh,
  onSidebarResizeStart,
  quickPanelOpen,
  logModalOpen,
  selectedSession,
  selectedLogLines,
  selectedLogLoading,
  selectedLogError,
  onOpenLogModal,
  onCloseLogModal,
  onToggleQuickPanel,
  onCloseQuickPanel,
  onOpenPaneHere,
  onOpenHere,
  onOpenNewTab,
  onToggleRepoPin,
  onTogglePanePin,
}: SessionListViewProps) => {
  const [pinScrollTarget, setPinScrollTarget] = useState<PinScrollTarget | null>(null);

  const handleToggleRepoPinWithScroll = useCallback(
    (repoRoot: string | null) => {
      onToggleRepoPin(repoRoot);
      setPinScrollTarget({
        scope: "repo",
        key: createRepoPinKey(repoRoot),
      });
    },
    [onToggleRepoPin],
  );

  const handleTogglePanePinWithScroll = useCallback(
    (paneId: string) => {
      onTogglePanePin(paneId);
      setPinScrollTarget({
        scope: "pane",
        key: paneId,
      });
    },
    [onTogglePanePin],
  );

  useEffect(() => {
    if (pinScrollTarget == null) {
      return;
    }

    const resolveTarget = () => {
      if (pinScrollTarget.scope === "repo") {
        return Array.from(document.querySelectorAll<HTMLElement>("[data-repo-scroll-key]")).find(
          (element) => element.dataset.repoScrollKey === pinScrollTarget.key,
        );
      }
      return Array.from(document.querySelectorAll<HTMLElement>("[data-pane-scroll-key]")).find(
        (element) => element.dataset.paneScrollKey === pinScrollTarget.key,
      );
    };

    const tryScroll = () => {
      const target = resolveTarget();
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      setPinScrollTarget(null);
    };

    const delays = pinScrollTarget.scope === "repo" ? [0, 80, 180] : [220, 420, 700, 1100, 1600];
    const timeoutIds = delays.map((delay) => window.setTimeout(tryScroll, delay));

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [groups, pinScrollTarget, sessions]);

  return (
    <>
      <div
        className="fixed left-0 top-0 z-40 hidden h-screen md:flex"
        style={{ width: `${sidebarWidth}px` }}
      >
        <SessionSidebar
          state={{
            sessionGroups: sidebarSessionGroups,
            nowMs,
            currentPaneId: null,
            className: "border-latte-surface1/80 h-full w-full rounded-none rounded-r-3xl border-r",
          }}
          actions={{}}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none"
          onPointerDown={onSidebarResizeStart}
        />
      </div>

      <div
        className="animate-fade-in-up w-full px-4 pb-10 pt-6 md:pl-[calc(var(--sidebar-width)+32px)] md:pr-6"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <div />
            <ThemeToggle />
          </div>
          <SessionListHeader
            connectionStatus={connectionStatus}
            connectionIssue={connectionIssue}
            filter={filter}
            filterOptions={filterOptions}
            onFilterChange={onFilterChange}
            onRefresh={onRefresh}
          />

          <div className="flex flex-col gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              {sessions.length === 0 && (
                <EmptyCard
                  icon={<MonitorX className="text-latte-overlay1 h-10 w-10" />}
                  title="No Active Sessions"
                  description="Start a tmux session with Codex or Claude Code to see it here. Sessions will appear automatically when detected."
                  className="py-16"
                  iconWrapperClassName="bg-latte-surface1/50 h-20 w-20"
                  titleClassName="text-xl"
                  descriptionClassName="max-w-sm"
                  action={
                    <Button variant="ghost" size="sm" onClick={onRefresh} className="mt-2">
                      <RefreshCw className="h-4 w-4" />
                      Check Again
                    </Button>
                  }
                />
              )}
              {sessions.length > 0 && visibleSessionCount === 0 && (
                <EmptyCard
                  icon={<Search className="text-latte-overlay1 h-8 w-8" />}
                  title="No Matching Sessions"
                  description="No sessions match the selected scope. Try selecting a different scope."
                  className="py-12"
                  iconWrapperClassName="bg-latte-surface1/50 h-16 w-16"
                  titleClassName="text-lg"
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onFilterChange("ALL")}
                      className="mt-2"
                    >
                      Show All Sessions
                    </Button>
                  }
                />
              )}
              {groups.map((group) => (
                <div
                  key={group.repoRoot ?? "no-repo"}
                  data-repo-scroll-key={createRepoPinKey(group.repoRoot)}
                >
                  <SessionGroupSection
                    group={group}
                    allSessions={sessions}
                    nowMs={nowMs}
                    onToggleRepoPin={handleToggleRepoPinWithScroll}
                    onTogglePanePin={handleTogglePanePinWithScroll}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <QuickPanel
          state={{
            open: quickPanelOpen,
            sessionGroups: quickPanelGroups,
            allSessions: sessions,
            nowMs,
            currentPaneId: null,
          }}
          actions={{
            onOpenLogModal,
            onOpenSessionLink: onOpenPaneHere,
            onClose: onCloseQuickPanel,
            onToggle: onToggleQuickPanel,
          }}
        />
      </div>

      <LogModal
        state={{
          open: logModalOpen,
          session: selectedSession,
          logLines: selectedLogLines,
          loading: selectedLogLoading,
          error: selectedLogError,
        }}
        actions={{
          onClose: onCloseLogModal,
          onOpenHere,
          onOpenNewTab,
        }}
      />
    </>
  );
};
