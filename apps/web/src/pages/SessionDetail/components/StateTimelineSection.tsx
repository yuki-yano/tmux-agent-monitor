import type {
  SessionStateTimeline,
  SessionStateTimelineItem,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
  SessionStateValue,
} from "@vde-monitor/shared";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { memo, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  PanelSection,
  Tabs,
  TabsList,
  TabsTrigger,
  TagPill,
} from "@/components/ui";
import { SESSION_TIMELINE_RANGE_MS } from "@/features/shared-session-ui/model/session-timeline-range";
import { cn } from "@/lib/cn";

import { formatStateLabel, stateTone } from "@/lib/session-format";
import { SEGMENT_COLOR_CLASS } from "@/lib/state-segment-colors";
import { formatDurationMs, formatTime } from "@/lib/time-format";
import { buildTimelineDisplay } from "@/features/shared-session-ui/components/state-timeline-display";

import { useSessionDetailTimelineSectionProps } from "../SessionDetailTimelineProvider";

type StateTimelineSectionState = {
  timeline: SessionStateTimeline | null;
  timelineScope: SessionStateTimelineScope;
  timelineRange: SessionStateTimelineRange;
  hasRepoTimeline: boolean;
  timelineError: string | null;
  timelineLoading: boolean;
  timelineExpanded: boolean;
  isMobile: boolean;
};

type StateTimelineSectionActions = {
  onTimelineScopeChange: (scope: SessionStateTimelineScope) => void;
  onTimelineRangeChange: (range: SessionStateTimelineRange) => void;
  onTimelineRefresh: () => void;
  onToggleTimelineExpanded: () => void;
};

type StateTimelineSectionProps = {
  state: StateTimelineSectionState;
  actions: StateTimelineSectionActions;
};

const resolveSegmentItems = (
  items: SessionStateTimelineItem[],
  range: SessionStateTimelineRange,
) => {
  const rangeMs = SESSION_TIMELINE_RANGE_MS[range];
  return [...items]
    .sort((a, b) => {
      const aMs = Date.parse(a.startedAt);
      const bMs = Date.parse(b.startedAt);
      if (Number.isNaN(aMs) || Number.isNaN(bMs)) {
        return 0;
      }
      return aMs - bMs;
    })
    .map((item) => {
      if (item.durationMs <= 0) {
        return null;
      }
      return {
        item,
        width: (item.durationMs / rangeMs) * 100,
      };
    })
    .filter(
      (segment): segment is { item: SessionStateTimelineItem; width: number } => segment != null,
    );
};

const timelineRangeTabs = (
  timelineRange: SessionStateTimelineRange,
  onTimelineRangeChange: (range: SessionStateTimelineRange) => void,
) => (
  <Tabs
    value={timelineRange}
    onValueChange={(value) => {
      if (
        value === "15m" ||
        value === "1h" ||
        value === "3h" ||
        value === "6h" ||
        value === "24h"
      ) {
        onTimelineRangeChange(value);
      }
    }}
  >
    <TabsList aria-label="Timeline range">
      <TabsTrigger value="15m">15m</TabsTrigger>
      <TabsTrigger value="1h">1h</TabsTrigger>
      <TabsTrigger value="3h">3h</TabsTrigger>
      <TabsTrigger value="6h">6h</TabsTrigger>
      <TabsTrigger value="24h">24h</TabsTrigger>
    </TabsList>
  </Tabs>
);

const timelineScopeTabs = (
  timelineScope: SessionStateTimelineScope,
  hasRepoTimeline: boolean,
  onTimelineScopeChange: (scope: SessionStateTimelineScope) => void,
) => (
  <Tabs
    value={timelineScope}
    onValueChange={(value) => {
      if (value === "pane" || value === "repo") {
        onTimelineScopeChange(value);
      }
    }}
  >
    <TabsList aria-label="Timeline scope">
      <TabsTrigger value="pane">Pane</TabsTrigger>
      <TabsTrigger value="repo" disabled={!hasRepoTimeline}>
        Repo
      </TabsTrigger>
    </TabsList>
  </Tabs>
);

const resolveWaitingMs = (totalsMs: Record<SessionStateValue, number>) =>
  totalsMs.WAITING_INPUT + totalsMs.WAITING_PERMISSION + totalsMs.DONE;

export const StateTimelineSection = memo(({ state, actions }: StateTimelineSectionProps) => {
  const {
    timeline,
    timelineScope,
    timelineRange,
    hasRepoTimeline,
    timelineError,
    timelineLoading,
    timelineExpanded,
    isMobile,
  } = state;
  const {
    onTimelineScopeChange,
    onTimelineRangeChange,
    onTimelineRefresh,
    onToggleTimelineExpanded,
  } = actions;
  const [compactView, setCompactView] = useState(true);
  const isTimelineExpanded = isMobile || timelineExpanded;

  const timelineDisplay = useMemo(
    () => buildTimelineDisplay(timeline, timelineRange, { compact: compactView }),
    [compactView, timeline, timelineRange],
  );

  const segmentItems = useMemo(
    () => resolveSegmentItems(timelineDisplay.items, timelineRange),
    [timelineDisplay.items, timelineRange],
  );
  const displayedTimelineItems = useMemo(
    () => (isTimelineExpanded ? timelineDisplay.items : timelineDisplay.items.slice(0, 1)),
    [isTimelineExpanded, timelineDisplay.items],
  );
  const waitingMs = resolveWaitingMs(timelineDisplay.totalsMs);

  return (
    <Card className="flex min-w-0 flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-latte-text text-base font-semibold tracking-wide">
            State Timeline
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-latte-subtext0 hover:text-latte-text relative h-[30px] w-[30px] shrink-0 self-start p-0 after:absolute after:-inset-[7px] after:content-['']"
          onClick={onTimelineRefresh}
          aria-label="Refresh timeline"
        >
          <RefreshCw className={cn("h-4 w-4", timelineLoading && "animate-spin")} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>
      <div className="flex w-full flex-col gap-2">
        <div className="flex w-full flex-wrap items-center gap-2">
          {timelineScopeTabs(timelineScope, hasRepoTimeline, onTimelineScopeChange)}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2">
          {timelineRangeTabs(timelineRange, onTimelineRangeChange)}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setCompactView((previous) => !previous);
            }}
            aria-label="Toggle compact timeline"
            className={cn(
              "bg-latte-base/75 transition duration-200",
              compactView
                ? "border-latte-lavender/85 bg-latte-lavender/22 text-latte-lavender-text ring-latte-lavender/35 hover:border-latte-lavender hover:bg-latte-lavender/28 shadow-accent ring-1"
                : "border-latte-surface2/70 text-latte-subtext0 hover:border-latte-overlay1 hover:bg-latte-base/85 hover:text-latte-text",
            )}
          >
            Compact
          </Button>
          {!isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onToggleTimelineExpanded}
              aria-label={timelineExpanded ? "Collapse timeline" : "Expand timeline"}
            >
              {timelineExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {timelineError ? (
        <Callout tone="error" size="xs">
          {timelineError}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <TagPill tone="meta">Waiting {formatDurationMs(waitingMs)}</TagPill>
        <TagPill tone="meta">Running {formatDurationMs(timelineDisplay.totalsMs.RUNNING)}</TagPill>
      </div>

      <div className="border-latte-surface2 bg-latte-crust/70 flex h-2 overflow-hidden rounded-full border">
        {segmentItems.length === 0 ? (
          <div className="bg-latte-surface1/80 h-full w-full" />
        ) : (
          segmentItems.map((segment) => (
            <div
              key={segment.item.id}
              className={SEGMENT_COLOR_CLASS[segment.item.state]}
              style={{ width: `${segment.width}%` }}
              title={`${formatStateLabel(segment.item.state)} (${formatDurationMs(segment.item.durationMs)})`}
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:gap-2">
        {displayedTimelineItems.length ? (
          displayedTimelineItems.map((item) => (
            <PanelSection key={item.id} className="border-latte-surface2/60 rounded-xl border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={stateTone(item.state)} size="sm" animateIcon={false}>
                    {formatStateLabel(item.state)}
                  </Badge>
                  <span className="text-latte-subtext0 truncate text-xs" title={item.reason}>
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
    </Card>
  );
});

StateTimelineSection.displayName = "StateTimelineSection";

export const ConnectedStateTimelineSection = memo(({ isMobile }: { isMobile: boolean }) => {
  const { state, actions } = useSessionDetailTimelineSectionProps();
  const connectedState = useMemo(() => ({ ...state, isMobile }), [isMobile, state]);
  return <StateTimelineSection state={connectedState} actions={actions} />;
});

ConnectedStateTimelineSection.displayName = "ConnectedStateTimelineSection";
