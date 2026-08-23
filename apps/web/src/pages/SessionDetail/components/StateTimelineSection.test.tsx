import { fireEvent, render, screen } from "@testing-library/react";
import type { SessionStateTimeline } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { StateTimelineSection } from "./StateTimelineSection";

const timeline: SessionStateTimeline = {
  paneId: "pane-1",
  now: "2026-02-06T21:00:00.000Z",
  range: "1h",
  items: [
    {
      id: "latest",
      paneId: "pane-1",
      state: "WAITING_INPUT",
      reason: "inactive_timeout",
      startedAt: "2026-02-06T20:20:00.000Z",
      endedAt: null,
      durationMs: 40 * 60 * 1000,
      source: "poll",
    },
    {
      id: "previous",
      paneId: "pane-1",
      state: "RUNNING",
      reason: "recent_output",
      startedAt: "2026-02-06T20:00:00.000Z",
      endedAt: "2026-02-06T20:20:00.000Z",
      durationMs: 20 * 60 * 1000,
      source: "poll",
    },
  ],
  totalsMs: {
    RUNNING: 20 * 60 * 1000,
    DONE: 0,
    WAITING_INPUT: 40 * 60 * 1000,
    WAITING_PERMISSION: 0,
    SHELL: 0,
    UNKNOWN: 0,
  },
  current: {
    id: "latest",
    paneId: "pane-1",
    state: "WAITING_INPUT",
    reason: "inactive_timeout",
    startedAt: "2026-02-06T20:20:00.000Z",
    endedAt: null,
    durationMs: 40 * 60 * 1000,
    source: "poll",
  },
};

const buildProps = (overrides?: { timelineExpanded?: boolean; isMobile?: boolean }) => ({
  state: {
    timeline,
    timelineScope: "pane" as const,
    timelineRange: "1h" as const,
    hasRepoTimeline: true,
    timelineError: null,
    timelineLoading: false,
    timelineExpanded: overrides?.timelineExpanded ?? false,
    isMobile: overrides?.isMobile ?? false,
  },
  actions: {
    onTimelineScopeChange: vi.fn(),
    onTimelineRangeChange: vi.fn(),
    onTimelineRefresh: vi.fn(),
    onToggleTimelineExpanded: vi.fn(),
  },
});

describe("StateTimelineSection", () => {
  it("shows a timeline load error", () => {
    const props = buildProps();

    render(
      <StateTimelineSection
        {...props}
        state={{ ...props.state, timelineError: "Timeline unavailable" }}
      />,
    );

    expect(screen.getByText("Timeline unavailable")).toBeTruthy();
  });

  it("shows only one history row when collapsed", () => {
    const props = buildProps({ timelineExpanded: false, isMobile: false });
    render(<StateTimelineSection {...props} />);

    expect(screen.getByText("inactive_timeout")).toBeTruthy();
    expect(screen.queryByText("recent_output")).toBeNull();
    expect(screen.getByLabelText("Expand timeline")).toBeTruthy();
  });

  it("shows all history rows when expanded", () => {
    const props = buildProps({ timelineExpanded: true, isMobile: true });
    render(<StateTimelineSection {...props} />);

    expect(screen.getByText("inactive_timeout")).toBeTruthy();
    expect(screen.getByText("recent_output")).toBeTruthy();
    expect(screen.queryByLabelText("Collapse timeline")).toBeNull();
    expect(screen.queryByLabelText("Expand timeline")).toBeNull();
  });

  it("keeps timeline expanded on mobile even when collapsed state is passed", () => {
    const props = buildProps({ timelineExpanded: false, isMobile: true });
    render(<StateTimelineSection {...props} />);

    expect(screen.getByText("inactive_timeout")).toBeTruthy();
    expect(screen.getByText("recent_output")).toBeTruthy();
    expect(screen.queryByLabelText("Collapse timeline")).toBeNull();
    expect(screen.queryByLabelText("Expand timeline")).toBeNull();
  });

  it("uses shared toggle action on desktop", () => {
    const props = buildProps({ timelineExpanded: false, isMobile: false });
    render(<StateTimelineSection {...props} />);

    fireEvent.click(screen.getByLabelText("Expand timeline"));
    expect(props.actions.onToggleTimelineExpanded).toHaveBeenCalledTimes(1);
  });

  it("shows extended range tabs and calls action on selection", () => {
    const props = buildProps({ timelineExpanded: false, isMobile: false });
    render(<StateTimelineSection {...props} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "3h" }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "24h" }), { button: 0 });

    expect(props.actions.onTimelineRangeChange).toHaveBeenNthCalledWith(1, "3h");
    expect(props.actions.onTimelineRangeChange).toHaveBeenNthCalledWith(2, "24h");
  });

  it("switches timeline scope between pane and repo", () => {
    const props = buildProps({ timelineExpanded: false, isMobile: false });
    const { rerender } = render(<StateTimelineSection {...props} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Repo" }), { button: 0 });
    expect(props.actions.onTimelineScopeChange).toHaveBeenNthCalledWith(1, "repo");

    rerender(
      <StateTimelineSection
        {...{
          ...props,
          state: {
            ...props.state,
            timelineScope: "repo",
          },
        }}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Pane" }), { button: 0 });
    expect(props.actions.onTimelineScopeChange).toHaveBeenNthCalledWith(2, "pane");
  });

  it("renders DONE in blue and includes it in Waiting", () => {
    const doneItem = {
      ...timeline.items[0]!,
      state: "DONE" as const,
      reason: "completion_pending_acknowledgement",
    };
    const props = buildProps({ timelineExpanded: false, isMobile: false });
    props.state.timeline = {
      ...timeline,
      items: [doneItem],
      current: doneItem,
      totalsMs: {
        ...timeline.totalsMs,
        WAITING_INPUT: 0,
        DONE: doneItem.durationMs,
      },
    };
    const { container } = render(<StateTimelineSection {...props} />);

    const doneBadge = screen.getByText("DONE").closest("span");
    expect(doneBadge?.className).toContain("text-latte-blue");
    expect(screen.getByText("Waiting 40m")).toBeTruthy();
    expect(container.querySelector('[title^="DONE"]')?.className).toContain("bg-latte-blue/80");
  });
});
