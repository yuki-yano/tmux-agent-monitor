// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScreenMode } from "@/lib/screen-loading";

import { useScreenScroll } from "./useScreenScroll";

describe("useScreenScroll", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flushes pending updates when user stops scrolling", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result } = renderHook(() =>
      useScreenScroll({
        mode: "text",
        screenLinesLength: 1,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      }),
    );

    act(() => {
      result.current.handleUserScrollStateChange(true);
    });

    expect(isUserScrollingRef.current).toBe(true);

    act(() => {
      result.current.handleUserScrollStateChange(false);
    });

    expect(onFlushPending).toHaveBeenCalledTimes(1);
  });

  it("flushes when reaching bottom and clears force follow timer", () => {
    vi.useFakeTimers();
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result } = renderHook(() =>
      useScreenScroll({
        mode: "text",
        screenLinesLength: 2,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      }),
    );

    act(() => {
      result.current.virtuosoRef.current = {
        scrollToIndex: vi.fn(),
      } as unknown as typeof result.current.virtuosoRef.current;
      result.current.scrollerRef.current = {
        scrollTo: vi.fn(),
        scrollHeight: 200,
      } as unknown as HTMLDivElement;
    });

    act(() => {
      result.current.scrollToBottom("auto");
    });

    expect(result.current.forceFollow).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.forceFollow).toBe(false);

    act(() => {
      result.current.handleAtBottomChange(true);
    });

    expect(onFlushPending).toHaveBeenCalledTimes(1);
  });

  it("clears pending on image mode and snaps on image->text", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();
    const scrollToIndex = vi.fn();
    const scrollTo = vi.fn();

    const { result, rerender } = renderHook(
      ({ mode, screenLinesLength }: { mode: ScreenMode; screenLinesLength: number }) =>
        useScreenScroll({
          mode,
          screenLinesLength,
          isUserScrollingRef,
          onFlushPending,
          onClearPending,
        }),
      { initialProps: { mode: "image" as ScreenMode, screenLinesLength: 2 } },
    );

    act(() => {
      result.current.virtuosoRef.current = {
        scrollToIndex,
      } as unknown as typeof result.current.virtuosoRef.current;
      result.current.scrollerRef.current = {
        scrollTo,
        scrollHeight: 100,
      } as unknown as HTMLDivElement;
    });

    expect(onClearPending).toHaveBeenCalledTimes(1);
    expect(result.current.isAtBottom).toBe(true);

    rerender({ mode: "text" as ScreenMode, screenLinesLength: 2 });

    act(() => {
      vi.runAllTimers();
    });

    rerender({ mode: "text" as ScreenMode, screenLinesLength: 3 });

    expect(scrollToIndex).toHaveBeenCalled();
  });
});
