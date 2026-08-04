import { Link } from "@tanstack/react-router";
import type { SessionStateTimelineItem, SessionStateTimelineRange } from "@vde-monitor/shared";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { type CSSProperties, useMemo } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  Badge,
  Button,
  Callout,
  GlowCard,
  PanelSection,
  Tabs,
  TabsList,
  TabsTrigger,
  TagPill,
} from "@/components/ui";
import { LogModal } from "@/features/shared-session-ui/components/LogModal";
import { QuickPanel } from "@/features/shared-session-ui/components/QuickPanel";
import { SessionSidebar } from "@/features/shared-session-ui/components/SessionSidebar";
import { buildTimelineDisplay } from "@/features/shared-session-ui/components/state-timeline-display";
import { backLinkClass } from "@/features/shared-session-ui/model/navigation-style";
import { readStoredSessionListFilter } from "@/features/shared-session-ui/model/session-list-filters";
import { SESSION_TIMELINE_RANGE_MS } from "@/features/shared-session-ui/model/session-timeline-range";
import { cn } from "@/lib/cn";
import { formatStateLabel, stateTone } from "@/lib/session-format";
import { SEGMENT_COLOR_CLASS } from "@/lib/state-segment-colors";
import { formatDurationMs, formatTime } from "@/lib/time-format";

import { ProviderQuotaSection } from "./ProviderQuotaSection";
import { RepositoryActivitySection } from "./RepositoryActivitySection";
import { formatDateTime } from "./usage-format";
import type { UsageDashboardVM } from "./useUsageDashboardVM";

const resolveBackToListSearch = () => ({ filter: readStoredSessionListFilter() });

const resolveTimelineSegments = (
  items: SessionStateTimelineItem[],
  range: SessionStateTimelineRange,
) => {
  const rangeMs = SESSION_TIMELINE_RANGE_MS[range];
  return [...items]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((item) => {
      if (item.durationMs <= 0) {
        return null;
      }
      return {
        item,
        width: (item.durationMs / rangeMs) * 100,
      };
    })
    .filter((item): item is { item: SessionStateTimelineItem; width: number } => item != null);
};

const timelineRangeTabs = (
  timelineRange: SessionStateTimelineRange,
  onTimelineRangeChange: (range: SessionStateTimelineRange) => void,
) => (
  <Tabs
    value={timelineRange}
    onValueChange={(value) => {
      if (
        value === "6h" ||
        value === "24h" ||
        value === "3d" ||
        value === "7d" ||
        value === "14d" ||
        value === "30d"
      ) {
        onTimelineRangeChange(value);
      }
    }}
  >
    <TabsList aria-label="Usage aggregation range">
      <TabsTrigger value="6h">6h</TabsTrigger>
      <TabsTrigger value="24h">24h</TabsTrigger>
      <TabsTrigger value="3d">3d</TabsTrigger>
      <TabsTrigger value="7d">7d</TabsTrigger>
      <TabsTrigger value="14d">14d</TabsTrigger>
      <TabsTrigger value="30d">30d</TabsTrigger>
    </TabsList>
  </Tabs>
);

const UsageDashboardHeader = ({
  backToListSearch,
  loading,
  onRefresh,
}: {
  backToListSearch: ReturnType<typeof resolveBackToListSearch>;
  loading: boolean;
  onRefresh: () => void;
}) => (
  <>
    <div className="flex items-center justify-between gap-3">
      <Link to="/" search={backToListSearch} className={backLinkClass}>
        <ArrowLeft className="h-4 w-4" />
        Back to list
      </Link>
      <ThemeToggle />
    </div>
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[var(--material-stroke)] bg-[var(--material-canvas)] p-4 shadow-[var(--material-shadow)] backdrop-blur-2xl sm:p-5">
      <div>
        <p className="text-latte-subtext0 text-xs font-medium uppercase tracking-[0.16em]">
          VDE Monitor
        </p>
        <h1 className="font-display text-latte-text text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
          Usage Dashboard
        </h1>
        <p className="text-latte-subtext1 mt-1 text-sm">
          Monitor Codex / Claude limits and usage pace.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative h-8 w-8 p-0 after:absolute after:-inset-y-1.5 after:-inset-x-0.5 after:content-['']"
        onClick={onRefresh}
        aria-label="Refresh usage dashboard"
        title="Refresh usage dashboard"
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", loading && "animate-spin motion-reduce:animate-none")}
        />
      </Button>
    </header>
  </>
);

export const UsageDashboardView = ({
  sessions,
  connected,
  connectionIssue,
  launchConfig,
  capabilities,
  requestWorktrees,
  requestStateTimeline,
  requestScreen,
  highlightCorrections,
  resolvedTheme,
  sidebarSessionGroups,
  sidebarWidth,
  dashboard,
  dashboardLoading,
  billingLoadingByProvider,
  dashboardError,
  timeline,
  timelineLoading,
  timelineError,
  timelineRange,
  repositoryActivity,
  repositoryActivityLoading,
  repositoryActivityError,
  repositoryActivityRange,
  compactTimeline,
  nowMs,
  onTimelineRangeChange,
  onRepositoryActivityRangeChange,
  onToggleCompactTimeline,
  onRefreshAll,
  quickPanelGroups,
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
  onOpenPaneInNewWindow,
  onSidebarResizeStart,
  onLaunchAgentInSession,
  onTouchPanePin,
  onTouchRepoPin,
  onOpenHere,
  onOpenNewTab,
}: UsageDashboardVM) => {
  const timelineDisplay = useMemo(
    () =>
      buildTimelineDisplay(timeline?.timeline ?? null, timelineRange, { compact: compactTimeline }),
    [compactTimeline, timeline?.timeline, timelineRange],
  );

  const timelineSegments = useMemo(
    () => resolveTimelineSegments(timelineDisplay.items, timelineRange),
    [timelineDisplay.items, timelineRange],
  );

  const waitingMs =
    timelineDisplay.totalsMs.WAITING_INPUT +
    timelineDisplay.totalsMs.WAITING_PERMISSION +
    timelineDisplay.totalsMs.DONE;
  const timelineItems = compactTimeline ? timelineDisplay.items.slice(0, 6) : timelineDisplay.items;
  const codexProvider =
    dashboard?.providers.find((provider) => provider.providerId === "codex") ?? null;
  const claudeProvider =
    dashboard?.providers.find((provider) => provider.providerId === "claude") ?? null;
  const backToListSearch = resolveBackToListSearch();

  return (
    <>
      <main
        className="animate-fade-in-up w-full px-2.5 pb-7 pt-3.5 sm:px-4 sm:pb-10 sm:pt-6 md:pl-[calc(var(--sidebar-width)+32px)] md:pr-6"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-6">
          <UsageDashboardHeader
            backToListSearch={backToListSearch}
            loading={dashboardLoading || timelineLoading || repositoryActivityLoading}
            onRefresh={onRefreshAll}
          />

          {dashboardError ? (
            <Callout tone="error" size="sm">
              {dashboardError}
            </Callout>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ProviderQuotaSection
              title="Codex"
              provider={codexProvider}
              nowMs={nowMs}
              providerLoading={dashboardLoading}
              billingLoading={billingLoadingByProvider.codex}
            />
            <ProviderQuotaSection
              title="Claude"
              provider={claudeProvider}
              nowMs={nowMs}
              providerLoading={dashboardLoading}
              billingLoading={billingLoadingByProvider.claude}
            />
          </div>

          <RepositoryActivitySection
            activity={repositoryActivity}
            loading={repositoryActivityLoading}
            error={repositoryActivityError}
            range={repositoryActivityRange}
            onRangeChange={onRepositoryActivityRangeChange}
          />

          <GlowCard contentClassName="gap-3">
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-latte-text text-xl font-semibold">
                  Global State Timeline
                </h2>
                <p className="text-latte-subtext0 text-xs tabular-nums">
                  Aggregated across all sessions ({timeline?.paneCount ?? 0} total /{" "}
                  {timeline?.activePaneCount ?? 0} active)
                </p>
              </div>
              <div className="mt-2">{timelineRangeTabs(timelineRange, onTimelineRangeChange)}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onToggleCompactTimeline}
                  className={cn(
                    "transition-[scale,background-color,color,box-shadow,border-color] duration-200",
                    compactTimeline
                      ? "border-latte-blue/65 bg-latte-blue/18 text-latte-blue-text hover:border-latte-blue/75 hover:bg-latte-blue/24 shadow-[inset_0_0_0_1px_rgb(var(--ctp-blue)/0.14),0_1px_3px_rgb(var(--ctp-shadow)/0.1)]"
                      : "border-latte-surface2/70 text-latte-subtext0 hover:border-latte-overlay1 hover:bg-latte-base/85 hover:text-latte-text",
                  )}
                >
                  Compact
                </Button>
              </div>
              {timelineError ? (
                <Callout tone="error" size="sm" className="mt-3">
                  {timelineError}
                </Callout>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TagPill tone="meta">Waiting {formatDurationMs(waitingMs)}</TagPill>
                <TagPill tone="meta">
                  Running {formatDurationMs(timelineDisplay.totalsMs.RUNNING)}
                </TagPill>
                {timeline?.fetchedAt ? (
                  <TagPill tone="meta">Updated {formatDateTime(timeline.fetchedAt)}</TagPill>
                ) : null}
              </div>
              <div className="border-latte-surface2 bg-latte-crust/70 mt-3 flex h-2 overflow-hidden rounded-full border">
                {timelineSegments.length === 0 ? (
                  <div className="bg-latte-surface1/80 h-full w-full" />
                ) : (
                  timelineSegments.map((segment) => (
                    <div
                      key={segment.item.id}
                      className={SEGMENT_COLOR_CLASS[segment.item.state]}
                      style={{ width: `${segment.width}%` }}
                      title={`${formatStateLabel(segment.item.state)} (${formatDurationMs(segment.item.durationMs)})`}
                    />
                  ))
                )}
              </div>
              <div className="mt-3 space-y-1.5">
                {timelineItems.length > 0 ? (
                  timelineItems.map((item) => (
                    <PanelSection
                      key={item.id}
                      className="border-latte-surface2/60 rounded-xl border"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge tone={stateTone(item.state)} size="sm" animateIcon={false}>
                            {formatStateLabel(item.state)}
                          </Badge>
                          <span
                            className="text-latte-subtext0 truncate text-xs"
                            title={item.reason}
                          >
                            {item.reason}
                          </span>
                        </div>
                        <TagPill tone="meta">{formatDurationMs(item.durationMs)}</TagPill>
                      </div>
                      <p className="text-latte-subtext0 mt-1 text-xs">
                        {formatTime(item.startedAt)} - {formatTime(item.endedAt)}
                      </p>
                    </PanelSection>
                  ))
                ) : (
                  <p className="text-latte-subtext0 text-sm">No timeline events in this range.</p>
                )}
              </div>
            </section>
          </GlowCard>
        </div>
      </main>

      <div
        className="fixed left-0 top-0 z-40 hidden h-screen md:flex"
        style={{ width: `${sidebarWidth}px` }}
      >
        <SessionSidebar
          state={{
            sessionGroups: sidebarSessionGroups,
            sidebarWidth,
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
            currentPaneId: null,
            className: "border-latte-surface1/80 h-full w-full rounded-none rounded-r-3xl border-r",
          }}
          actions={{
            onSelectSession: onOpenPaneHere,
            onFocusPane: onOpenPaneHere,
            onLaunchAgentInSession,
            onTouchSession: onTouchPanePin,
            onTouchRepoPin,
          }}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none"
          onPointerDown={onSidebarResizeStart}
        />
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
            onOpenSessionLinkInNewWindow: onOpenPaneInNewWindow,
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
