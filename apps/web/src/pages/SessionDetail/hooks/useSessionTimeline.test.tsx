import {
  type QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "@vde-monitor/shared";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { createDeferred } from "../test-helpers";
import { useSessionTimeline } from "./useSessionTimeline";

const buildTimeline = (
  paneId: string,
  range: SessionStateTimelineRange = "1h",
  scope: SessionStateTimelineScope = "pane",
): SessionStateTimeline => ({
  paneId: scope === "repo" ? `repo:${paneId}` : paneId,
  now: new Date(0).toISOString(),
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
});

const createQueryWrapper = (queryClient = createAppQueryClient()) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

type TimelineRequest = (
  paneId: string,
  options?: {
    scope?: SessionStateTimelineScope;
    range?: SessionStateTimelineRange;
    limit?: number;
  },
  signal?: AbortSignal,
) => Promise<SessionStateTimeline>;

const renderTimeline = ({
  paneId = "pane-1",
  repoRoot = "/repo/a",
  connected = true,
  hasRepoTimeline = true,
  mobileDefaultCollapsed = false,
  limit,
  requestStateTimeline,
  queryClient,
}: {
  paneId?: string;
  repoRoot?: string | null;
  connected?: boolean;
  hasRepoTimeline?: boolean;
  mobileDefaultCollapsed?: boolean;
  limit?: number;
  requestStateTimeline: TimelineRequest;
  queryClient?: QueryClient;
}) =>
  renderHook(
    () =>
      useSessionTimeline({
        paneId,
        repoRoot,
        connected,
        requestStateTimeline,
        hasRepoTimeline,
        mobileDefaultCollapsed,
        limit,
      }),
    { wrapper: createQueryWrapper(queryClient) },
  );

describe("useSessionTimeline", () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    focusManager.setFocused(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it("loads timeline through its scoped query key and forwards the abort signal", async () => {
    const queryClient = createAppQueryClient();
    const requestStateTimeline = vi.fn<TimelineRequest>(async (paneId) => buildTimeline(paneId));
    const { result } = renderTimeline({
      requestStateTimeline,
      queryClient,
      limit: 75,
    });

    expect(result.current.timelineLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
      expect(result.current.timelineLoading).toBe(false);
    });
    expect(requestStateTimeline).toHaveBeenCalledWith(
      "pane-1",
      { range: "1h", limit: 75 },
      expect.any(AbortSignal),
    );
    expect(
      queryClient.getQueryData(
        sessionDetailQueryKeys.timeline("pane-1", {
          repoRoot: "/repo/a",
          scope: "pane",
          range: "1h",
          limit: 75,
        }),
      ),
    ).toEqual(buildTimeline("pane-1"));
  });

  it("uses separate queries when range and scope change", async () => {
    const requestStateTimeline = vi.fn<TimelineRequest>(async (paneId, options) =>
      buildTimeline(paneId, options?.range, options?.scope),
    );
    const { result } = renderTimeline({ requestStateTimeline });

    await waitFor(() => {
      expect(result.current.timeline?.range).toBe("1h");
    });
    act(() => {
      result.current.setTimelineRange("15m");
    });
    await waitFor(() => {
      expect(result.current.timeline?.range).toBe("15m");
    });
    act(() => {
      result.current.setTimelineScope("repo");
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("repo:pane-1");
    });
    expect(requestStateTimeline).toHaveBeenLastCalledWith(
      "pane-1",
      { scope: "repo", range: "15m" },
      expect.any(AbortSignal),
    );
  });

  it("permanently downgrades repo scope when the repository disappears", async () => {
    const requestStateTimeline = vi.fn<TimelineRequest>(async (paneId, options) =>
      buildTimeline(paneId, options?.range, options?.scope),
    );
    const queryClient = createAppQueryClient();
    const { result, rerender } = renderHook(
      ({ repoRoot, hasRepoTimeline }: { repoRoot: string | null; hasRepoTimeline: boolean }) =>
        useSessionTimeline({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestStateTimeline,
          hasRepoTimeline,
          mobileDefaultCollapsed: false,
        }),
      {
        initialProps: {
          repoRoot: "/repo/a",
          hasRepoTimeline: true,
        } as { repoRoot: string | null; hasRepoTimeline: boolean },
        wrapper: createQueryWrapper(queryClient),
      },
    );

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });
    act(() => {
      result.current.setTimelineScope("repo");
    });
    await waitFor(() => {
      expect(result.current.timelineScope).toBe("repo");
    });

    rerender({ repoRoot: null, hasRepoTimeline: false });
    expect(result.current.timelineScope).toBe("pane");
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenLastCalledWith(
        "pane-1",
        { range: "1h" },
        expect.any(AbortSignal),
      );
    });

    rerender({ repoRoot: "/repo/a", hasRepoTimeline: true });
    expect(result.current.timelineScope).toBe("pane");
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenLastCalledWith(
        "pane-1",
        { range: "1h" },
        expect.any(AbortSignal),
      );
    });
  });

  it("does not show previous repository data while a connected repo key loads", async () => {
    const repoB = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn<TimelineRequest>()
      .mockResolvedValueOnce(buildTimeline("pane-1"))
      .mockImplementationOnce(() => repoB.promise);
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionTimeline({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      {
        initialProps: { repoRoot: "/repo/a" },
        wrapper: createQueryWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });
    rerender({ repoRoot: "/repo/b" });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
    });
    expect(result.current.timeline).toBeNull();
    expect(result.current.timelineLoading).toBe(true);

    act(() => {
      repoB.resolve(buildTimeline("pane-1", "15m"));
    });
    await waitFor(() => {
      expect(result.current.timeline?.range).toBe("15m");
    });
  });

  it("keeps expanded state local and resets it with direct pane identity changes", async () => {
    const requestStateTimeline = vi.fn<TimelineRequest>(async (paneId) => buildTimeline(paneId));
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionTimeline({
          paneId,
          repoRoot: "/repo/a",
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: true,
        }),
      {
        initialProps: { paneId: "pane-a" },
        wrapper: createQueryWrapper(),
      },
    );

    expect(result.current.timelineExpanded).toBe(false);
    act(() => {
      result.current.toggleTimelineExpanded();
      result.current.setTimelineRange("15m");
    });
    expect(result.current.timelineExpanded).toBe(true);
    expect(result.current.timelineRange).toBe("15m");

    rerender({ paneId: "pane-b" });
    expect(result.current.timelineExpanded).toBe(false);
    expect(result.current.timelineRange).toBe("1h");
  });

  it("pauses an offline cold load and resumes when the browser reconnects", async () => {
    onlineManager.setOnline(false);
    const reconnect = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi.fn<TimelineRequest>(() => reconnect.promise);
    const { result } = renderTimeline({ requestStateTimeline });

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(false);
      expect(result.current.timelineError).toBe("Offline: waiting to load timeline");
    });
    expect(requestStateTimeline).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refreshTimeline();
    });
    expect(result.current.timelineLoading).toBe(false);
    expect(result.current.timelineError).toBe("Offline: waiting to load timeline");
    expect(requestStateTimeline).not.toHaveBeenCalled();

    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.timelineError).toBeNull();
      expect(requestStateTimeline).toHaveBeenCalledTimes(1);
    });
    expect(result.current.timelineLoading).toBe(false);

    act(() => {
      reconnect.resolve(buildTimeline("pane-1"));
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });
  });

  it("treats an app reconnect as an immediate silent cold fetch", async () => {
    const reconnect = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi.fn<TimelineRequest>(() => reconnect.promise);
    const queryClient = createAppQueryClient();
    const { result, rerender } = renderHook(
      ({ connected, repoRoot }) =>
        useSessionTimeline({
          paneId: "pane-1",
          repoRoot,
          connected,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      {
        initialProps: { connected: false, repoRoot: "/repo/a" },
        wrapper: createQueryWrapper(queryClient),
      },
    );

    expect(requestStateTimeline).not.toHaveBeenCalled();
    expect(result.current.timelineLoading).toBe(false);
    rerender({ connected: false, repoRoot: "/repo/b" });
    act(() => {
      result.current.setTimelineRange("15m");
    });
    expect(result.current.timelineLoading).toBe(false);
    rerender({ connected: true, repoRoot: "/repo/b" });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(1);
    });
    expect(result.current.timelineLoading).toBe(false);

    act(() => {
      reconnect.resolve(buildTimeline("pane-1"));
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });
  });

  it("silently refreshes warm data on browser reconnect", async () => {
    const reconnect = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn<TimelineRequest>()
      .mockResolvedValueOnce(buildTimeline("pane-1"))
      .mockImplementationOnce(() => reconnect.promise);
    const { result } = renderTimeline({ requestStateTimeline });

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });
    act(() => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
    });
    expect(result.current.timeline).toEqual(buildTimeline("pane-1"));
    expect(result.current.timelineLoading).toBe(false);

    act(() => {
      reconnect.resolve(buildTimeline("pane-1", "15m"));
    });
    await waitFor(() => {
      expect(result.current.timeline?.range).toBe("15m");
    });
  });

  it("stops interval polling while hidden and immediately refreshes on focus", async () => {
    vi.useFakeTimers();
    const requestStateTimeline = vi.fn<TimelineRequest>(async (paneId) => buildTimeline(paneId));
    renderTimeline({ requestStateTimeline });

    await act(async () => undefined);
    expect(requestStateTimeline).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(requestStateTimeline).toHaveBeenCalledTimes(2);

    act(() => {
      focusManager.setFocused(false);
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(requestStateTimeline).toHaveBeenCalledTimes(2);

    act(() => {
      focusManager.setFocused(true);
    });
    await act(async () => undefined);
    expect(requestStateTimeline).toHaveBeenCalledTimes(3);
  });

  it("keeps warm data after an error and clears the error while retrying", async () => {
    const retry = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn<TimelineRequest>()
      .mockResolvedValueOnce(buildTimeline("pane-1"))
      .mockRejectedValueOnce(new Error("timeline unavailable"))
      .mockImplementationOnce(() => retry.promise);
    const { result } = renderTimeline({ requestStateTimeline });

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });
    await act(async () => {
      await result.current.refreshTimeline();
    });
    await waitFor(() => {
      expect(result.current.timelineError).toBe("timeline unavailable");
    });
    expect(result.current.timeline).toEqual(buildTimeline("pane-1"));

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshTimeline();
    });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(3);
      expect(result.current.timelineError).toBeNull();
      expect(result.current.timelineLoading).toBe(true);
    });
    expect(result.current.timeline).toEqual(buildTimeline("pane-1"));

    await act(async () => {
      retry.resolve(buildTimeline("pane-1", "15m"));
      await refreshPromise;
    });
    expect(result.current.timelineLoading).toBe(false);
  });

  it("keeps a cold error visible while an automatic retry stays silent", async () => {
    const retry = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn<TimelineRequest>()
      .mockRejectedValueOnce(new Error("timeline unavailable"))
      .mockImplementationOnce(() => retry.promise);
    const { result } = renderTimeline({ requestStateTimeline });

    await waitFor(() => {
      expect(result.current.timelineError).toBe("timeline unavailable");
      expect(result.current.timelineLoading).toBe(false);
    });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
    });
    expect(result.current.timelineError).toBe("timeline unavailable");
    expect(result.current.timelineLoading).toBe(false);

    act(() => {
      retry.resolve(buildTimeline("pane-1"));
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
      expect(result.current.timelineError).toBeNull();
    });
  });

  it("cancels a cold request before starting a manual refresh", async () => {
    const refreshed = createDeferred<SessionStateTimeline>();
    let initialSignal: AbortSignal | undefined;
    const requestStateTimeline = vi.fn<TimelineRequest>((paneId, _options, signal) => {
      if (requestStateTimeline.mock.calls.length === 1) {
        initialSignal = signal;
        return new Promise((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return refreshed.promise.then(() => buildTimeline(paneId));
    });
    const { result } = renderTimeline({ requestStateTimeline });

    await waitFor(() => {
      expect(initialSignal).toBeDefined();
    });
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshTimeline();
    });
    await waitFor(() => {
      expect(initialSignal?.aborted).toBe(true);
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
      expect(result.current.timelineLoading).toBe(true);
    });

    await act(async () => {
      refreshed.resolve(buildTimeline("pane-1"));
      await refreshPromise;
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
      expect(result.current.timelineLoading).toBe(false);
    });
  });

  it("coalesces the StrictMode replay into one active request", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let abortedRequests = 0;
    let appliedSuccesses = 0;
    const requestStateTimeline = vi.fn<TimelineRequest>(
      (paneId, _options, signal) =>
        new Promise((resolve, reject) => {
          activeRequests += 1;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          const timer = window.setTimeout(() => {
            activeRequests -= 1;
            appliedSuccesses += 1;
            resolve(buildTimeline(paneId));
          }, 10);
          signal?.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              activeRequests -= 1;
              abortedRequests += 1;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const queryClient = createAppQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </StrictMode>
    );
    const { result } = renderHook(
      () =>
        useSessionTimeline({
          paneId: "pane-strict",
          repoRoot: "/repo/strict",
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-strict");
    });
    expect(requestStateTimeline).toHaveBeenCalledTimes(1);
    expect(maxActiveRequests).toBe(1);
    expect(abortedRequests).toBe(0);
    expect(appliedSuccesses).toBe(1);
  });

  it("drops pane query data at gcTime zero across an A to B to A lifetime", async () => {
    const queryClient = createAppQueryClient();
    const wrapper = createQueryWrapper(queryClient);
    const revisitA = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi.fn<TimelineRequest>((paneId) => {
      if (paneId === "pane-a" && requestStateTimeline.mock.calls.length === 3) {
        return revisitA.promise;
      }
      return Promise.resolve(buildTimeline(paneId));
    });
    const firstA = renderHook(
      () =>
        useSessionTimeline({
          paneId: "pane-a",
          repoRoot: "/repo/a",
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(firstA.result.current.timeline?.paneId).toBe("pane-a");
    });
    firstA.unmount();

    const paneB = renderHook(
      () =>
        useSessionTimeline({
          paneId: "pane-b",
          repoRoot: "/repo/b",
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      { wrapper },
    );
    await waitFor(() => {
      expect(paneB.result.current.timeline?.paneId).toBe("pane-b");
    });
    paneB.unmount();

    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          sessionDetailQueryKeys.timeline("pane-a", {
            repoRoot: "/repo/a",
            scope: "pane",
            range: "1h",
            limit: undefined,
          }),
        ),
      ).toBeUndefined();
    });
    const secondA = renderHook(
      () =>
        useSessionTimeline({
          paneId: "pane-a",
          repoRoot: "/repo/a",
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      { wrapper },
    );

    expect(secondA.result.current.timeline).toBeNull();
    expect(secondA.result.current.timelineLoading).toBe(true);
    act(() => {
      revisitA.resolve(buildTimeline("pane-a"));
    });
    await waitFor(() => {
      expect(secondA.result.current.timeline?.paneId).toBe("pane-a");
    });
  });
});
