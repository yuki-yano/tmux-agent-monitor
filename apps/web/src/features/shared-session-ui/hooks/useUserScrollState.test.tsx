import { act, fireEvent, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUserScrollState } from "./useUserScrollState";

const Harness = ({
  enabled = true,
  onUserScrollStateChange,
}: {
  enabled?: boolean;
  onUserScrollStateChange: (value: boolean) => void;
}) => {
  const { scrollerRef } = useUserScrollState({ enabled, onUserScrollStateChange });

  useLayoutEffect(() => {
    scrollerRef.current?.focus();
  }, [scrollerRef]);

  return <div ref={scrollerRef} data-testid="scroller" tabIndex={0} />;
};

describe("useUserScrollState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["wheel", "touchMove", "pointerDown"] as const)(
    "tracks %s as user scrolling until input settles",
    (eventName) => {
      vi.useFakeTimers();
      const onUserScrollStateChange = vi.fn();
      const { getByTestId } = render(<Harness onUserScrollStateChange={onUserScrollStateChange} />);

      fireEvent[eventName](getByTestId("scroller"));
      expect(onUserScrollStateChange).toHaveBeenCalledWith(true);

      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(onUserScrollStateChange).toHaveBeenLastCalledWith(false);
    },
  );

  it("tracks keyboard scrolling but ignores unrelated keys", () => {
    vi.useFakeTimers();
    const onUserScrollStateChange = vi.fn();
    const { getByTestId } = render(<Harness onUserScrollStateChange={onUserScrollStateChange} />);
    const scroller = getByTestId("scroller");

    fireEvent.keyDown(scroller, { key: "a" });
    expect(onUserScrollStateChange).not.toHaveBeenCalled();

    fireEvent.keyDown(scroller, { key: "PageUp" });
    expect(onUserScrollStateChange).toHaveBeenCalledWith(true);
  });

  it("clears active user scrolling when disabled", () => {
    vi.useFakeTimers();
    const onUserScrollStateChange = vi.fn();
    const { getByTestId, rerender } = render(
      <Harness onUserScrollStateChange={onUserScrollStateChange} />,
    );
    fireEvent.wheel(getByTestId("scroller"));

    rerender(<Harness enabled={false} onUserScrollStateChange={onUserScrollStateChange} />);

    expect(onUserScrollStateChange).toHaveBeenLastCalledWith(false);
  });

  it("uses the latest callback without interrupting active scrolling", () => {
    vi.useFakeTimers();
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const { getByTestId, rerender } = render(<Harness onUserScrollStateChange={firstCallback} />);

    fireEvent.wheel(getByTestId("scroller"));
    expect(firstCallback).toHaveBeenCalledWith(true);

    rerender(<Harness onUserScrollStateChange={latestCallback} />);
    expect(latestCallback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(latestCallback).toHaveBeenCalledWith(false);
  });
});
