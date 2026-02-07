import type {
  SessionStateTimeline,
  SessionStateTimelineItem,
  SessionStateTimelineRange,
  SessionStateValue,
} from "@vde-monitor/shared";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  PanelSection,
  SectionHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  TagPill,
} from "@/components/ui";
import { cn } from "@/lib/cn";

import { formatStateLabel, stateTone } from "../sessionDetailUtils";
import { buildTimelineDisplay } from "./state-timeline-display";

type StateTimelineSectionState = {
  timeline: SessionStateTimeline | null;
  timelineRange: SessionStateTimelineRange;
  timelineError: string | null;
  timelineLoading: boolean;
  timelineExpanded: boolean;
  isMobile: boolean;
};

type StateTimelineSectionActions = {
  onTimelineRangeChange: (range: SessionStateTimelineRange) => void;
  onTimelineRefresh: () => void;
  onToggleTimelineExpanded: () => void;
};

type StateTimelineSectionProps = {
  state: StateTimelineSectionState;
  actions: StateTimelineSectionActions;
};

const RANGE_MS: Record<SessionStateTimelineRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
};

const SEGMENT_COLOR_CLASS: Record<SessionStateValue, string> = {
  RUNNING: "bg-latte-green/80",
  WAITING_INPUT: "bg-latte-peach/80",
  WAITING_PERMISSION: "bg-latte-red/80",
  SHELL: "bg-latte-blue/80",
  UNKNOWN: "bg-latte-overlay0/80",
};

const formatDurationMs = (durationMs: number) => {
  if (durationMs <= 0) {
    return "0s";
  }
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
};

const formatTime = (iso: string | null) => {
  if (!iso) {
    return "ongoing";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const resolveSegmentItems = (
  items: SessionStateTimelineItem[],
  range: SessionStateTimelineRange,
) => {
  const rangeMs = RANGE_MS[range];
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
      (segment): segment is { item: SessionStateTimelineItem; width: number } => segment !== null,
    );
};

const timelineRangeTabs = (
  timelineRange: SessionStateTimelineRange,
  onTimelineRangeChange: (range: SessionStateTimelineRange) => void,
) => (
  <Tabs
    value={timelineRange}
    onValueChange={(value) => {
      if (value === "15m" || value === "1h" || value === "6h") {
        onTimelineRangeChange(value);
      }
    }}
  >
    <TabsList aria-label="Timeline range">
      <TabsTrigger value="15m">15m</TabsTrigger>
      <TabsTrigger value="1h">1h</TabsTrigger>
      <TabsTrigger value="6h">6h</TabsTrigger>
    </TabsList>
  </Tabs>
);

const resolveWaitingMs = (totalsMs: Record<SessionStateValue, number>) =>
  totalsMs.WAITING_INPUT + totalsMs.WAITING_PERMISSION;

export const StateTimelineSection = ({ state, actions }: StateTimelineSectionProps) => {
  const { timeline, timelineRange, timelineError, timelineLoading, timelineExpanded } = state;
  const { onTimelineRangeChange, onTimelineRefresh, onToggleTimelineExpanded } = actions;
  const [compactView, setCompactView] = useState(true);

  const timelineDisplay = useMemo(
    () => buildTimelineDisplay(timeline, timelineRange, { compact: compactView }),
    [compactView, timeline, timelineRange],
  );

  const segmentItems = useMemo(
    () => resolveSegmentItems(timelineDisplay.items, timelineRange),
    [timelineDisplay.items, timelineRange],
  );
  const displayedTimelineItems = useMemo(
    () => (timelineExpanded ? timelineDisplay.items : timelineDisplay.items.slice(0, 1)),
    [timelineDisplay.items, timelineExpanded],
  );
  const waitingMs = resolveWaitingMs(timelineDisplay.totalsMs);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <SectionHeader
        title="State Timeline"
        action={
          <div className="flex items-center gap-2">
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
                "bg-latte-base/75 transition-all duration-200",
                compactView
                  ? "border-latte-lavender/85 bg-latte-lavender/22 text-latte-lavender ring-latte-lavender/35 hover:border-latte-lavender hover:bg-latte-lavender/28 shadow-[inset_0_0_0_1px_rgba(114,135,253,0.35),0_6px_16px_-10px_rgba(114,135,253,0.55)] ring-1"
                  : "border-latte-surface2/70 text-latte-subtext0 hover:border-latte-overlay1 hover:bg-latte-base/85 hover:text-latte-text",
              )}
            >
              Compact
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onTimelineRefresh}
              aria-label="Refresh timeline"
            >
              <RefreshCw className={`h-4 w-4 ${timelineLoading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleTimelineExpanded}
              aria-label={timelineExpanded ? "Collapse timeline" : "Expand timeline"}
            >
              {timelineExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        }
      />

      {timelineError ? (
        <Callout tone="error" size="xs">
          {timelineError}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <TagPill tone="meta">Range {timelineRange}</TagPill>
        {compactView && timelineDisplay.condensedCount > 0 ? (
          <TagPill tone="meta">Condensed {timelineDisplay.condensedCount}</TagPill>
        ) : null}
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

      <div className="flex flex-col gap-2">
        {displayedTimelineItems.length ? (
          displayedTimelineItems.map((item) => (
            <PanelSection key={item.id} className="border-latte-surface2/60 rounded-2xl border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={stateTone(item.state)} size="sm" animateIcon={false}>
                    {formatStateLabel(item.state)}
                  </Badge>
                  <span className="text-latte-subtext0 truncate text-xs">{item.reason}</span>
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
};
