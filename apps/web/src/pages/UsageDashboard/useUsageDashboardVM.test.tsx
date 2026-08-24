import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  SessionSummary,
  UsageDashboardResponse,
  UsageGlobalTimelineResponse,
  UsageProviderSnapshot,
} from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { defaultLaunchConfig } from "@/state/launch-agent-options";
import { createAppQueryClient } from "@/state/query-client";

import { useUsageDashboardVM } from "./useUsageDashboardVM";

const mockUseSessions = vi.hoisted(() => vi.fn());
const mockUseUsageApi = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/state/session-context", () => ({
  useSessionStreamData: () => mockUseSessions(),
  useSessionConfigData: () => mockUseSessions(),
  useSessionCoreApi: () => mockUseSessions(),
  useSessionBranchesApi: () => mockUseSessions(),
  useSessionLaunchApi: () => mockUseSessions(),
}));

vi.mock("@/state/use-usage-api", () => ({
  useUsageApi: (...args: unknown[]) => mockUseUsageApi(...args),
}));

vi.mock("@/state/theme-context", () => ({
  useTheme: () => ({ resolvedTheme: "latte" }),
}));

vi.mock("@/lib/use-now-ms", () => ({
  useNowMs: () => 0,
}));

vi.mock("@/lib/use-sidebar-width", () => ({
  useSidebarWidth: () => ({
    sidebarWidth: 280,
    handlePointerDown: vi.fn(),
  }),
}));

vi.mock("@/lib/session-group", () => ({
  buildSessionGroups: () => [],
}));

vi.mock("@/features/pwa-tabs/context/workspace-tabs-context", () => ({
  useWorkspaceTabs: () => ({
    enabled: false,
    openSessionTab: vi.fn(),
  }),
}));

vi.mock("@/features/shared-session-ui/hooks/useSessionListPins", () => ({
  useSessionListPins: () => ({
    getRepoSortAnchorAt: () => 0,
    touchRepoPin: vi.fn(),
    touchPanePin: vi.fn(),
  }),
}));

vi.mock("@/features/shared-session-ui/hooks/useSessionLogs", () => ({
  useSessionLogs: () => ({
    quickPanelOpen: false,
    logModalOpen: false,
    selectedPaneId: null,
    selectedSession: null,
    selectedLogLines: [],
    selectedLogLoading: false,
    selectedLogError: null,
    openLogModal: vi.fn(),
    closeLogModal: vi.fn(),
    toggleQuickPanel: vi.fn(),
    closeQuickPanel: vi.fn(),
  }),
}));

const NOW_ISO = "2026-02-27T00:00:00.000Z";

const createWrapper = () => {
  const queryClient = createAppQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const createBilling = (): UsageProviderSnapshot["billing"] => ({
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
});

const createProviderSnapshot = (providerId: "codex" | "claude"): UsageProviderSnapshot => ({
  providerId,
  providerLabel: providerId === "codex" ? "Codex" : "Claude",
  accountLabel: null,
  planLabel: null,
  windows: [],
  billing: createBilling(),
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
  fetchedAt: NOW_ISO,
  staleAt: NOW_ISO,
});

const createDashboardResponse = (fetchedAt = NOW_ISO): UsageDashboardResponse => ({
  providers: [
    {
      ...createProviderSnapshot("codex"),
      fetchedAt,
      staleAt: fetchedAt,
    },
    {
      ...createProviderSnapshot("claude"),
      fetchedAt,
      staleAt: fetchedAt,
    },
  ],
  fetchedAt,
});

const createTimelineResponse = (fetchedAt = NOW_ISO): UsageGlobalTimelineResponse => ({
  timeline: {
    paneId: "global",
    now: fetchedAt,
    range: "24h",
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
  paneCount: 0,
  activePaneCount: 0,
  fetchedAt,
});

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
};

describe("useUsageDashboardVM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessions.mockReturnValue({
      token: "token",
      apiBaseUrl: "/api",
      sessions: [] as SessionSummary[],
      connected: true,
      connectionIssue: null,
      launchConfig: defaultLaunchConfig,
      capabilities: { screenImage: true, launchAgent: true, resumeAgent: true },
      requestWorktrees: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      launchAgentInSession: vi.fn(),
      touchSession: vi.fn(),
      highlightCorrections: { codex: true, claude: true },
    });
  });

  it("replaces a cold billing request once and deduplicates concurrent manual refreshes", async () => {
    let resolveCodexBilling: ((value: UsageProviderSnapshot) => void) | undefined;
    const codexBillingPromise = new Promise<UsageProviderSnapshot>((resolve) => {
      resolveCodexBilling = resolve;
    });

    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude"; refresh?: boolean }) => {
        if (provider === "codex") {
          return codexBillingPromise;
        }
        return createProviderSnapshot("claude");
      },
    );

    mockUseUsageApi.mockReturnValue({
      requestUsageDashboard: vi.fn(async () => createDashboardResponse()),
      requestUsageProviderBilling,
      requestUsageGlobalTimeline: vi.fn(async () => createTimelineResponse()),
      requestUsageRepositoryActivity: vi.fn(async () => ({
        range: "24h" as const,
        rangeStart: "2026-02-26T00:00:00.000Z",
        rangeEnd: NOW_ISO,
        coverage: {
          status: "complete" as const,
          trackingStartedAt: "2026-02-01T00:00:00.000Z",
          gapDurationMs: 0,
          unattributedRunningMs: 0,
          unattributedCompletedRunCount: 0,
          unverifiedCompletedRunCount: 0,
        },
        items: [],
        fetchedAt: NOW_ISO,
      })),
      resolveErrorMessage: (_error: unknown, fallback: string) => fallback,
    });

    const { result } = renderHook(() => useUsageDashboardVM(), { wrapper: createWrapper() });

    await waitFor(() => {
      const codexCalls = requestUsageProviderBilling.mock.calls.filter(
        ([args]) => args.provider === "codex",
      );
      expect(codexCalls).toHaveLength(1);
    });

    await act(async () => {
      result.current.onRefreshAll();
      result.current.onRefreshAll();
    });

    await waitFor(() => {
      const codexCalls = requestUsageProviderBilling.mock.calls.filter(
        ([args]) => args.provider === "codex",
      );
      expect(codexCalls.map(([args]) => args.refresh)).toEqual([false, true]);
    });

    resolveCodexBilling?.(createProviderSnapshot("codex"));

    await waitFor(() => {
      expect(result.current.billingLoadingByProvider.codex).toBe(false);
      expect(result.current.billingRefreshingByProvider.codex).toBe(false);
    });
  });

  it("ignores stale dashboard and timeline responses when a newer refresh finishes first", async () => {
    const firstDashboard = createDeferred<UsageDashboardResponse>();
    const firstTimeline = createDeferred<UsageGlobalTimelineResponse>();

    const requestUsageDashboard = vi
      .fn()
      .mockReturnValueOnce(firstDashboard.promise)
      .mockResolvedValueOnce(createDashboardResponse("2026-02-27T00:00:02.000Z"));
    const requestUsageGlobalTimeline = vi
      .fn()
      .mockReturnValueOnce(firstTimeline.promise)
      .mockResolvedValueOnce(createTimelineResponse("2026-02-27T00:00:02.000Z"));

    mockUseUsageApi.mockReturnValue({
      requestUsageDashboard,
      requestUsageProviderBilling: vi.fn(async ({ provider }: { provider: "codex" | "claude" }) =>
        createProviderSnapshot(provider),
      ),
      requestUsageGlobalTimeline,
      requestUsageRepositoryActivity: vi.fn(async () => ({
        range: "24h" as const,
        rangeStart: "2026-02-26T00:00:00.000Z",
        rangeEnd: NOW_ISO,
        coverage: {
          status: "complete" as const,
          trackingStartedAt: "2026-02-01T00:00:00.000Z",
          gapDurationMs: 0,
          unattributedRunningMs: 0,
          unattributedCompletedRunCount: 0,
          unverifiedCompletedRunCount: 0,
        },
        items: [],
        fetchedAt: NOW_ISO,
      })),
      resolveErrorMessage: (_error: unknown, fallback: string) => fallback,
    });

    const { result } = renderHook(() => useUsageDashboardVM(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.onRefreshAll();
    });

    await waitFor(() => {
      expect(result.current.dashboard?.fetchedAt).toBe("2026-02-27T00:00:02.000Z");
      expect(result.current.timeline?.fetchedAt).toBe("2026-02-27T00:00:02.000Z");
    });

    await act(async () => {
      firstDashboard.resolve(createDashboardResponse("2026-02-27T00:00:01.000Z"));
      firstTimeline.resolve(createTimelineResponse("2026-02-27T00:00:01.000Z"));
    });

    await waitFor(() => {
      expect(result.current.dashboard?.fetchedAt).toBe("2026-02-27T00:00:02.000Z");
      expect(result.current.timeline?.fetchedAt).toBe("2026-02-27T00:00:02.000Z");
    });
    expect(requestUsageDashboard).toHaveBeenCalledTimes(2);
    expect(requestUsageGlobalTimeline).toHaveBeenCalledTimes(2);
  });

  it("starts forced billing after dashboard succeeds without waiting for other resources", async () => {
    const refreshedDashboard = createDeferred<UsageDashboardResponse>();
    const refreshedTimeline = createDeferred<UsageGlobalTimelineResponse>();
    const refreshedActivity = createDeferred<{
      range: "24h";
      rangeStart: string;
      rangeEnd: string;
      coverage: {
        status: "complete";
        trackingStartedAt: string;
        gapDurationMs: number;
        unattributedRunningMs: number;
        unattributedCompletedRunCount: number;
        unverifiedCompletedRunCount: number;
      };
      items: never[];
      fetchedAt: string;
    }>();
    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude"; refresh?: boolean }) =>
        createProviderSnapshot(provider),
    );
    const requestUsageDashboard = vi
      .fn()
      .mockResolvedValueOnce(createDashboardResponse())
      .mockReturnValueOnce(refreshedDashboard.promise);
    const requestUsageGlobalTimeline = vi
      .fn()
      .mockResolvedValueOnce(createTimelineResponse())
      .mockReturnValueOnce(refreshedTimeline.promise);
    const initialActivity = {
      range: "24h" as const,
      rangeStart: "2026-02-26T00:00:00.000Z",
      rangeEnd: NOW_ISO,
      coverage: {
        status: "complete" as const,
        trackingStartedAt: "2026-02-01T00:00:00.000Z",
        gapDurationMs: 0,
        unattributedRunningMs: 0,
        unattributedCompletedRunCount: 0,
        unverifiedCompletedRunCount: 0,
      },
      items: [],
      fetchedAt: NOW_ISO,
    };
    const requestUsageRepositoryActivity = vi
      .fn()
      .mockResolvedValueOnce(initialActivity)
      .mockReturnValueOnce(refreshedActivity.promise);

    mockUseUsageApi.mockReturnValue({
      requestUsageDashboard,
      requestUsageProviderBilling,
      requestUsageGlobalTimeline,
      requestUsageRepositoryActivity,
      resolveErrorMessage: (_error: unknown, fallback: string) => fallback,
    });

    const { result } = renderHook(() => useUsageDashboardVM(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        requestUsageProviderBilling.mock.calls.filter(([args]) => args.refresh !== true),
      ).toHaveLength(2);
    });

    act(() => result.current.onRefreshAll());
    await act(async () => {
      refreshedDashboard.resolve(createDashboardResponse("2026-02-27T00:00:02.000Z"));
    });

    await waitFor(() => {
      expect(
        requestUsageProviderBilling.mock.calls.filter(([args]) => args.refresh === true),
      ).toHaveLength(2);
    });
    expect(requestUsageGlobalTimeline).toHaveBeenCalledTimes(2);
    expect(requestUsageRepositoryActivity).toHaveBeenCalledTimes(2);
  });

  it("does not force billing when the dashboard refresh fails", async () => {
    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude"; refresh?: boolean }) =>
        createProviderSnapshot(provider),
    );
    const requestUsageDashboard = vi
      .fn()
      .mockResolvedValueOnce(createDashboardResponse())
      .mockRejectedValueOnce(new Error("dashboard failed"));

    mockUseUsageApi.mockReturnValue({
      requestUsageDashboard,
      requestUsageProviderBilling,
      requestUsageGlobalTimeline: vi.fn(async () => createTimelineResponse()),
      requestUsageRepositoryActivity: vi.fn(async () => ({
        range: "24h" as const,
        rangeStart: "2026-02-26T00:00:00.000Z",
        rangeEnd: NOW_ISO,
        coverage: {
          status: "complete" as const,
          trackingStartedAt: "2026-02-01T00:00:00.000Z",
          gapDurationMs: 0,
          unattributedRunningMs: 0,
          unattributedCompletedRunCount: 0,
          unverifiedCompletedRunCount: 0,
        },
        items: [],
        fetchedAt: NOW_ISO,
      })),
      resolveErrorMessage: (_error: unknown, fallback: string) => fallback,
    });

    const { result } = renderHook(() => useUsageDashboardVM(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        requestUsageProviderBilling.mock.calls.filter(([args]) => args.refresh !== true),
      ).toHaveLength(2);
    });
    act(() => result.current.onRefreshAll());
    await waitFor(() => expect(requestUsageDashboard).toHaveBeenCalledTimes(2));
    await act(async () => Promise.resolve());

    expect(
      requestUsageProviderBilling.mock.calls.filter(([args]) => args.refresh === true),
    ).toHaveLength(0);
  });
});
