import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UsageRepositoryActivityResponse } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import type { RepositoryActivityRange } from "./repository-activity-types";
import { createUsageDashboardQueryScope } from "./usage-dashboard-query-keys";
import { useRepositoryActivityData } from "./useRepositoryActivityData";

const queryScope = createUsageDashboardQueryScope("/api", "token-a");
const createWrapper = () => {
  const queryClient = createAppQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const createResponse = (range: RepositoryActivityRange): UsageRepositoryActivityResponse => ({
  range,
  rangeStart: "2026-07-10T00:00:00.000Z",
  rangeEnd: "2026-07-11T00:00:00.000Z",
  coverage: {
    status: "complete",
    trackingStartedAt: "2026-06-01T00:00:00.000Z",
    gapDurationMs: 0,
    unattributedRunningMs: 0,
    unattributedCompletedRunCount: 0,
    unverifiedCompletedRunCount: 0,
  },
  items: [],
  fetchedAt: "2026-07-11T00:00:00.000Z",
});

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
};

describe("useRepositoryActivityData", () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("does not expose previous data or a late response after a range change", async () => {
    const responses = new Map<
      RepositoryActivityRange,
      ReturnType<typeof createDeferred<UsageRepositoryActivityResponse>>
    >([
      ["24h", createDeferred<UsageRepositoryActivityResponse>()],
      ["7d", createDeferred<UsageRepositoryActivityResponse>()],
    ]);
    const requestRepositoryActivity = vi.fn(
      ({ range }: { range: RepositoryActivityRange }) => responses.get(range)!.promise,
    );
    const { result } = renderHook(
      () =>
        useRepositoryActivityData({
          canRequest: true,
          queryScope,
          requestRepositoryActivity,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(requestRepositoryActivity).toHaveBeenCalledTimes(1));
    expect(requestRepositoryActivity.mock.calls[0]?.[0]).toEqual({ range: "24h" });
    act(() => result.current.setRange("7d"));
    expect(result.current.activity).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(requestRepositoryActivity).toHaveBeenCalledTimes(2));

    act(() => responses.get("24h")!.resolve(createResponse("24h")));
    await act(async () => Promise.resolve());
    expect(result.current.activity).toBeNull();

    act(() => responses.get("7d")!.resolve(createResponse("7d")));
    await waitFor(() => expect(result.current.activity?.range).toBe("7d"));
  });

  it("treats A to B to A as a cold request", async () => {
    const requests: Array<ReturnType<typeof createDeferred<UsageRepositoryActivityResponse>>> = [];
    const requestRepositoryActivity = vi.fn(() => {
      const request = createDeferred<UsageRepositoryActivityResponse>();
      requests.push(request);
      return request.promise;
    });
    const { result } = renderHook(
      () =>
        useRepositoryActivityData({
          canRequest: true,
          queryScope,
          requestRepositoryActivity,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => result.current.setRange("7d"));
    await waitFor(() => expect(requests).toHaveLength(2));
    act(() => result.current.setRange("24h"));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(result.current.activity).toBeNull();

    act(() => requests[0]!.resolve(createResponse("24h")));
    await act(async () => Promise.resolve());
    expect(result.current.activity).toBeNull();

    act(() => requests[2]!.resolve(createResponse("24h")));
    await waitFor(() => expect(result.current.activity?.range).toBe("24h"));
  });

  it("rejects a response for a different range", async () => {
    const { result } = renderHook(
      () =>
        useRepositoryActivityData({
          canRequest: true,
          queryScope,
          requestRepositoryActivity: vi.fn(async () => createResponse("7d")),
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activity).toBeNull();
    expect(result.current.error).toBe("Failed to load repository activity");
  });

  it("polls every 15 seconds", async () => {
    vi.useFakeTimers();
    const requestRepositoryActivity = vi.fn(async () => createResponse("24h"));
    renderHook(
      () =>
        useRepositoryActivityData({
          canRequest: true,
          queryScope,
          requestRepositoryActivity,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => Promise.resolve());
    expect(requestRepositoryActivity).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(requestRepositoryActivity).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requestRepositoryActivity).toHaveBeenCalledTimes(2);
  });

  it("does not start a manual request when auth is unavailable", async () => {
    const requestRepositoryActivity = vi.fn(async () => createResponse("24h"));
    const { result } = renderHook(
      () =>
        useRepositoryActivityData({
          canRequest: false,
          queryScope,
          requestRepositoryActivity,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => result.current.load());

    expect(requestRepositoryActivity).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
  });

  it("starts an offline manual refresh with its invocation scope snapshot", async () => {
    onlineManager.setOnline(false);
    const deferred = createDeferred<UsageRepositoryActivityResponse>();
    const requestA = vi.fn(() => deferred.promise);
    const requestB = vi.fn(async () => createResponse("24h"));
    const props = {
      queryScope: createUsageDashboardQueryScope("/api-a", "token-a"),
      requestRepositoryActivity: requestA,
    };
    const { result, rerender } = renderHook(
      () =>
        useRepositoryActivityData({
          canRequest: true,
          queryScope: props.queryScope,
          requestRepositoryActivity: props.requestRepositoryActivity,
          resolveErrorMessage: (_error, fallback) => fallback,
        }),
      { wrapper: createWrapper() },
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.load();
    });
    await waitFor(() => expect(requestA).toHaveBeenCalledTimes(1));
    expect(requestA).toHaveBeenCalledWith({ range: "24h" }, expect.any(AbortSignal));

    props.queryScope = createUsageDashboardQueryScope("/api-b", "token-b");
    props.requestRepositoryActivity = requestB;
    rerender();
    expect(result.current.refreshing).toBe(false);
    expect(requestB).not.toHaveBeenCalled();

    act(() => deferred.resolve(createResponse("24h")));
    await act(async () => refreshPromise);
    expect(requestB).not.toHaveBeenCalled();
  });
});
