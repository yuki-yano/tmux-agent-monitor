import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNotesPolling } from "./useNotesPolling";

describe("useNotesPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("refreshes silently on mount and every 10 seconds while a repo root is set", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    renderHook(() => useNotesPolling({ repoRoot: "/repo", onRefresh }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith({ silent: true });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("does not poll when there is no repo root", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    renderHook(() => useNotesPolling({ repoRoot: null, onRefresh }));

    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stops polling once the repo root is cleared", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const { rerender } = renderHook(
      ({ repoRoot }: { repoRoot: string | null }) => useNotesPolling({ repoRoot, onRefresh }),
      { initialProps: { repoRoot: "/repo" as string | null } },
    );

    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender({ repoRoot: null });
    onRefresh.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stops polling on unmount", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => useNotesPolling({ repoRoot: "/repo", onRefresh }));
    onRefresh.mockClear();

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("uses a custom interval when provided", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    renderHook(() => useNotesPolling({ repoRoot: "/repo", onRefresh, intervalMs: 5_000 }));
    onRefresh.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("stops while hidden and waits for the next tick after visibility resumes", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const onRefresh = vi.fn();

    renderHook(() => useNotesPolling({ repoRoot: "/repo", onRefresh }));

    expect(onRefresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    void act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledWith({ silent: true });
  });

  it("stops while offline and waits for the next tick after online resumes", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const onRefresh = vi.fn();

    renderHook(() => useNotesPolling({ repoRoot: "/repo", onRefresh }));

    expect(onRefresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    void act(() => window.dispatchEvent(new Event("online")));
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
