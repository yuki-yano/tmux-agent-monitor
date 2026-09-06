import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogModal } from "./LogModal";

vi.mock("@/features/pwa-tabs/context/workspace-tabs-context", () => ({
  useWorkspaceTabs: () => ({ enabled: false }),
}));
vi.mock("./AnsiVirtualizedViewport", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    AnsiVirtualizedViewport: ({
      lines,
      scrollerRef,
      viewportRef,
    }: {
      lines: string[];
      scrollerRef: { current: HTMLDivElement | null };
      viewportRef: { current: unknown };
    }) => {
      useLayoutEffect(() => {
        viewportRef.current = { scrollToEnd: () => {} };
        return () => {
          viewportRef.current = null;
        };
      }, [viewportRef]);
      return (
        <div ref={scrollerRef} data-testid="scroller">
          {lines.join("\n")}
        </div>
      );
    },
  };
});

describe("LogModal scroll subscriptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reconnects wheel handling to the new pane and cancels the old scroll timer", () => {
    vi.useFakeTimers();
    const addListener = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeListener = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const setTimer = vi.spyOn(window, "setTimeout");
    const clearTimer = vi.spyOn(window, "clearTimeout");
    const scrollEvents = new Set(["scroll", "wheel", "touchmove", "pointerdown", "keydown"]);
    const listenersFor = (element: HTMLElement) =>
      addListener.mock.calls.filter(
        ([type], index) => addListener.mock.contexts[index] === element && scrollEvents.has(type),
      );
    const expectListenersRemoved = (element: HTMLElement) => {
      const listeners = listenersFor(element);
      expect(listeners).toHaveLength(5);
      for (const [type, callback] of listeners) {
        expect(
          removeListener.mock.calls.some(
            ([removedType, removedCallback], index) =>
              removeListener.mock.contexts[index] === element &&
              removedType === type &&
              removedCallback === callback,
          ),
        ).toBe(true);
      }
    };
    const latestScrollTimer = () => {
      let index = -1;
      setTimer.mock.calls.forEach(([, delay], callIndex) => {
        if (delay === 120) index = callIndex;
      });
      expect(index).toBeGreaterThanOrEqual(0);
      return setTimer.mock.results[index]!.value;
    };
    const actions = { onClose: vi.fn(), onOpenHere: vi.fn(), onOpenNewTab: vi.fn() };
    const state = {
      open: true,
      session: { paneId: "a", title: "A" } as SessionSummary,
      logLines: ["A1"],
      loading: false,
      error: null,
    };
    const view = render(<LogModal state={state} actions={actions} />);
    const firstScroller = screen.getByTestId("scroller");
    fireEvent.wheel(firstScroller);
    const firstTimer = latestScrollTimer();
    view.rerender(<LogModal state={{ ...state, logLines: ["A2"] }} actions={actions} />);
    expect(firstScroller.textContent).toBe("A1");
    const next = { ...state, session: { ...state.session, paneId: "b" }, logLines: ["B1"] };
    view.rerender(<LogModal state={next} actions={actions} />);
    expectListenersRemoved(firstScroller);
    expect(clearTimer).toHaveBeenCalledWith(firstTimer);
    const nextScroller = screen.getByTestId("scroller");
    expect(nextScroller).not.toBe(firstScroller);
    fireEvent.wheel(firstScroller);
    view.rerender(<LogModal state={{ ...next, logLines: ["B2"] }} actions={actions} />);
    expect(nextScroller.textContent).toBe("B2");
    fireEvent.wheel(nextScroller);
    view.rerender(<LogModal state={{ ...next, logLines: ["B3"] }} actions={actions} />);
    expect(nextScroller.textContent).toBe("B2");
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(nextScroller.textContent).toBe("B3");
    fireEvent.wheel(nextScroller);
    const finalTimer = latestScrollTimer();
    view.unmount();
    expectListenersRemoved(nextScroller);
    expect(clearTimer).toHaveBeenCalledWith(finalTimer);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.queryByTestId("scroller")).toBeNull();
  });
});
