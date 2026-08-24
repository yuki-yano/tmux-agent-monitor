import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UsageDashboardResponse } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { createUsageDashboardQueryScope } from "./usage-dashboard-query-keys";
import { useUsageDashboardData } from "./useUsageDashboardData";

const createResponse = (fetchedAt = "2026-08-25T00:00:00.000Z"): UsageDashboardResponse => ({
  providers: [],
  fetchedAt,
});

const createWrapper = () => {
  const queryClient = createAppQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useUsageDashboardData", () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("polls dashboard core every 30 seconds", async () => {
    vi.useFakeTimers();
    const requestUsageDashboard = vi.fn(async () => createResponse());
    renderHook(
      () =>
        useUsageDashboardData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          requestUsageDashboard,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => Promise.resolve());
    expect(requestUsageDashboard).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(requestUsageDashboard).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requestUsageDashboard).toHaveBeenCalledTimes(2);
  });

  it("does not start a manual request when auth is unavailable", async () => {
    const requestUsageDashboard = vi.fn(async () => createResponse());
    const { result } = renderHook(
      () =>
        useUsageDashboardData({
          canRequest: false,
          queryScope: createUsageDashboardQueryScope("/api", ""),
          requestUsageDashboard,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => result.current.loadDashboard({ forceRefresh: true }));

    expect(requestUsageDashboard).not.toHaveBeenCalled();
    expect(result.current.dashboardLoading).toBe(false);
    expect(result.current.dashboardRefreshing).toBe(false);
  });

  it("keeps API and auth scope changes cold across A to B to A", async () => {
    const requestUsageDashboard = vi.fn(async (label: string) =>
      createResponse(`2026-08-25T00:00:0${label === "A" ? "1" : "2"}.000Z`),
    );
    const { result, rerender } = renderHook(
      ({ apiBase, token, label }: { apiBase: string; token: string; label: string }) =>
        useUsageDashboardData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope(apiBase, token),
          requestUsageDashboard: () => requestUsageDashboard(label),
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      {
        initialProps: { apiBase: "/api-a", token: "token-a", label: "A" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(requestUsageDashboard).toHaveBeenCalledTimes(1));
    rerender({ apiBase: "/api-b", token: "token-b", label: "B" });
    await waitFor(() => expect(requestUsageDashboard).toHaveBeenCalledTimes(2));
    rerender({ apiBase: "/api-a", token: "token-a", label: "A" });
    await waitFor(() => expect(requestUsageDashboard).toHaveBeenCalledTimes(3));

    expect(requestUsageDashboard.mock.calls.map(([label]) => label)).toEqual(["A", "B", "A"]);
    await waitFor(() =>
      expect(result.current.dashboardCore?.fetchedAt).toBe("2026-08-25T00:00:01.000Z"),
    );
  });

  it("starts an offline manual refresh with its invocation scope snapshot", async () => {
    onlineManager.setOnline(false);
    let resolveA: ((value: UsageDashboardResponse) => void) | undefined;
    const requestA = vi.fn(
      () =>
        new Promise<UsageDashboardResponse>((resolve) => {
          resolveA = resolve;
        }),
    );
    const requestB = vi.fn(async () => createResponse("2026-08-25T00:00:02.000Z"));
    const props = {
      queryScope: createUsageDashboardQueryScope("/api-a", "token-a"),
      requestUsageDashboard: requestA,
    };
    const { result, rerender } = renderHook(
      () =>
        useUsageDashboardData({
          canRequest: true,
          queryScope: props.queryScope,
          requestUsageDashboard: props.requestUsageDashboard,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    let refreshPromise: Promise<UsageDashboardResponse | undefined> | undefined;
    act(() => {
      refreshPromise = result.current.loadDashboard({ forceRefresh: true });
    });
    await waitFor(() => expect(requestA).toHaveBeenCalledTimes(1));
    expect(requestA).toHaveBeenCalledWith({ refresh: true }, expect.any(AbortSignal));

    props.queryScope = createUsageDashboardQueryScope("/api-b", "token-b");
    props.requestUsageDashboard = requestB;
    rerender();
    expect(result.current.dashboardRefreshing).toBe(false);
    expect(requestB).not.toHaveBeenCalled();

    act(() => resolveA?.(createResponse("2026-08-25T00:00:01.000Z")));
    await act(async () => refreshPromise);
    expect(requestB).not.toHaveBeenCalled();
  });
});
