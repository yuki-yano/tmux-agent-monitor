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

const ALL_STATES: SessionStateValue[] = [
  "RUNNING",
  "WAITING_INPUT",
  "WAITING_PERMISSION",
  "SHELL",
  "UNKNOWN",
];

const DEFAULT_RETENTION_MS = RANGE_MS["6h"];
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_ITEMS_PER_PANE = 1000;

type TimelineEvent = Omit<SessionStateTimelineItem, "durationMs">;
export type SessionTimelinePersistedEvent = TimelineEvent;
export type SessionTimelinePersistedEvents = Record<string, SessionTimelinePersistedEvent[]>;

type StoreOptions = {
  now?: () => Date;
  retentionMs?: number;
  maxItemsPerPane?: number;
};

type RecordStateTransitionInput = {
  paneId: string;
  state: SessionStateValue;
  reason: string;
  at?: string;
  source?: SessionStateTimelineSource;
};

type ClosePaneInput = {
  paneId: string;
  at?: string;
};

type GetTimelineInput = {
  paneId: string;
  range?: SessionStateTimelineRange;
  limit?: number;
};

const toIso = (ms: number) => new Date(ms).toISOString();

const parseIso = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const createEmptyTotals = (): Record<SessionStateValue, number> => ({
  RUNNING: 0,
  WAITING_INPUT: 0,
  WAITING_PERMISSION: 0,
  SHELL: 0,
  UNKNOWN: 0,
});

const parseSequenceFromId = (id: string) => {
  const candidate = id.split(":").at(-1);
  if (!candidate) {
    return 0;
  }
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

export const createSessionTimelineStore = (options: StoreOptions = {}) => {
  const now = options.now ?? (() => new Date());
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxItemsPerPane = options.maxItemsPerPane ?? DEFAULT_MAX_ITEMS_PER_PANE;
  const eventsByPane = new Map<string, TimelineEvent[]>();
  let sequence = 0;

  const nextId = (paneId: string, startedAtMs: number) => {
    sequence += 1;
    return `${paneId}:${startedAtMs}:${sequence}`;
  };

  const resolveAtMs = (at: string | undefined, fallbackMs: number) => {
    const parsed = parseIso(at);
    return parsed == null ? fallbackMs : parsed;
  };

  const getOrCreatePaneEvents = (paneId: string) => {
    const existing = eventsByPane.get(paneId);
    if (existing) {
      return existing;
    }
    const next: TimelineEvent[] = [];
    eventsByPane.set(paneId, next);
    return next;
  };

  const prunePane = (paneId: string, nowMs: number) => {
    const events = eventsByPane.get(paneId);
    if (!events || events.length === 0) {
      return;
    }
    const thresholdMs = nowMs - retentionMs;
    const retained = events.filter((event) => {
      if (!event.endedAt) {
        return true;
      }
      const endedAtMs = parseIso(event.endedAt);
      if (endedAtMs == null) {
        return true;
      }
      return endedAtMs >= thresholdMs;
    });

    const overflow = Math.max(0, retained.length - maxItemsPerPane);
    const next = overflow > 0 ? retained.slice(overflow) : retained;
    events.splice(0, events.length, ...next);
  };

  const record = ({ paneId, state, reason, at, source = "poll" }: RecordStateTransitionInput) => {
    if (!paneId) {
      return;
    }
    const nowMs = now().getTime();
    const events = getOrCreatePaneEvents(paneId);
    prunePane(paneId, nowMs);

    let atMs = resolveAtMs(at, nowMs);
    const last = events.at(-1);
    if (last) {
      const lastStartMs = parseIso(last.startedAt) ?? atMs;
      const lastBoundaryMs = parseIso(last.endedAt) ?? lastStartMs;
      if (atMs < lastBoundaryMs) {
        atMs = lastBoundaryMs;
      }

      if (!last.endedAt) {
        if (last.state === state) {
          last.reason = reason;
          last.source = source;
          return;
        }
        const closeAtMs = Math.max(lastStartMs, atMs);
        last.endedAt = toIso(closeAtMs);
      }
    }

    events.push({
      id: nextId(paneId, atMs),
      paneId,
      state,
      reason,
      startedAt: toIso(atMs),
      endedAt: null,
      source,
    });
    prunePane(paneId, nowMs);
  };

  const closePane = ({ paneId, at }: ClosePaneInput) => {
    if (!paneId) {
      return;
    }
    const events = eventsByPane.get(paneId);
    if (!events || events.length === 0) {
      return;
    }
    const last = events.at(-1);
    if (!last || last.endedAt) {
      return;
    }
    const nowMs = now().getTime();
    const startedAtMs = parseIso(last.startedAt) ?? nowMs;
    const atMs = resolveAtMs(at, nowMs);
    last.endedAt = toIso(Math.max(startedAtMs, atMs));
    prunePane(paneId, nowMs);
  };

  const getTimeline = ({
    paneId,
    range = "1h",
    limit = DEFAULT_LIMIT,
  }: GetTimelineInput): SessionStateTimeline => {
    const nowMs = now().getTime();
    const nowIso = toIso(nowMs);
    prunePane(paneId, nowMs);

    const rangeMs = RANGE_MS[range];
    const rangeStartMs = nowMs - rangeMs;
    const resolvedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_LIMIT;

    const events = eventsByPane.get(paneId) ?? [];
    const totals = createEmptyTotals();

    const withDuration = events
      .map<SessionStateTimelineItem | null>((event) => {
        const startedAtMs = parseIso(event.startedAt);
        if (startedAtMs == null) {
          return null;
        }
        const endedAtMs = parseIso(event.endedAt) ?? nowMs;
        const clippedStartMs = Math.max(startedAtMs, rangeStartMs);
        const clippedEndMs = Math.min(endedAtMs, nowMs);
        const durationMs = Math.max(0, clippedEndMs - clippedStartMs);
        if (durationMs <= 0) {
          return null;
        }
        totals[event.state] += durationMs;
        return { ...event, durationMs };
      })
      .filter((event): event is SessionStateTimelineItem => event != null)
      .sort((a, b) => {
        const aMs = parseIso(a.startedAt) ?? 0;
        const bMs = parseIso(b.startedAt) ?? 0;
        return bMs - aMs;
      });

    const items = withDuration.slice(0, resolvedLimit);
    const current = items.find((item) => item.endedAt == null) ?? null;
    return {
      paneId,
      now: nowIso,
      range,
      items,
      totalsMs: totals,
      current,
    };
  };

  const reset = () => {
    eventsByPane.clear();
  };

  const serialize = (): SessionTimelinePersistedEvents => {
    const nowMs = now().getTime();
    eventsByPane.forEach((_events, paneId) => {
      prunePane(paneId, nowMs);
    });
    const output: SessionTimelinePersistedEvents = {};
    eventsByPane.forEach((events, paneId) => {
      if (events.length === 0) {
        return;
      }
      output[paneId] = events.map((event) => ({ ...event }));
    });
    return output;
  };

  const restore = (
    persisted:
      | SessionTimelinePersistedEvents
      | Map<string, SessionTimelinePersistedEvent[]>
      | null
      | undefined,
  ) => {
    eventsByPane.clear();
    sequence = 0;
    if (!persisted) {
      return;
    }

    const entries =
      persisted instanceof Map ? Array.from(persisted.entries()) : Object.entries(persisted);
    entries.forEach(([paneId, events]) => {
      if (!paneId || !Array.isArray(events)) {
        return;
      }
      const sorted = events
        .map((event) => {
          const startedAtMs = parseIso(event.startedAt);
          if (startedAtMs == null) {
            return null;
          }
          return {
            id:
              typeof event.id === "string" && event.id.length > 0
                ? event.id
                : `${paneId}:${startedAtMs}:0`,
            paneId,
            state: event.state,
            reason: event.reason,
            source: event.source,
            startedAtMs,
            endedAtMs: parseIso(event.endedAt),
          };
        })
        .filter(
          (
            event,
          ): event is {
            id: string;
            paneId: string;
            state: SessionStateValue;
            reason: string;
            source: SessionStateTimelineSource;
            startedAtMs: number;
            endedAtMs: number | null;
          } => event != null,
        )
        .sort((a, b) => a.startedAtMs - b.startedAtMs);

      const restored: TimelineEvent[] = [];
      let lastBoundaryMs = Number.NEGATIVE_INFINITY;
      sorted.forEach((event, index) => {
        const next = sorted[index + 1];
        const nextStartMs = next?.startedAtMs ?? null;
        const startedAtMs = Math.max(event.startedAtMs, lastBoundaryMs);
        let endedAtMs = event.endedAtMs;
        if (endedAtMs == null && nextStartMs != null) {
          endedAtMs = nextStartMs;
        }
        if (endedAtMs != null) {
          endedAtMs = Math.max(endedAtMs, startedAtMs);
        }
        if (endedAtMs != null && endedAtMs === startedAtMs) {
          return;
        }
        restored.push({
          id: event.id,
          paneId,
          state: event.state,
          reason: event.reason,
          startedAt: toIso(startedAtMs),
          endedAt: endedAtMs == null ? null : toIso(endedAtMs),
          source: event.source,
        });
        sequence = Math.max(sequence, parseSequenceFromId(event.id));
        lastBoundaryMs = endedAtMs ?? startedAtMs;
      });
      if (restored.length > 0) {
        eventsByPane.set(paneId, restored);
      }
    });

    const nowMs = now().getTime();
    eventsByPane.forEach((_events, paneId) => {
      prunePane(paneId, nowMs);
    });
  };

  return { record, closePane, getTimeline, reset, serialize, restore };
};

export const timelineRangeMs = RANGE_MS;
export const timelineAllStates = ALL_STATES;
