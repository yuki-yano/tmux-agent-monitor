import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PullToRefreshContainer } from "./PullToRefreshContainer";

type TouchLikeEventInit = {
  x: number;
  y: number;
};

const dispatchTouchEvent = (target: Element, type: string, { x, y }: TouchLikeEventInit) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }],
  });
  target.dispatchEvent(event);
  return event;
};

const renderContainer = (onRefresh: () => Promise<void>) =>
  render(
    <PullToRefreshContainer
      onRefresh={onRefresh}
      refreshingContent={<div data-testid="refreshing-overlay" />}
    >
      <button type="button">tap me</button>
    </PullToRefreshContainer>,
  );

describe("PullToRefreshContainer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders children", () => {
    renderContainer(() => Promise.resolve());
    expect(screen.getByRole("button", { name: "tap me" })).toBeDefined();
  });

  it("does not hijack a tap with small finger drift", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    renderContainer(onRefresh);
    const button = screen.getByRole("button", { name: "tap me" });

    act(() => {
      dispatchTouchEvent(button, "touchstart", { x: 100, y: 100 });
    });
    let moveEvent: Event;
    act(() => {
      moveEvent = dispatchTouchEvent(button, "touchmove", { x: 102, y: 105 });
    });
    act(() => {
      dispatchTouchEvent(button, "touchend", { x: 102, y: 105 });
    });

    expect(moveEvent!.defaultPrevented).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByTestId("refreshing-overlay")).toBeNull();
  });

  it("triggers refresh after a long downward pull", async () => {
    let resolveRefresh: () => void = () => {};
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    renderContainer(onRefresh);
    const button = screen.getByRole("button", { name: "tap me" });

    act(() => {
      dispatchTouchEvent(button, "touchstart", { x: 100, y: 100 });
    });
    let moveEvent: Event;
    act(() => {
      moveEvent = dispatchTouchEvent(button, "touchmove", { x: 100, y: 260 });
    });
    act(() => {
      dispatchTouchEvent(button, "touchend", { x: 100, y: 260 });
    });

    expect(moveEvent!.defaultPrevented).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("refreshing-overlay")).toBeDefined();

    await act(async () => {
      resolveRefresh();
    });
    expect(screen.queryByTestId("refreshing-overlay")).toBeNull();
  });

  it("does not trigger refresh for a horizontal-dominant swipe", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    renderContainer(onRefresh);
    const button = screen.getByRole("button", { name: "tap me" });

    act(() => {
      dispatchTouchEvent(button, "touchstart", { x: 100, y: 100 });
      dispatchTouchEvent(button, "touchmove", { x: 160, y: 120 });
      dispatchTouchEvent(button, "touchmove", { x: 160, y: 260 });
      dispatchTouchEvent(button, "touchend", { x: 160, y: 260 });
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not trigger refresh when the window is scrolled", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    renderContainer(onRefresh);
    const button = screen.getByRole("button", { name: "tap me" });
    const scrollYSpy = vi.spyOn(window, "scrollY", "get").mockReturnValue(120);

    act(() => {
      dispatchTouchEvent(button, "touchstart", { x: 100, y: 100 });
      dispatchTouchEvent(button, "touchmove", { x: 100, y: 260 });
      dispatchTouchEvent(button, "touchend", { x: 100, y: 260 });
    });

    expect(onRefresh).not.toHaveBeenCalled();
    scrollYSpy.mockRestore();
  });

  it("uses the latest refresh callback after rerender", () => {
    const firstOnRefresh = vi.fn(() => Promise.resolve());
    const latestOnRefresh = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <PullToRefreshContainer
        onRefresh={firstOnRefresh}
        refreshingContent={<div data-testid="refreshing-overlay" />}
      >
        <button type="button">tap me</button>
      </PullToRefreshContainer>,
    );

    rerender(
      <PullToRefreshContainer
        onRefresh={latestOnRefresh}
        refreshingContent={<div data-testid="refreshing-overlay" />}
      >
        <button type="button">tap me</button>
      </PullToRefreshContainer>,
    );
    const button = screen.getByRole("button", { name: "tap me" });

    act(() => {
      dispatchTouchEvent(button, "touchstart", { x: 100, y: 100 });
      dispatchTouchEvent(button, "touchmove", { x: 100, y: 260 });
      dispatchTouchEvent(button, "touchend", { x: 100, y: 260 });
    });

    expect(firstOnRefresh).not.toHaveBeenCalled();
    expect(latestOnRefresh).toHaveBeenCalledTimes(1);
  });
});
