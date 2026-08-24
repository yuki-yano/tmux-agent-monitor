import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UsageDashboardResponse, UsageProviderSnapshot } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { createUsageDashboardQueryScope } from "./usage-dashboard-query-keys";
import { useUsageBillingData } from "./useUsageBillingData";

const createProvider = (providerId: "codex" | "claude"): UsageProviderSnapshot => ({
  providerId,
  providerLabel: providerId,
  accountLabel: null,
  planLabel: null,
  windows: [],
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
  fetchedAt: "2026-08-25T00:00:00.000Z",
  staleAt: "2026-08-25T00:00:00.000Z",
});

const createDashboard = (fetchedAt: string): UsageDashboardResponse => ({
  providers: [createProvider("codex"), createProvider("claude")],
  fetchedAt,
});

const createWrapper = () => {
  const queryClient = createAppQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
};

describe("useUsageBillingData", () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("waits for dashboard core and preserves projected billing across core polling updates", async () => {
    const billingByProvider = {
      codex: {
        ...createProvider("codex"),
        billing: { ...createProvider("codex").billing, costTodayUsd: 12 },
        capabilities: { ...createProvider("codex").capabilities, cost: true },
      },
      claude: createProvider("claude"),
    };
    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude" }) => billingByProvider[provider],
    );
    const props: { dashboardCore: UsageDashboardResponse | null } = { dashboardCore: null };
    const { result, rerender } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: props.dashboardCore,
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    expect(requestUsageProviderBilling).not.toHaveBeenCalled();
    props.dashboardCore = createDashboard("2026-08-25T00:00:00.000Z");
    rerender();
    await waitFor(() => expect(requestUsageProviderBilling).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.dashboard?.providers[0]?.billing.costTodayUsd).toBe(12),
    );

    props.dashboardCore = createDashboard("2026-08-25T00:00:30.000Z");
    rerender();
    expect(result.current.dashboard?.fetchedAt).toBe("2026-08-25T00:00:30.000Z");
    expect(result.current.dashboard?.providers[0]?.billing.costTodayUsd).toBe(12);
    expect(requestUsageProviderBilling).toHaveBeenCalledTimes(2);

    props.dashboardCore = {
      providers: [createProvider("claude")],
      fetchedAt: "2026-08-25T00:01:00.000Z",
    };
    rerender();
    expect(result.current.dashboard?.providers.map((provider) => provider.providerId)).toEqual([
      "claude",
    ]);
  });

  it("projects a provider billing error without replacing dashboard core", async () => {
    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude" }) => {
        if (provider === "codex") throw new Error("billing unavailable");
        return createProvider("claude");
      },
    );
    const { result } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling,
          resolveErrorMessage: (error) => (error as Error).message,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.dashboard?.providers[0]?.billing.meta.reasonMessage).toBe(
        "billing unavailable",
      );
    });
    expect(result.current.dashboard?.providers).toHaveLength(2);
  });

  it("cancels an in-flight cold query before starting a forced refresh", async () => {
    const forcedCodex = createDeferred<UsageProviderSnapshot>();
    const requestUsageProviderBilling = vi.fn(
      (
        { provider, refresh }: { provider: "codex" | "claude"; refresh?: boolean },
        signal?: AbortSignal,
      ) => {
        if (provider === "claude") return Promise.resolve(createProvider("claude"));
        if (refresh) return forcedCodex.promise;
        return new Promise<UsageProviderSnapshot>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    );
    const { result } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(requestUsageProviderBilling).toHaveBeenCalledTimes(2));
    act(() => {
      void result.current.loadAllProviderBilling({ forceRefresh: true });
    });
    await waitFor(() => {
      const codexCalls = requestUsageProviderBilling.mock.calls.filter(
        ([options]) => options.provider === "codex",
      );
      expect(codexCalls.map(([options]) => options.refresh)).toEqual([false, true]);
    });
    expect(result.current.billingRefreshingByProvider.codex).toBe(true);

    act(() => forcedCodex.resolve(createProvider("codex")));
    await waitFor(() => expect(result.current.billingLoadingByProvider.codex).toBe(false));
    expect(result.current.billingRefreshingByProvider.codex).toBe(false);
  });

  it("deduplicates concurrent force refreshes for the same provider", async () => {
    const forcedCodex = createDeferred<UsageProviderSnapshot>();
    const requestUsageProviderBilling = vi.fn(
      ({ provider, refresh }: { provider: "codex" | "claude"; refresh?: boolean }) => {
        if (provider === "codex" && refresh) return forcedCodex.promise;
        return Promise.resolve(createProvider(provider));
      },
    );
    const { result } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.billingLoadingByProvider.codex).toBe(false));
    act(() => {
      void result.current.loadAllProviderBilling({ providers: ["codex"], forceRefresh: true });
      void result.current.loadAllProviderBilling({ providers: ["codex"], forceRefresh: true });
    });
    await waitFor(() => expect(result.current.billingRefreshingByProvider.codex).toBe(true));
    expect(
      requestUsageProviderBilling.mock.calls.filter(
        ([options]) => options.provider === "codex" && options.refresh,
      ),
    ).toHaveLength(1);
    expect(result.current.billingLoadingByProvider.codex).toBe(false);

    act(() => forcedCodex.resolve(createProvider("codex")));
    await waitFor(() => expect(result.current.billingRefreshingByProvider.codex).toBe(false));
  });

  it("polls provider billing every 180 seconds", async () => {
    vi.useFakeTimers();
    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude" }) => createProvider(provider),
    );
    renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => Promise.resolve());
    expect(requestUsageProviderBilling).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(179_999));
    expect(requestUsageProviderBilling).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requestUsageProviderBilling).toHaveBeenCalledTimes(4);
  });

  it("does not expose a background poll as cold loading or manual refreshing", async () => {
    vi.useFakeTimers();
    const codexPoll = createDeferred<UsageProviderSnapshot>();
    let codexRequests = 0;
    const requestUsageProviderBilling = vi.fn(({ provider }: { provider: "codex" | "claude" }) => {
      if (provider === "claude") return Promise.resolve(createProvider("claude"));
      codexRequests += 1;
      return codexRequests === 1 ? Promise.resolve(createProvider("codex")) : codexPoll.promise;
    });
    const { result } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.billingLoadingByProvider.codex).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(179_999));
    expect(codexRequests).toBe(2);
    expect(result.current.billingLoadingByProvider.codex).toBe(false);
    expect(result.current.billingRefreshingByProvider.codex).toBe(false);

    act(() => codexPoll.resolve(createProvider("codex")));
  });

  it("starts an offline manual refresh with its invocation scope snapshot", async () => {
    onlineManager.setOnline(false);
    const deferred = createDeferred<UsageProviderSnapshot>();
    const requestA = vi.fn((_options: { provider: "codex" | "claude" }) => deferred.promise);
    const requestB = vi.fn(async ({ provider }: { provider: "codex" | "claude" }) =>
      createProvider(provider),
    );
    const props = {
      queryScope: createUsageDashboardQueryScope("/api-a", "token-a"),
      requestUsageProviderBilling: requestA,
    };
    const { result, rerender } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: props.queryScope,
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling: props.requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.loadAllProviderBilling({
        providers: ["codex"],
        forceRefresh: true,
      });
    });
    await waitFor(() => expect(requestA).toHaveBeenCalledTimes(1));
    expect(requestA).toHaveBeenCalledWith(
      { provider: "codex", refresh: true },
      expect.any(AbortSignal),
    );

    props.queryScope = createUsageDashboardQueryScope("/api-b", "token-b");
    props.requestUsageProviderBilling = requestB;
    rerender();
    expect(result.current.billingRefreshingByProvider.codex).toBe(false);
    expect(requestB).not.toHaveBeenCalled();

    act(() => deferred.resolve(createProvider("codex")));
    await act(async () => refreshPromise);
    expect(requestB).not.toHaveBeenCalled();
  });

  it("starts an explicit provider refresh before the dashboard observer rerenders", async () => {
    const codexRefresh = createDeferred<UsageProviderSnapshot>();
    const requestUsageProviderBilling = vi.fn(
      ({ provider, refresh }: { provider: "codex" | "claude"; refresh?: boolean }) =>
        provider === "codex" && refresh
          ? codexRefresh.promise
          : Promise.resolve(createProvider(provider)),
    );
    const props: { dashboardCore: UsageDashboardResponse | null } = { dashboardCore: null };
    const { result, rerender } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          dashboardCore: props.dashboardCore,
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.loadAllProviderBilling({
        providers: ["codex"],
        forceRefresh: true,
      });
    });
    await waitFor(() => expect(requestUsageProviderBilling).toHaveBeenCalledTimes(1));
    expect(requestUsageProviderBilling).toHaveBeenCalledWith(
      { provider: "codex", refresh: true },
      expect.any(AbortSignal),
    );

    props.dashboardCore = createDashboard("2026-08-25T00:00:00.000Z");
    rerender();
    await waitFor(() => expect(requestUsageProviderBilling).toHaveBeenCalledTimes(2));
    act(() => codexRefresh.resolve(createProvider("codex")));
    await act(async () => refreshPromise);

    expect(
      requestUsageProviderBilling.mock.calls.filter(([options]) => options.provider === "codex"),
    ).toHaveLength(1);
  });

  it("does not start automatic or manual requests when auth is unavailable", async () => {
    const requestUsageProviderBilling = vi.fn(
      async ({ provider }: { provider: "codex" | "claude" }) => createProvider(provider),
    );
    const { result } = renderHook(
      () =>
        useUsageBillingData({
          canRequest: false,
          queryScope: createUsageDashboardQueryScope("/api", ""),
          dashboardCore: createDashboard("2026-08-25T00:00:00.000Z"),
          requestUsageProviderBilling,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => result.current.loadAllProviderBilling({ forceRefresh: true }));

    expect(requestUsageProviderBilling).not.toHaveBeenCalled();
    expect(result.current.billingLoadingByProvider).toEqual({ codex: false, claude: false });
    expect(result.current.billingRefreshingByProvider).toEqual({ codex: false, claude: false });
  });
});
