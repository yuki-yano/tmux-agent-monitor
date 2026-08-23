import { act, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
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
        paneId: "pane-1",
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
    expect(result.current.isAtBottom).toBe(true);
    expect(result.current.shouldFollowOutput).toBe(false);

    act(() => {
      result.current.handleUserScrollStateChange(false);
    });

    expect(onFlushPending).toHaveBeenCalledTimes(1);
  });

  it("does not flush pending output from a bottom measurement during user scrolling", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();
    const { result } = renderHook(() =>
      useScreenScroll({
        paneId: "pane-1",
        mode: "text",
        screenLinesLength: 1,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      }),
    );

    act(() => {
      result.current.handleUserScrollStateChange(true);
      result.current.handleAtBottomChange(true);
    });
    expect(onFlushPending).not.toHaveBeenCalled();

    act(() => {
      result.current.handleUserScrollStateChange(false);
    });
    expect(onFlushPending).toHaveBeenCalledTimes(1);
  });

  it("keeps force follow after reaching the current bottom until user input", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result } = renderHook(() =>
      useScreenScroll({
        paneId: "pane-1",
        mode: "text",
        screenLinesLength: 2,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      }),
    );

    act(() => {
      result.current.viewportRef.current = {
        scrollToEnd: vi.fn(),
      } as unknown as typeof result.current.viewportRef.current;
      result.current.scrollerRef.current = {
        scrollTo: vi.fn(),
        scrollHeight: 200,
      } as unknown as HTMLDivElement;
    });

    act(() => {
      result.current.scrollToBottom("auto");
    });

    expect(result.current.shouldFollowOutput).toBe(true);

    act(() => {
      result.current.handleAtBottomChange(true);
    });

    expect(result.current.shouldFollowOutput).toBe(true);
    expect(onFlushPending).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleUserScrollStateChange(true);
    });

    expect(result.current.shouldFollowOutput).toBe(false);
  });

  it("enables force follow at the current bottom for subsequent output", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result } = renderHook(() =>
      useScreenScroll({
        paneId: "pane-1",
        mode: "text",
        screenLinesLength: 2,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      }),
    );

    act(() => {
      result.current.viewportRef.current = {
        scrollToEnd: vi.fn(),
      } as unknown as typeof result.current.viewportRef.current;
      result.current.scrollerRef.current = {
        scrollTo: vi.fn(),
        scrollHeight: 200,
      } as unknown as HTMLDivElement;
      result.current.scrollToBottom("auto");
    });

    expect(result.current.shouldFollowOutput).toBe(true);
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
    const scrollToEnd = vi.fn();
    const scrollTo = vi.fn();

    const { result, rerender } = renderHook(
      ({ mode, screenLinesLength }: { mode: ScreenMode; screenLinesLength: number }) =>
        useScreenScroll({
          paneId: "pane-1",
          mode,
          screenLinesLength,
          isUserScrollingRef,
          onFlushPending,
          onClearPending,
        }),
      { initialProps: { mode: "image" as ScreenMode, screenLinesLength: 2 } },
    );

    act(() => {
      result.current.viewportRef.current = {
        scrollToEnd,
      } as unknown as typeof result.current.viewportRef.current;
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

    expect(scrollToEnd).toHaveBeenCalled();
  });

  it("snaps to bottom after pane change when text lines arrive", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();
    const scrollToEnd = vi.fn();
    const scrollTo = vi.fn();

    const { result, rerender } = renderHook(
      ({ paneId, screenLinesLength }: { paneId: string; screenLinesLength: number }) =>
        useScreenScroll({
          paneId,
          mode: "text",
          screenLinesLength,
          isUserScrollingRef,
          onFlushPending,
          onClearPending,
        }),
      { initialProps: { paneId: "pane-1", screenLinesLength: 0 } },
    );

    act(() => {
      result.current.viewportRef.current = {
        scrollToEnd,
      } as unknown as typeof result.current.viewportRef.current;
      result.current.scrollerRef.current = {
        scrollTo,
        scrollHeight: 120,
      } as unknown as HTMLDivElement;
    });

    rerender({ paneId: "pane-2", screenLinesLength: 0 });
    expect(scrollToEnd).not.toHaveBeenCalled();

    rerender({ paneId: "pane-2", screenLinesLength: 3 });
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: "auto" });
  });

  it("snaps to bottom on each initial text mount", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const scrollTo = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const Harness = () => {
      const { scrollerRef } = useScreenScroll({
        paneId: "pane-1",
        mode: "text",
        screenLinesLength: 3,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      });
      return <div ref={scrollerRef} />;
    };
    const firstView = render(<Harness />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    firstView.unmount();

    render(<Harness />);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("resets at-bottom state when pane changes", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result, rerender } = renderHook(
      ({ paneId }: { paneId: string }) =>
        useScreenScroll({
          paneId,
          mode: "text",
          screenLinesLength: 0,
          isUserScrollingRef,
          onFlushPending,
          onClearPending,
        }),
      { initialProps: { paneId: "pane-1" } },
    );

    expect(result.current.isAtBottom).toBe(true);

    act(() => {
      result.current.handleAtBottomChange(false);
    });

    expect(result.current.isAtBottom).toBe(false);

    rerender({ paneId: "pane-2" });

    expect(result.current.isAtBottom).toBe(true);
  });

  it("clears transient scrolling state and pending output on pane change", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result, rerender } = renderHook(
      ({ paneId }: { paneId: string }) =>
        useScreenScroll({
          paneId,
          mode: "text",
          screenLinesLength: 2,
          isUserScrollingRef,
          onFlushPending,
          onClearPending,
        }),
      { initialProps: { paneId: "pane-1" } },
    );

    act(() => {
      result.current.scrollerRef.current = {
        scrollTo: vi.fn(),
        scrollHeight: 200,
      } as unknown as HTMLDivElement;
      result.current.scrollToBottom("auto");
      isUserScrollingRef.current = true;
    });
    expect(result.current.shouldFollowOutput).toBe(true);

    rerender({ paneId: "pane-2" });

    expect(isUserScrollingRef.current).toBe(false);
    expect(result.current.shouldFollowOutput).toBe(false);
    expect(onClearPending).toHaveBeenCalledTimes(2);
  });

  it("clears transient scrolling state and follow intent on mode change", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result, rerender } = renderHook(
      ({ mode }: { mode: ScreenMode }) =>
        useScreenScroll({
          paneId: "pane-1",
          mode,
          screenLinesLength: 2,
          isUserScrollingRef,
          onFlushPending,
          onClearPending,
        }),
      { initialProps: { mode: "text" as ScreenMode } },
    );

    act(() => {
      result.current.viewportRef.current = {
        scrollToEnd: vi.fn(),
      } as unknown as typeof result.current.viewportRef.current;
      result.current.scrollToBottom("auto");
      isUserScrollingRef.current = true;
    });
    expect(result.current.shouldFollowOutput).toBe(true);

    rerender({ mode: "image" as ScreenMode });

    expect(isUserScrollingRef.current).toBe(false);
    expect(result.current.shouldFollowOutput).toBe(false);
    expect(onClearPending).toHaveBeenCalledTimes(2);
  });

  it("clears transient state on unmount", () => {
    const isUserScrollingRef = { current: false };
    const onFlushPending = vi.fn();
    const onClearPending = vi.fn();

    const { result, unmount } = renderHook(() =>
      useScreenScroll({
        paneId: "pane-1",
        mode: "text",
        screenLinesLength: 2,
        isUserScrollingRef,
        onFlushPending,
        onClearPending,
      }),
    );

    act(() => {
      result.current.scrollerRef.current = {
        scrollTo: vi.fn(),
        scrollHeight: 200,
      } as unknown as HTMLDivElement;
      result.current.scrollToBottom("auto");
      isUserScrollingRef.current = true;
    });

    unmount();

    expect(isUserScrollingRef.current).toBe(false);
    expect(onClearPending).toHaveBeenCalledTimes(2);
  });

  it("uses the latest clear callback on unmount without resetting the same context", () => {
    const isUserScrollingRef = { current: false };
    const firstOnClearPending = vi.fn();
    const latestOnClearPending = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ onClearPending }: { onClearPending: () => void }) =>
        useScreenScroll({
          paneId: "pane-1",
          mode: "text",
          screenLinesLength: 0,
          isUserScrollingRef,
          onFlushPending: vi.fn(),
          onClearPending,
        }),
      { initialProps: { onClearPending: firstOnClearPending } },
    );

    expect(firstOnClearPending).toHaveBeenCalledTimes(1);
    rerender({ onClearPending: latestOnClearPending });
    expect(firstOnClearPending).toHaveBeenCalledTimes(1);
    expect(latestOnClearPending).not.toHaveBeenCalled();

    unmount();

    expect(firstOnClearPending).toHaveBeenCalledTimes(1);
    expect(latestOnClearPending).toHaveBeenCalledTimes(1);
  });

  it("runs each transient cleanup once during StrictMode replay and final unmount", () => {
    const isUserScrollingRef = { current: false };
    const onClearPending = vi.fn();

    const { unmount } = renderHook(
      () =>
        useScreenScroll({
          paneId: "pane-1",
          mode: "text",
          screenLinesLength: 0,
          isUserScrollingRef,
          onFlushPending: vi.fn(),
          onClearPending,
        }),
      { wrapper: StrictMode },
    );

    expect(onClearPending).toHaveBeenCalledTimes(2);
    isUserScrollingRef.current = true;

    unmount();

    expect(isUserScrollingRef.current).toBe(false);
    expect(onClearPending).toHaveBeenCalledTimes(3);
  });
});
