import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SmartScreenViewport } from "./SmartScreenViewport";

type ScrollMetrics = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
};

const installScrollMetrics = (node: HTMLDivElement, metrics: ScrollMetrics) => {
  const scrollTopSetter = vi.fn();
  Object.defineProperty(node, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => metrics.scrollTop,
    set: scrollTopSetter,
  });
  return scrollTopSetter;
};

describe("SmartScreenViewport", () => {
  const setup = (lines: string[]) => {
    const scrollerRef = createRef<HTMLDivElement>();
    const props = {
      classifications: [],
      loading: false,
      loadingLabel: "Loading...",
      scrollContextKey: "pane-1\0text\0smart",
      isAtBottom: true,
      shouldFollowOutput: true,
      onAtBottomChange: vi.fn(),
      scrollerRef,
      onScrollToBottom: vi.fn(),
      onUserScrollStateChange: vi.fn(),
      sanitizeCopyText: (raw: string) => raw,
      onLineClick: vi.fn(),
      onLineKeyDown: vi.fn(),
    };
    const view = render(<SmartScreenViewport lines={lines} {...props} />);
    const rerenderLines = (nextLines: string[]) =>
      view.rerender(<SmartScreenViewport lines={nextLines} {...props} />);
    return { ...view, props, scrollerRef, rerenderLines };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not reassign scrollTop when the scroller is already at the bottom", () => {
    const { scrollerRef, rerenderLines } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    const scrollTopSetter = installScrollMetrics(node, {
      scrollHeight: 100,
      clientHeight: 100,
      scrollTop: 0,
    });

    rerenderLines(["line-1", "line-2"]);

    expect(scrollTopSetter).not.toHaveBeenCalled();
  });

  it("sticks to the bottom when content grows past the viewport", () => {
    const { scrollerRef, rerenderLines } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    const scrollTopSetter = installScrollMetrics(node, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 50,
    });

    rerenderLines(["line-1", "line-2"]);

    expect(scrollTopSetter).toHaveBeenCalledWith(200);
  });

  it("does not follow growing content after the user pauses output", () => {
    const scrollerRef = createRef<HTMLDivElement>();
    const props = {
      classifications: [],
      loading: false,
      loadingLabel: "Loading...",
      scrollContextKey: "pane-1\0text\0smart",
      isAtBottom: true,
      shouldFollowOutput: false,
      onAtBottomChange: vi.fn(),
      scrollerRef,
      onScrollToBottom: vi.fn(),
      onUserScrollStateChange: vi.fn(),
      sanitizeCopyText: (raw: string) => raw,
      onLineClick: vi.fn(),
      onLineKeyDown: vi.fn(),
    };
    const view = render(<SmartScreenViewport lines={["line-1"]} {...props} />);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    const scrollTopSetter = installScrollMetrics(node, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 50,
    });

    view.rerender(<SmartScreenViewport lines={["line-1", "line-2"]} {...props} />);

    expect(scrollTopSetter).not.toHaveBeenCalled();
  });

  it("does not treat a programmatic scroll event as user scrolling", () => {
    const { props, scrollerRef } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    installScrollMetrics(node, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 100,
    });

    fireEvent.scroll(node);

    expect(props.onAtBottomChange).toHaveBeenLastCalledWith(true);
    expect(props.onUserScrollStateChange).not.toHaveBeenCalled();
  });

  it("tracks wheel input until scrolling becomes idle", () => {
    vi.useFakeTimers();
    const { props, scrollerRef } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    fireEvent.wheel(node);
    fireEvent.scroll(node);

    expect(props.onUserScrollStateChange).toHaveBeenCalledTimes(1);
    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(true);

    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(props.onUserScrollStateChange).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(false);
  });

  it("reports scrolling as finished when unmounted before the idle timer", () => {
    vi.useFakeTimers();
    const { props, scrollerRef, unmount } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    fireEvent.pointerDown(node);
    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(true);

    unmount();

    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(false);
    expect(props.onUserScrollStateChange).toHaveBeenCalledTimes(2);
  });

  it("finishes active scrolling when the pane or viewport context changes", () => {
    vi.useFakeTimers();
    const { props, scrollerRef, rerender } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    fireEvent.wheel(node);
    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(true);

    rerender(
      <SmartScreenViewport
        lines={["line-1"]}
        {...props}
        scrollContextKey={"pane-2\0text\0smart"}
      />,
    );

    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(false);
    expect(props.onUserScrollStateChange).toHaveBeenCalledTimes(2);

    act(() => {
      vi.runAllTimers();
    });
    expect(props.onUserScrollStateChange).toHaveBeenCalledTimes(2);
  });

  it("starts user-scroll tracking for scroll navigation keys only", () => {
    vi.useFakeTimers();
    const { props, scrollerRef } = setup(["line-1"]);
    const node = scrollerRef.current;
    expect(node).not.toBeNull();
    if (!node) return;

    fireEvent.keyDown(node, { key: "a" });
    expect(props.onUserScrollStateChange).not.toHaveBeenCalled();

    fireEvent.keyDown(node, { key: "ArrowLeft" });
    expect(props.onUserScrollStateChange).toHaveBeenLastCalledWith(true);
  });
});
