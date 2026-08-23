import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../test-helpers";
import { useSessionTimeline } from "./useSessionTimeline";

const buildTimeline = (range: SessionStateTimelineRange): SessionStateTimeline => ({
  paneId: "pane-1",
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

const buildTimelineRequest = (
  range: SessionStateTimelineRange,
  scope: SessionStateTimelineScope = "pane",
): SessionStateTimeline => ({
  ...buildTimeline(range),
  paneId: scope === "repo" ? "repo-pane-1" : "pane-1",
});

describe("useSessionTimeline", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("loads timeline on mount", async () => {
    const requestStateTimeline = vi.fn().mockResolvedValue(buildTimeline("1h"));

    renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledWith("pane-1", { range: "1h" });
    });
  });

  it("refetches when range changes", async () => {
    const requestStateTimeline = vi
      .fn()
      .mockResolvedValueOnce(buildTimeline("1h"))
      .mockResolvedValueOnce(buildTimeline("15m"));

    const { result } = renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledWith("pane-1", { range: "1h" });
    });

    act(() => {
      result.current.setTimelineRange("15m");
    });

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenLastCalledWith("pane-1", {
        range: "15m",
      });
    });
  });

  it("starts collapsed on mobile and toggles expanded state", async () => {
    const requestStateTimeline = vi.fn().mockResolvedValue(buildTimeline("1h"));

    const { result } = renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.timelineExpanded).toBe(false);
    });

    act(() => {
      result.current.toggleTimelineExpanded();
    });
    expect(result.current.timelineExpanded).toBe(true);
  });

  it("ignores stale timeline responses from previous pane", async () => {
    const pane1Deferred = createDeferred<SessionStateTimeline>();
    const pane2Timeline: SessionStateTimeline = {
      ...buildTimeline("1h"),
      paneId: "pane-2",
    };
    const requestStateTimeline = vi.fn((paneId: string) =>
      paneId === "pane-1" ? pane1Deferred.promise : Promise.resolve(pane2Timeline),
    );

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionTimeline({
          paneId,
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      {
        initialProps: { paneId: "pane-1" },
      },
    );

    rerender({ paneId: "pane-2" });

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-2");
    });

    pane1Deferred.resolve({
      ...buildTimeline("1h"),
      paneId: "pane-1",
    });

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-2");
    });
  });

  it("keeps the newest timeline when refresh requests resolve out of order", async () => {
    const staleDeferred = createDeferred<SessionStateTimeline>();
    const freshDeferred = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn()
      .mockImplementationOnce(() => staleDeferred.promise)
      .mockImplementationOnce(() => freshDeferred.promise);

    const { result } = renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    result.current.refreshTimeline();
    freshDeferred.resolve({
      ...buildTimeline("1h"),
      paneId: "pane-1",
    });

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-1");
    });

    staleDeferred.resolve({
      ...buildTimeline("15m"),
      paneId: "pane-1",
    });

    await waitFor(() => {
      expect(result.current.timeline?.range).toBe("1h");
    });
  });

  it("refetches when scope changes to repo", async () => {
    const requestStateTimeline = vi
      .fn()
      .mockResolvedValueOnce(buildTimelineRequest("1h", "pane"))
      .mockResolvedValueOnce(buildTimelineRequest("1h", "repo"));

    const { result } = renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledWith("pane-1", { range: "1h" });
    });

    act(() => {
      result.current.setTimelineScope("repo");
    });

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenLastCalledWith("pane-1", {
        scope: "repo",
        range: "1h",
      });
    });
  });

  it("keeps pane scope after repo timeline becomes unavailable and then recovers", async () => {
    const requestStateTimeline = vi.fn().mockResolvedValue(buildTimelineRequest("1h", "pane"));

    const { result, rerender } = renderHook(
      ({ hasRepoTimeline }: { hasRepoTimeline: boolean }) =>
        useSessionTimeline({
          paneId: "pane-1",
          connected: true,
          requestStateTimeline,
          hasRepoTimeline,
          mobileDefaultCollapsed: false,
        }),
      { initialProps: { hasRepoTimeline: true } },
    );

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledWith("pane-1", { range: "1h" });
    });

    act(() => {
      result.current.setTimelineScope("repo");
    });
    expect(result.current.timelineScope).toBe("repo");

    rerender({ hasRepoTimeline: false });
    expect(result.current.timelineScope).toBe("pane");

    rerender({ hasRepoTimeline: true });
    expect(result.current.timelineScope).toBe("pane");
  });

  it("clears loading when a non-silent request becomes stale due to reconnect silent refresh", async () => {
    const refreshRequest = createDeferred<SessionStateTimeline>();
    const reconnectRequest = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn()
      .mockResolvedValueOnce(buildTimeline("1h"))
      .mockImplementationOnce(() => refreshRequest.promise)
      .mockImplementationOnce(() => reconnectRequest.promise);

    const { result, rerender } = renderHook(
      ({ connected }) =>
        useSessionTimeline({
          paneId: "pane-1",
          connected,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      { initialProps: { connected: false } },
    );

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(1);
      expect(result.current.timelineLoading).toBe(false);
    });

    act(() => {
      result.current.refreshTimeline();
    });

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
      expect(result.current.timelineLoading).toBe(true);
    });

    rerender({ connected: true });

    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(3);
    });

    reconnectRequest.resolve(buildTimeline("1h"));
    refreshRequest.resolve(buildTimeline("1h"));

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(false);
    });
  });

  it("requests once on mount and once when visibility resumes", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const requestStateTimeline = vi.fn().mockResolvedValue(buildTimeline("1h"));

    renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    expect(requestStateTimeline).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(requestStateTimeline).toHaveBeenCalledTimes(2);
  });

  it("stops interval requests after going offline", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const requestStateTimeline = vi.fn().mockResolvedValue(buildTimeline("1h"));

    renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    expect(requestStateTimeline).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(requestStateTimeline).toHaveBeenCalledTimes(2);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(requestStateTimeline).toHaveBeenCalledTimes(2);
  });

  it("clears the previous timeline without showing loading while revisiting a pane", async () => {
    const paneBLoad = createDeferred<SessionStateTimeline>();
    const paneARevisitLoad = createDeferred<SessionStateTimeline>();
    const requestStateTimeline = vi
      .fn()
      .mockResolvedValueOnce({ ...buildTimeline("1h"), paneId: "pane-a" })
      .mockImplementationOnce(() => paneBLoad.promise)
      .mockImplementationOnce(() => paneARevisitLoad.promise);

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionTimeline({
          paneId,
          connected: true,
          requestStateTimeline,
          hasRepoTimeline: true,
          mobileDefaultCollapsed: false,
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-a");
    });

    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
    });
    act(() => {
      paneBLoad.resolve({ ...buildTimeline("1h"), paneId: "pane-b" });
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-b");
    });

    rerender({ paneId: "pane-a" });
    await waitFor(() => {
      expect(requestStateTimeline).toHaveBeenCalledTimes(3);
    });

    expect(result.current.timeline).toBeNull();
    expect(result.current.timelineLoading).toBe(false);

    act(() => {
      paneARevisitLoad.resolve({ ...buildTimeline("1h"), paneId: "pane-a" });
    });
    await waitFor(() => {
      expect(result.current.timeline?.paneId).toBe("pane-a");
    });
  });

  it("stores a load request rejection as the timeline error", async () => {
    const requestStateTimeline = vi.fn().mockRejectedValue(new Error("timeline unavailable"));

    const { result } = renderHook(() =>
      useSessionTimeline({
        paneId: "pane-1",
        connected: true,
        requestStateTimeline,
        hasRepoTimeline: true,
        mobileDefaultCollapsed: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.timelineError).toBe("timeline unavailable");
    });
    expect(result.current.timeline).toBeNull();
    expect(result.current.timelineLoading).toBe(false);
  });
});
