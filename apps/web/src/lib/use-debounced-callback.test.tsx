import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedCallback } from "./use-debounced-callback";

describe("useDebouncedCallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the callback once after delayMs of inactivity", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 500));

    act(() => {
      result.current.run();
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not fire before delayMs elapses, then fires exactly at the boundary", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 500));

    act(() => {
      result.current.run();
    });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("collapses rapid successive calls and uses the latest arguments", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 500));

    act(() => {
      result.current.run("first");
      vi.advanceTimersByTime(300);
      result.current.run("second");
      vi.advanceTimersByTime(300);
      result.current.run("third");
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("third");
  });

  it("uses the delayMs from the latest render", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result, rerender } = renderHook(
      ({ delayMs }: { delayMs: number }) => useDebouncedCallback(callback, delayMs),
      { initialProps: { delayMs: 1000 } },
    );

    rerender({ delayMs: 100 });

    act(() => {
      result.current.run();
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cancel discards a pending call", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 500));

    act(() => {
      result.current.run();
      result.current.cancel();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("clears a pending call on unmount", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 500));

    act(() => {
      result.current.run();
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).not.toHaveBeenCalled();
  });
});
