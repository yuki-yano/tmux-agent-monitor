import type {
  SessionStateTimeline,
  SessionStateTimelineItem,
  SessionStateTimelineSource,
  SessionStateValue,
} from "@vde-monitor/shared";
import { describe, expect, it } from "vitest";

import { buildTimelineDisplay } from "./state-timeline-display";

const PANE_ID = "pane-1";
const NOW_ISO = "2026-02-06T21:00:00.000Z";

const createTimelineItem = ({
  id,
  state,
  startedAt,
  endedAt,
  reason = "reason",
  source = "poll",
}: {
  id: string;
  state: SessionStateValue;
  startedAt: string;
  endedAt: string | null;
  reason?: string;
  source?: SessionStateTimelineSource;
}): SessionStateTimelineItem => {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt ?? NOW_ISO);
  return {
    id,
    paneId: PANE_ID,
    state,
    reason,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endMs - startMs),
    source,
  };
};

const createTimeline = (items: SessionStateTimelineItem[]): SessionStateTimeline => ({
  paneId: PANE_ID,
  now: NOW_ISO,
  range: "1h",
  items,
  totalsMs: {
    RUNNING: 0,
    WAITING_INPUT: 0,
    WAITING_PERMISSION: 0,
    SHELL: 0,
    UNKNOWN: 0,
  },
  current: items.find((item) => item.endedAt === null) ?? null,
});

describe("buildTimelineDisplay", () => {
  it("compacts short running blips between waiting states", () => {
    const timeline = createTimeline([
      createTimelineItem({
        id: "6",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:49:50.000Z",
        endedAt: null,
        reason: "inactive_timeout",
      }),
      createTimelineItem({
        id: "5",
        state: "RUNNING",
        startedAt: "2026-02-06T20:49:00.000Z",
        endedAt: "2026-02-06T20:49:50.000Z",
        reason: "recent_output",
      }),
      createTimelineItem({
        id: "4",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:45:20.000Z",
        endedAt: "2026-02-06T20:49:00.000Z",
        reason: "inactive_timeout",
      }),
      createTimelineItem({
        id: "3",
        state: "RUNNING",
        startedAt: "2026-02-06T20:45:00.000Z",
        endedAt: "2026-02-06T20:45:20.000Z",
        reason: "recent_output",
      }),
      createTimelineItem({
        id: "2",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:40:00.000Z",
        endedAt: "2026-02-06T20:45:00.000Z",
        reason: "inactive_timeout",
      }),
      createTimelineItem({
        id: "1",
        state: "RUNNING",
        startedAt: "2026-02-06T20:30:00.000Z",
        endedAt: "2026-02-06T20:40:00.000Z",
        reason: "recent_output",
      }),
    ]);

    const display = buildTimelineDisplay(timeline, "1h", { compact: true });

    expect(display.items).toHaveLength(2);
    expect(display.items[0]?.state).toBe("WAITING_INPUT");
    expect(display.items[0]?.durationMs).toBe(20 * 60 * 1000);
    expect(display.items[0]?.endedAt).toBeNull();
    expect(display.items[1]?.state).toBe("RUNNING");
    expect(display.items[1]?.durationMs).toBe(10 * 60 * 1000);
    expect(display.condensedCount).toBe(4);
  });

  it("keeps raw transitions when compact mode is disabled", () => {
    const timeline = createTimeline([
      createTimelineItem({
        id: "4",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:55:00.000Z",
        endedAt: null,
      }),
      createTimelineItem({
        id: "3",
        state: "RUNNING",
        startedAt: "2026-02-06T20:54:40.000Z",
        endedAt: "2026-02-06T20:55:00.000Z",
      }),
      createTimelineItem({
        id: "2",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:50:00.000Z",
        endedAt: "2026-02-06T20:54:40.000Z",
      }),
      createTimelineItem({
        id: "1",
        state: "RUNNING",
        startedAt: "2026-02-06T20:40:00.000Z",
        endedAt: "2026-02-06T20:50:00.000Z",
      }),
    ]);

    const display = buildTimelineDisplay(timeline, "1h", { compact: false });

    expect(display.items).toHaveLength(4);
    expect(display.items[0]?.state).toBe("WAITING_INPUT");
    expect(display.items[1]?.state).toBe("RUNNING");
    expect(display.condensedCount).toBe(0);
  });

  it("drops very short closed segments in compact mode", () => {
    const timeline = createTimeline([
      createTimelineItem({
        id: "2",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:00:02.000Z",
        endedAt: null,
      }),
      createTimelineItem({
        id: "1",
        state: "RUNNING",
        startedAt: "2026-02-06T20:00:00.000Z",
        endedAt: "2026-02-06T20:00:02.000Z",
      }),
    ]);

    const compactDisplay = buildTimelineDisplay(timeline, "1h", { compact: true });
    const rawDisplay = buildTimelineDisplay(timeline, "1h", { compact: false });

    expect(rawDisplay.items).toHaveLength(2);
    expect(compactDisplay.items).toHaveLength(1);
    expect(compactDisplay.items[0]?.state).toBe("WAITING_INPUT");
  });

  it("always merges adjacent same-state segments", () => {
    const timeline = createTimeline([
      createTimelineItem({
        id: "3",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T20:20:00.000Z",
        endedAt: null,
        reason: "inactive_timeout",
      }),
      createTimelineItem({
        id: "2",
        state: "RUNNING",
        startedAt: "2026-02-06T20:10:00.500Z",
        endedAt: "2026-02-06T20:20:00.000Z",
        reason: "recent_output",
      }),
      createTimelineItem({
        id: "1",
        state: "RUNNING",
        startedAt: "2026-02-06T20:10:00.000Z",
        endedAt: "2026-02-06T20:10:00.500Z",
        reason: "restored",
        source: "restore",
      }),
    ]);

    const display = buildTimelineDisplay(timeline, "1h", { compact: false });

    expect(display.items).toHaveLength(2);
    expect(display.items[1]?.state).toBe("RUNNING");
    expect(display.items[1]?.durationMs).toBe(10 * 60 * 1000);
    expect(display.items[1]?.reason).toBe("recent_output");
  });

  it("keeps long segments in 6h range", () => {
    const timeline = createTimeline([
      createTimelineItem({
        id: "2",
        state: "RUNNING",
        startedAt: "2026-02-06T18:00:00.000Z",
        endedAt: null,
        reason: "recent_output",
      }),
      createTimelineItem({
        id: "1",
        state: "WAITING_INPUT",
        startedAt: "2026-02-06T15:00:00.000Z",
        endedAt: "2026-02-06T18:00:00.000Z",
        reason: "inactive_timeout",
      }),
    ]);

    const display = buildTimelineDisplay(timeline, "6h", { compact: false });

    expect(display.items).toHaveLength(2);
    expect(display.items[0]?.state).toBe("RUNNING");
    expect(display.items[0]?.durationMs).toBe(3 * 60 * 60 * 1000);
    expect(display.items[1]?.state).toBe("WAITING_INPUT");
    expect(display.items[1]?.durationMs).toBe(3 * 60 * 60 * 1000);
    expect(display.totalsMs.RUNNING).toBe(3 * 60 * 60 * 1000);
    expect(display.totalsMs.WAITING_INPUT).toBe(3 * 60 * 60 * 1000);
  });
});
