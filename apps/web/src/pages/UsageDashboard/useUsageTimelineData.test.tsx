import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { SessionStateTimelineRange, UsageGlobalTimelineResponse } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { createUsageDashboardQueryScope } from "./usage-dashboard-query-keys";
import { useUsageTimelineData } from "./useUsageTimelineData";

const createResponse = (range: SessionStateTimelineRange): UsageGlobalTimelineResponse => ({
  timeline: {
    paneId: "global",
    now: "2026-08-25T00:00:00.000Z",
    range,
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
  fetchedAt: "2026-08-25T00:00:00.000Z",
});

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
};

const createWrapper = () => {
  const queryClient = createAppQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useUsageTimelineData", () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("keeps range changes cold and ignores late A to B to A responses", async () => {
    const requests: Array<{
      range: SessionStateTimelineRange;
      deferred: ReturnType<typeof createDeferred<UsageGlobalTimelineResponse>>;
    }> = [];
    const requestUsageGlobalTimeline = vi.fn(
      ({ range = "1h" }: { range?: SessionStateTimelineRange }) => {
        const deferred = createDeferred<UsageGlobalTimelineResponse>();
        requests.push({ range, deferred });
        return deferred.promise;
      },
    );
    const { result } = renderHook(
      () =>
        useUsageTimelineData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          requestUsageGlobalTimeline,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => result.current.setTimelineRange("7d"));
    await waitFor(() => expect(requests).toHaveLength(2));
    act(() => result.current.setTimelineRange("24h"));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(result.current.timeline).toBeNull();

    act(() => requests[0]!.deferred.resolve(createResponse("24h")));
    await act(async () => Promise.resolve());
    expect(result.current.timeline).toBeNull();

    act(() => requests[2]!.deferred.resolve(createResponse("24h")));
    await waitFor(() => expect(result.current.timeline?.timeline.range).toBe("24h"));
  });

  it("does not cache a response whose range does not match its query key", async () => {
    const { result } = renderHook(
      () =>
        useUsageTimelineData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          requestUsageGlobalTimeline: vi.fn(async () => createResponse("7d")),
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.timelineLoading).toBe(false));
    expect(result.current.timeline).toBeNull();
    expect(result.current.timelineError).toBe("Failed to load global usage timeline");
  });

  it("polls every 15 seconds while online", async () => {
    vi.useFakeTimers();
    const requestUsageGlobalTimeline = vi.fn(async () => createResponse("24h"));
    renderHook(
      () =>
        useUsageTimelineData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          requestUsageGlobalTimeline,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => Promise.resolve());
    expect(requestUsageGlobalTimeline).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(requestUsageGlobalTimeline).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requestUsageGlobalTimeline).toHaveBeenCalledTimes(2);
  });

  it("pauses a cold offline request and refetches once on reconnect", async () => {
    onlineManager.setOnline(false);
    const requestUsageGlobalTimeline = vi.fn(async () => createResponse("24h"));
    renderHook(
      () =>
        useUsageTimelineData({
          canRequest: true,
          queryScope: createUsageDashboardQueryScope("/api", "token"),
          requestUsageGlobalTimeline,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => Promise.resolve());
    expect(requestUsageGlobalTimeline).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(requestUsageGlobalTimeline).toHaveBeenCalledTimes(1));
  });

  it("does not start a manual request when auth is unavailable", async () => {
    const requestUsageGlobalTimeline = vi.fn(async () => createResponse("24h"));
    const { result } = renderHook(
      () =>
        useUsageTimelineData({
          canRequest: false,
          queryScope: createUsageDashboardQueryScope("/api", ""),
          requestUsageGlobalTimeline,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => result.current.loadTimeline());

    expect(requestUsageGlobalTimeline).not.toHaveBeenCalled();
    expect(result.current.timelineLoading).toBe(false);
    expect(result.current.timelineRefreshing).toBe(false);
  });

  it("starts an offline manual refresh with its invocation scope snapshot", async () => {
    onlineManager.setOnline(false);
    const deferred = createDeferred<UsageGlobalTimelineResponse>();
    const requestA = vi.fn(() => deferred.promise);
    const requestB = vi.fn(async () => createResponse("24h"));
    const props = {
      queryScope: createUsageDashboardQueryScope("/api-a", "token-a"),
      requestUsageGlobalTimeline: requestA,
    };
    const { result, rerender } = renderHook(
      () =>
        useUsageTimelineData({
          canRequest: true,
          queryScope: props.queryScope,
          requestUsageGlobalTimeline: props.requestUsageGlobalTimeline,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.loadTimeline();
    });
    await waitFor(() => expect(requestA).toHaveBeenCalledTimes(1));
    expect(requestA).toHaveBeenCalledWith({ range: "24h" }, expect.any(AbortSignal));

    props.queryScope = createUsageDashboardQueryScope("/api-b", "token-b");
    props.requestUsageGlobalTimeline = requestB;
    rerender();
    expect(result.current.timelineRefreshing).toBe(false);
    expect(requestB).not.toHaveBeenCalled();

    act(() => deferred.resolve(createResponse("24h")));
    await act(async () => refreshPromise);
    expect(requestB).not.toHaveBeenCalled();
  });
});
