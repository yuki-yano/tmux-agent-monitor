import { fireEvent, render, screen, within } from "@testing-library/react";
import type { UsageGlobalTimelineResponse, UsageProviderSnapshot } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import * as pwaDisplayMode from "@/lib/pwa-display-mode";

import { UsageDashboardView } from "./UsageDashboardView";
import type { UsageDashboardVM } from "./useUsageDashboardVM";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock("@/features/shared-session-ui/components/SessionSidebar", () => ({
  SessionSidebar: () => <div data-testid="session-sidebar" />,
}));

const createProvider = (
  providerId: "codex" | "claude",
  overrides: Partial<UsageProviderSnapshot> = {},
): UsageProviderSnapshot => ({
  providerId,
  providerLabel: providerId === "codex" ? "Codex" : "Claude",
  accountLabel: null,
  planLabel: null,
  windows: [
    {
      id: "session",
      title: "Session",
      utilizationPercent: 10,
      windowDurationMs: 300 * 60 * 1000,
      resetsAt: "2026-02-24T12:00:00.000Z",
      pace: {
        elapsedPercent: 20,
        projectedEndUtilizationPercent: 50,
        paceMarginPercent: 30,
        status: "margin",
      },
    },
    {
      id: "weekly",
      title: "Weekly",
      utilizationPercent: 40,
      windowDurationMs: 10_080 * 60 * 1000,
      resetsAt: "2026-02-28T12:00:00.000Z",
      pace: {
        elapsedPercent: 30,
        projectedEndUtilizationPercent: 70,
        paceMarginPercent: 10,
        status: "balanced",
      },
    },
  ],
  billing: {
    creditsLeft: null,
    creditsUnit: null,
    extraUsageUsedUsd: null,
    extraUsageLimitUsd: null,
    costTodayUsd: null,
    costTodayTokens: null,
    costLast30DaysUsd: null,
    costLast30DaysTokens: null,
    meta: {
      source: "unavailable",
      sourceLabel: null,
      confidence: null,
      updatedAt: null,
      reasonCode: null,
      reasonMessage: null,
    },
    modelBreakdown: [],
    dailyBreakdown: [],
  },
  capabilities: {
    session: true,
    weekly: true,
    pace: true,
    modelWindows: false,
    credits: false,
    extraUsage: false,
    cost: false,
  },
  status: "ok",
  issues: [],
  fetchedAt: "2026-02-24T12:00:00.000Z",
  staleAt: "2026-02-24T12:03:00.000Z",
  ...overrides,
});

const createTimeline = (
  overrides: Partial<UsageGlobalTimelineResponse> = {},
): UsageGlobalTimelineResponse => ({
  timeline: {
    paneId: "global",
    now: "2026-02-25T00:00:00.000Z",
    range: "1h",
    items: [],
    totalsMs: {
      RUNNING: 0,
      DONE: 0,
      WAITING_INPUT: 0,
      WAITING_PERMISSION: 0,
      SHELL: 0,
      UNKNOWN: 0,
    },
    current: null,
  },
  paneCount: 3,
  activePaneCount: 2,
  fetchedAt: "2026-02-25T00:00:00.000Z",
  ...overrides,
});

const createViewModel = (
  codexProvider: UsageProviderSnapshot,
  overrides: Partial<UsageDashboardVM> = {},
): UsageDashboardVM => ({
  sessions: [],
  connected: true,
  connectionIssue: null,
  launchConfig: {} as UsageDashboardVM["launchConfig"],
  capabilities: { screenImage: true, launchAgent: true, resumeAgent: true },
  requestWorktrees: vi.fn() as UsageDashboardVM["requestWorktrees"],
  requestStateTimeline: vi.fn() as UsageDashboardVM["requestStateTimeline"],
  requestScreen: vi.fn() as UsageDashboardVM["requestScreen"],
  highlightCorrections: {} as UsageDashboardVM["highlightCorrections"],
  resolvedTheme: "latte",
  sidebarSessionGroups: [],
  sidebarWidth: 280,
  dashboard: {
    providers: [codexProvider, createProvider("claude", { windows: [] })],
    fetchedAt: "2026-02-24T12:00:00.000Z",
  },
  dashboardLoading: false,
  dashboardRefreshing: false,
  billingLoadingByProvider: {
    codex: false,
    claude: false,
  },
  billingRefreshingByProvider: {
    codex: false,
    claude: false,
  },
  dashboardError: null,
  timeline: null,
  timelineLoading: false,
  timelineRefreshing: false,
  timelineError: null,
  timelineRange: "1h",
  repositoryActivity: null,
  repositoryActivityLoading: false,
  repositoryActivityRefreshing: false,
  repositoryActivityError: null,
  repositoryActivityRange: "24h",
  compactTimeline: false,
  nowMs: Date.now(),
  onTimelineRangeChange: vi.fn(),
  onRepositoryActivityRangeChange: vi.fn(),
  onToggleCompactTimeline: vi.fn(),
  onRefreshAll: vi.fn(),
  quickPanelGroups: [],
  quickPanelOpen: false,
  logModalOpen: false,
  selectedSession: null,
  selectedLogLines: [],
  selectedLogLoading: false,
  selectedLogError: null,
  onOpenLogModal: vi.fn(),
  onCloseLogModal: vi.fn(),
  onToggleQuickPanel: vi.fn(),
  onCloseQuickPanel: vi.fn(),
  onOpenPaneHere: vi.fn(),
  onOpenPaneInNewWindow: vi.fn(),
  onSidebarResizeStart: vi.fn(),
  onLaunchAgentInSession: vi.fn() as UsageDashboardVM["onLaunchAgentInSession"],
  onTouchPanePin: vi.fn(),
  onTouchRepoPin: vi.fn(),
  onOpenHere: vi.fn(),
  onOpenNewTab: vi.fn(),
  ...overrides,
});

describe("UsageDashboardView", () => {
  it("renders desktop sidebar shell", () => {
    render(<UsageDashboardView {...createViewModel(createProvider("codex"))} />);

    expect(screen.getByTestId("session-sidebar")).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeTruthy();
  });

  it("shows history controls only in pwa display mode", () => {
    const usePwaDisplayModeSpy = vi.spyOn(pwaDisplayMode, "usePwaDisplayMode");
    const viewModel = createViewModel(createProvider("codex"));
    usePwaDisplayModeSpy.mockReturnValue(false);
    const { rerender } = render(<UsageDashboardView {...viewModel} />);

    expect(screen.queryByLabelText("Go back")).toBeNull();
    expect(screen.queryByLabelText("Go forward")).toBeNull();

    usePwaDisplayModeSpy.mockReturnValue(true);
    rerender(<UsageDashboardView {...viewModel} />);

    expect(screen.getByLabelText("Go back")).toBeTruthy();
    expect(screen.getByLabelText("Go forward")).toBeTruthy();

    usePwaDisplayModeSpy.mockRestore();
  });

  it("calls browser history methods from history controls", () => {
    const usePwaDisplayModeSpy = vi.spyOn(pwaDisplayMode, "usePwaDisplayMode");
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const forwardSpy = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    usePwaDisplayModeSpy.mockReturnValue(true);
    render(<UsageDashboardView {...createViewModel(createProvider("codex"))} />);

    fireEvent.click(screen.getByLabelText("Go back"));
    fireEvent.click(screen.getByLabelText("Go forward"));

    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(forwardSpy).toHaveBeenCalledTimes(1);

    usePwaDisplayModeSpy.mockRestore();
    backSpy.mockRestore();
    forwardSpy.mockRestore();
  });

  it("hides session metric when capabilities.session is false", () => {
    const codex = createProvider("codex", {
      capabilities: {
        session: false,
        weekly: true,
        pace: true,
        modelWindows: false,
        credits: false,
        extraUsage: false,
        cost: false,
      },
    });

    render(<UsageDashboardView {...createViewModel(codex)} />);

    expect(screen.queryByText("Session")).toBeNull();
    expect(screen.getByText("Weekly")).toBeTruthy();
  });

  it("renders session metric when capabilities.session is true", () => {
    const codex = createProvider("codex");

    render(<UsageDashboardView {...createViewModel(codex)} />);

    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
  });

  it("groups the reset countdown and deadline above buffer and pace", () => {
    const resetAt = new Date(2026, 1, 27, 10, 5);
    const codex = createProvider("codex", {
      windows: [
        {
          id: "session",
          title: "Session",
          utilizationPercent: 10,
          windowDurationMs: 300 * 60 * 1000,
          resetsAt: resetAt.toISOString(),
          pace: {
            elapsedPercent: 20,
            projectedEndUtilizationPercent: 50,
            paceMarginPercent: 30,
            status: "margin",
          },
        },
      ],
    });

    render(
      <UsageDashboardView
        {...createViewModel(codex, {
          nowMs: new Date(2026, 1, 27, 9, 5).getTime(),
        })}
      />,
    );

    const countdown = screen.getByText("Resets in 1h");
    const deadline = screen.getByText("Feb 27 · 10:05");
    const buffer = screen.getByText("Buffer +10%");

    expect(countdown.parentElement).toBe(deadline.parentElement);
    expect(buffer.parentElement).not.toBe(countdown.parentElement);
    expect(deadline.tagName).toBe("TIME");
    expect(deadline.getAttribute("datetime")).toBe(resetAt.toISOString());
    expect(deadline.className).toContain("whitespace-nowrap");
    expect(deadline.className).toContain("shrink-0");
    expect(deadline.className).toContain("rounded-full");
    expect(deadline.className).toContain("border");
  });

  it("renders used/elapsed percent with shared formatting across all windows", () => {
    const codex = createProvider("codex", {
      windows: [
        {
          id: "session",
          title: "Session",
          utilizationPercent: 10,
          windowDurationMs: 300 * 60 * 1000,
          resetsAt: "2026-02-24T12:00:00.000Z",
          pace: {
            elapsedPercent: 20,
            projectedEndUtilizationPercent: 50,
            paceMarginPercent: 30,
            status: "margin",
          },
        },
        {
          id: "weekly",
          title: "Weekly",
          utilizationPercent: 40,
          windowDurationMs: 10_080 * 60 * 1000,
          resetsAt: "2026-02-28T12:00:00.000Z",
          pace: {
            elapsedPercent: 30,
            projectedEndUtilizationPercent: 70,
            paceMarginPercent: 10,
            status: "balanced",
          },
        },
        {
          id: "model",
          title: "Sonnet Weekly",
          utilizationPercent: 12,
          windowDurationMs: 10_080 * 60 * 1000,
          resetsAt: "2026-02-28T12:00:00.000Z",
          pace: {
            elapsedPercent: 8.5,
            projectedEndUtilizationPercent: 141.2,
            paceMarginPercent: -41.2,
            status: "over",
          },
        },
      ],
    });

    render(<UsageDashboardView {...createViewModel(codex)} />);

    expect(screen.getByText("10% / 20%")).toBeTruthy();
    expect(screen.getByText("40% / 30%")).toBeTruthy();
    expect(screen.getByText("12% / 8.5%")).toBeTruthy();
  });

  it("colors usage bars by relative position to elapsed line", () => {
    const codex = createProvider("codex", {
      windows: [
        {
          id: "session",
          title: "Ahead",
          utilizationPercent: 10,
          windowDurationMs: 300 * 60 * 1000,
          resetsAt: "2026-02-24T12:00:00.000Z",
          pace: {
            elapsedPercent: 20,
            projectedEndUtilizationPercent: 50,
            paceMarginPercent: 10,
            status: "margin",
          },
        },
        {
          id: "weekly",
          title: "Near pace",
          utilizationPercent: 24,
          windowDurationMs: 10_080 * 60 * 1000,
          resetsAt: "2026-02-28T12:00:00.000Z",
          pace: {
            elapsedPercent: 20,
            projectedEndUtilizationPercent: 96,
            paceMarginPercent: 4,
            status: "margin",
          },
        },
        {
          id: "model",
          title: "Over pace",
          utilizationPercent: 35,
          windowDurationMs: 10_080 * 60 * 1000,
          resetsAt: "2026-02-28T12:00:00.000Z",
          pace: {
            elapsedPercent: 20,
            projectedEndUtilizationPercent: 175,
            paceMarginPercent: -15,
            status: "over",
          },
        },
      ],
    });

    const { container } = render(<UsageDashboardView {...createViewModel(codex)} />);

    expect(container.querySelectorAll('[class*="bg-latte-green/85"]')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="bg-latte-yellow/85"]')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="bg-latte-red/85"]')).toHaveLength(1);
  });

  it("keeps pace and buffer badges yellow in relaxed near-pace range", () => {
    const codex = createProvider("codex", {
      windows: [
        {
          id: "session",
          title: "Session",
          utilizationPercent: 24,
          windowDurationMs: 300 * 60 * 1000,
          resetsAt: "2026-02-24T12:00:00.000Z",
          pace: {
            elapsedPercent: 20,
            projectedEndUtilizationPercent: 96,
            paceMarginPercent: 4,
            status: "margin",
          },
        },
      ],
    });

    render(<UsageDashboardView {...createViewModel(codex)} />);

    const bufferBadge = screen.getByText("Buffer -4%");
    const paceBadge = screen.getByText("Pace +4% margin");

    expect(bufferBadge.className).toContain("text-latte-yellow");
    expect(bufferBadge.className).not.toContain("text-latte-red");
    expect(bufferBadge.className).not.toContain("text-latte-green");
    expect(paceBadge.className).toContain("text-latte-yellow");
    expect(paceBadge.className).not.toContain("text-latte-red");
    expect(paceBadge.className).not.toContain("text-latte-green");
  });

  it("does not render repo ranking section", () => {
    render(
      <UsageDashboardView
        {...createViewModel(createProvider("codex"), {
          timeline: createTimeline(),
        })}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Active Repository" })).toBeNull();
    expect(screen.queryByText("Running Time (Sum)")).toBeNull();
    expect(screen.queryByText("Running Time (Union)")).toBeNull();
    expect(screen.queryByText("RUNNING Transitions")).toBeNull();
    expect(screen.getByRole("heading", { name: "Global State Timeline" })).toBeTruthy();
  });

  it("switches aggregation range from timeline range tabs", () => {
    const onTimelineRangeChange = vi.fn();
    render(
      <UsageDashboardView
        {...createViewModel(createProvider("codex"), {
          timeline: createTimeline(),
          timelineRange: "24h",
          onTimelineRangeChange,
        })}
      />,
    );

    expect(screen.queryByRole("tab", { name: "15m" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "1h" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "3h" })).toBeNull();
    const timelineSection = screen
      .getByRole("heading", { name: "Global State Timeline" })
      .closest("section");
    expect(timelineSection).not.toBeNull();
    expect(within(timelineSection!).getByRole("tab", { name: "14d" })).toBeTruthy();
    expect(within(timelineSection!).getByRole("tab", { name: "30d" })).toBeTruthy();

    const rangeTab = within(timelineSection!).getByRole("tab", { name: "30d" });
    fireEvent.mouseDown(rangeTab, { button: 0 });
    expect(onTimelineRangeChange).toHaveBeenCalledWith("30d");
  });

  it("renders DONE timeline segments in blue and counts them as Waiting", () => {
    const doneItem = {
      id: "done",
      paneId: "global",
      state: "DONE" as const,
      reason: "completion_pending_acknowledgement",
      startedAt: "2026-02-24T23:50:00.000Z",
      endedAt: null,
      durationMs: 10 * 60 * 1000,
      source: "poll" as const,
    };
    const timeline = createTimeline();
    timeline.timeline.items = [doneItem];
    timeline.timeline.current = doneItem;
    timeline.timeline.totalsMs.DONE = doneItem.durationMs;

    const { container } = render(
      <UsageDashboardView
        {...createViewModel(createProvider("codex"), {
          timeline,
        })}
      />,
    );

    const doneBadge = screen.getByText("DONE").closest("span");
    expect(doneBadge?.className).toContain("text-latte-blue");
    expect(screen.getByText("Waiting 10m")).toBeTruthy();
    expect(container.querySelector('[title^="DONE"]')?.className).toContain("bg-latte-blue/80");
  });

  it("renders usage breakdown dates in local time zone", () => {
    const codex = createProvider("codex");
    codex.billing = {
      ...codex.billing,
      meta: {
        ...codex.billing.meta,
        source: "actual",
      },
      dailyBreakdown: [
        {
          date: "2026-02-24",
          modelIds: ["gpt-5"],
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 150,
          usd: 1.23,
        },
      ],
    };

    render(<UsageDashboardView {...createViewModel(codex)} />);

    fireEvent.click(screen.getByRole("button", { name: "Usage breakdown (last 30 days)" }));

    const expectedDate = new Date(2026, 1, 24).toLocaleDateString();
    expect(screen.getByText(expectedDate)).toBeTruthy();
  });
});
