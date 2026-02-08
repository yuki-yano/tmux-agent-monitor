import type {
  SessionStateTimeline,
  SessionStateTimelineItem,
  SessionStateTimelineRange,
  SessionStateTimelineSource,
  SessionStateValue,
} from "@vde-monitor/shared";

const RANGE_MS: Record<SessionStateTimelineRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
};

const DEFAULT_MERGE_GAP_MS = 3_000;
const DEFAULT_BLIP_THRESHOLD_MS = 60_000;
const DEFAULT_MIN_VISIBLE_DURATION_MS = 3_000;

type TimelineSegment = {
  id: string;
  paneId: string;
  state: SessionStateValue;
  reason: string;
  source: SessionStateTimelineSource;
  startedAtMs: number;
  endedAtMs: number;
  isOpen: boolean;
};

type BuildTimelineDisplayOptions = {
  compact?: boolean;
  mergeGapMs?: number;
  blipThresholdMs?: number;
  minVisibleDurationMs?: number;
};

export type TimelineDisplay = {
  items: SessionStateTimelineItem[];
  totalsMs: Record<SessionStateValue, number>;
  current: SessionStateTimelineItem | null;
  condensedCount: number;
};

const parseIsoMs = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const toIso = (value: number) => new Date(value).toISOString();

const createEmptyTotals = (): Record<SessionStateValue, number> => ({
  RUNNING: 0,
  WAITING_INPUT: 0,
  WAITING_PERMISSION: 0,
  SHELL: 0,
  UNKNOWN: 0,
});

const durationMs = (segment: TimelineSegment) =>
  Math.max(0, segment.endedAtMs - segment.startedAtMs);

const toSegments = ({
  timeline,
  nowMs,
  rangeStartMs,
}: {
  timeline: SessionStateTimeline;
  nowMs: number;
  rangeStartMs: number;
}): TimelineSegment[] => {
  return [...timeline.items]
    .map<TimelineSegment | null>((item) => {
      const startMs = parseIsoMs(item.startedAt);
      const endMs = item.endedAt == null ? nowMs : parseIsoMs(item.endedAt);
      if (startMs == null || endMs == null) {
        return null;
      }
      const clippedStartMs = Math.max(startMs, rangeStartMs);
      const clippedEndMs = Math.min(endMs, nowMs);
      if (clippedEndMs <= clippedStartMs) {
        return null;
      }
      return {
        id: item.id,
        paneId: item.paneId,
        state: item.state,
        reason: item.reason,
        source: item.source,
        startedAtMs: clippedStartMs,
        endedAtMs: clippedEndMs,
        isOpen: item.endedAt == null,
      };
    })
    .filter((segment): segment is TimelineSegment => segment != null)
    .sort((a, b) => a.startedAtMs - b.startedAtMs);
};

const mergeAdjacentSameState = (
  segments: TimelineSegment[],
  mergeGapMs: number,
): TimelineSegment[] => {
  if (segments.length <= 1) {
    return segments;
  }
  const merged: TimelineSegment[] = [];
  segments.forEach((segment) => {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.state === segment.state &&
      segment.startedAtMs <= previous.endedAtMs + mergeGapMs
    ) {
      previous.endedAtMs = Math.max(previous.endedAtMs, segment.endedAtMs);
      previous.isOpen = previous.isOpen || segment.isOpen;
      previous.reason = segment.reason;
      previous.source = segment.source;
      previous.id = `${previous.id}+${segment.id}`;
      return;
    }
    merged.push({ ...segment });
  });
  return merged;
};

const collapseShortBlips = (
  segments: TimelineSegment[],
  mergeGapMs: number,
  blipThresholdMs: number,
): TimelineSegment[] => {
  if (segments.length < 3) {
    return segments;
  }
  const nextSegments = [...segments];
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < nextSegments.length - 1; index += 1) {
      const previous = nextSegments[index - 1];
      const current = nextSegments[index];
      const next = nextSegments[index + 1];
      if (!previous || !current || !next) {
        continue;
      }
      if (previous.state !== next.state || current.state === previous.state || current.isOpen) {
        continue;
      }
      if (durationMs(current) > blipThresholdMs) {
        continue;
      }
      const beforeGapMs = current.startedAtMs - previous.endedAtMs;
      const afterGapMs = next.startedAtMs - current.endedAtMs;
      if (beforeGapMs > mergeGapMs || afterGapMs > mergeGapMs) {
        continue;
      }
      const merged: TimelineSegment = {
        ...previous,
        id: `${previous.id}|${current.id}|${next.id}`,
        reason: next.reason,
        source: next.source,
        endedAtMs: Math.max(previous.endedAtMs, next.endedAtMs),
        isOpen: next.isOpen,
      };
      nextSegments.splice(index - 1, 3, merged);
      changed = true;
      break;
    }
  }
  return nextSegments;
};

const filterShortSegments = (
  segments: TimelineSegment[],
  minVisibleDurationMs: number,
): TimelineSegment[] => {
  if (minVisibleDurationMs <= 0) {
    return segments;
  }
  return segments.filter(
    (segment) => segment.isOpen || durationMs(segment) >= minVisibleDurationMs,
  );
};

const toDisplayItems = (
  paneId: string,
  segments: TimelineSegment[],
): SessionStateTimelineItem[] => {
  return [...segments]
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .map((segment, index) => {
      const nextDurationMs = durationMs(segment);
      return {
        id: `${paneId}:${segment.startedAtMs}:${segment.endedAtMs}:${index}`,
        paneId,
        state: segment.state,
        reason: segment.reason,
        startedAt: toIso(segment.startedAtMs),
        endedAt: segment.isOpen ? null : toIso(segment.endedAtMs),
        durationMs: nextDurationMs,
        source: segment.source,
      };
    });
};

const resolveTotals = (items: SessionStateTimelineItem[]): Record<SessionStateValue, number> => {
  const totals = createEmptyTotals();
  items.forEach((item) => {
    totals[item.state] += item.durationMs;
  });
  return totals;
};

export const buildTimelineDisplay = (
  timeline: SessionStateTimeline | null,
  range: SessionStateTimelineRange,
  options: BuildTimelineDisplayOptions = {},
): TimelineDisplay => {
  if (!timeline) {
    return {
      items: [],
      totalsMs: createEmptyTotals(),
      current: null,
      condensedCount: 0,
    };
  }

  const nowMs = parseIsoMs(timeline.now);
  if (nowMs == null) {
    return {
      items: [],
      totalsMs: createEmptyTotals(),
      current: null,
      condensedCount: 0,
    };
  }

  const compact = options.compact ?? true;
  const mergeGapMs = options.mergeGapMs ?? DEFAULT_MERGE_GAP_MS;
  const blipThresholdMs = options.blipThresholdMs ?? DEFAULT_BLIP_THRESHOLD_MS;
  const minVisibleDurationMs = options.minVisibleDurationMs ?? DEFAULT_MIN_VISIBLE_DURATION_MS;
  const rangeStartMs = nowMs - RANGE_MS[range];

  const rawSegments = toSegments({
    timeline,
    nowMs,
    rangeStartMs,
  });
  const normalizedSegments = mergeAdjacentSameState(rawSegments, mergeGapMs);

  let outputSegments = normalizedSegments;
  let condensedCount = 0;
  if (compact) {
    outputSegments = collapseShortBlips(outputSegments, mergeGapMs, blipThresholdMs);
    outputSegments = filterShortSegments(outputSegments, minVisibleDurationMs);
    outputSegments = mergeAdjacentSameState(outputSegments, mergeGapMs);
    condensedCount = Math.max(0, normalizedSegments.length - outputSegments.length);
  }

  const items = toDisplayItems(timeline.paneId, outputSegments);
  const totalsMs = resolveTotals(items);
  const current = items.find((item) => item.endedAt == null) ?? null;
  return {
    items,
    totalsMs,
    current,
    condensedCount,
  };
};
