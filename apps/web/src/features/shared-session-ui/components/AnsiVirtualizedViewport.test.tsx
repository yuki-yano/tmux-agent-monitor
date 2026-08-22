import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnsiVirtualizedViewport, type VirtualizedViewportHandle } from "./AnsiVirtualizedViewport";

const virtualizerState = vi.hoisted(() => ({
  atEnd: true,
  options: undefined as
    | {
        count: number;
        estimateSize?: () => number;
        followOnAppend?: boolean | "auto" | "smooth";
        useFlushSync?: boolean;
      }
    | undefined,
  scrollToEnd: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: {
    count: number;
    estimateSize?: () => number;
    followOnAppend?: boolean | "auto" | "smooth";
    useFlushSync?: boolean;
  }) => {
    virtualizerState.options = options;
    return {
      range: options.count > 0 ? { startIndex: 0, endIndex: options.count - 1 } : null,
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          index,
          key: `item-${index}`,
          start: index * 16,
        })),
      getTotalSize: () => options.count * 16,
      isAtEnd: () => virtualizerState.atEnd,
      measureElement: vi.fn(),
      scrollToEnd: virtualizerState.scrollToEnd,
    };
  },
}));

const defaultProps = {
  scrollContextKey: "pane-1",
  loading: false,
  loadingLabel: "Loading",
  onAtBottomChange: vi.fn(),
};

describe("AnsiVirtualizedViewport", () => {
  it("shows scroll-to-bottom button and delegates click handler", () => {
    const onScrollToBottom = vi.fn();

    render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom={false}
        onScrollToBottom={onScrollToBottom}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));
    expect(onScrollToBottom).toHaveBeenCalledWith("smooth");
  });

  it("sanitizes copied text when sanitizer is provided", () => {
    const setData = vi.fn();
    const preventDefault = vi.fn();
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "line-1\r\nline-2",
    } as unknown as Selection);

    const { container } = render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom
        sanitizeCopyText={(raw) => raw.replace(/\r\n/gu, "\n")}
      />,
    );

    const event = new Event("copy", { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    event.preventDefault = preventDefault;
    container.firstElementChild?.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith("text/plain", "line-1\nline-2");
    expect(preventDefault).toHaveBeenCalled();
    getSelectionSpy.mockRestore();
  });

  it("only follows appended output while follow intent is active", () => {
    const { rerender } = render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom
        followOutput="smooth"
      />,
    );

    expect(virtualizerState.options?.followOnAppend).toBe("smooth");

    rerender(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom={false}
        followOutput="smooth"
      />,
    );

    expect(virtualizerState.options?.followOnAppend).toBe(false);
  });

  it("contains the absolute scroller and avoids commit-time flushSync", () => {
    render(
      <AnsiVirtualizedViewport {...defaultProps} lines={["line-1"]} isAtBottom height="320px" />,
    );

    const log = screen.getByRole("log", { name: "Terminal output" });
    const region = screen.getByRole("region", { name: "Scrollable terminal output" });
    expect(log.className).toContain("relative");
    expect(log.className).toContain("flex-none");
    expect(log.className).not.toContain("flex-1");
    expect(log.style.height).toBe("320px");
    expect(region.className).toContain("absolute");
    expect(virtualizerState.options?.useFlushSync).toBe(false);
  });

  it("uses the supplied line-height estimate", () => {
    render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1"]}
        isAtBottom
        estimatedLineHeight={20}
      />,
    );

    expect(virtualizerState.options?.estimateSize?.()).toBe(20);
  });

  it("stretches every row to the widest rendered line without losing horizontal position", () => {
    const { rerender } = render(
      <AnsiVirtualizedViewport {...defaultProps} lines={["short", "long"]} isAtBottom />,
    );
    const region = screen.getByRole("region", { name: "Scrollable terminal output" });
    const list = region.firstElementChild as HTMLDivElement;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-index]"));
    let rowWidths = [600, 1200];

    Object.defineProperty(list, "clientWidth", { configurable: true, value: 600 });
    rows.forEach((row, index) => {
      Object.defineProperty(row, "scrollWidth", {
        configurable: true,
        get: () => rowWidths[index],
      });
    });

    rerender(<AnsiVirtualizedViewport {...defaultProps} lines={["short", "longer"]} isAtBottom />);

    expect(list.style.width).toBe("1200px");
    expect(rows.every((row) => row.style.minWidth === "100%")).toBe(true);

    region.scrollLeft = 100;
    rowWidths = [600, 700];
    rerender(
      <AnsiVirtualizedViewport {...defaultProps} lines={["shorter", "longest"]} isAtBottom />,
    );

    expect(list.style.width).toBe("1200px");
    expect(region.scrollLeft).toBe(100);

    region.scrollLeft = 0;
    rerender(
      <AnsiVirtualizedViewport {...defaultProps} lines={["shortest", "longest!"]} isAtBottom />,
    );

    expect(list.style.width).toBe("700px");

    region.scrollLeft = 100;
    rowWidths = [600, 650];
    rerender(
      <AnsiVirtualizedViewport
        {...defaultProps}
        scrollContextKey="pane-2"
        lines={["new", "context"]}
        isAtBottom
      />,
    );

    expect(list.style.width).toBe("650px");
  });

  it("follows explicit intent independently from the physical bottom state", () => {
    render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom={false}
        followOutput="smooth"
        shouldFollowOutput
      />,
    );

    expect(virtualizerState.options?.followOnAppend).toBe("smooth");
  });

  it("scrolls to the end when a followed capped buffer rolls forward", () => {
    virtualizerState.scrollToEnd.mockClear();
    const { rerender } = render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom
        shouldFollowOutput
      />,
    );
    const initialCalls = virtualizerState.scrollToEnd.mock.calls.length;

    rerender(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-2", "line-3"]}
        isAtBottom
        shouldFollowOutput
      />,
    );

    expect(virtualizerState.scrollToEnd.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("scrolls to the end when a followed capped buffer shrinks", () => {
    virtualizerState.scrollToEnd.mockClear();
    const { rerender } = render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2", "line-3"]}
        isAtBottom
        shouldFollowOutput
      />,
    );
    const initialCalls = virtualizerState.scrollToEnd.mock.calls.length;

    rerender(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-2", "line-3"]}
        isAtBottom
        shouldFollowOutput
      />,
    );

    expect(virtualizerState.scrollToEnd.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("does not scroll to the end after following is paused", () => {
    virtualizerState.scrollToEnd.mockClear();
    const { rerender } = render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1"]}
        isAtBottom={false}
        shouldFollowOutput={false}
      />,
    );

    rerender(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom={false}
        shouldFollowOutput={false}
      />,
    );

    expect(virtualizerState.scrollToEnd).not.toHaveBeenCalled();
  });

  it("exposes a library-independent scroll handle", () => {
    virtualizerState.scrollToEnd.mockClear();
    const viewportRef = createRef<VirtualizedViewportHandle>();
    render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1"]}
        isAtBottom={false}
        shouldFollowOutput={false}
        viewportRef={viewportRef}
      />,
    );

    viewportRef.current?.scrollToEnd({ behavior: "auto" });

    expect(virtualizerState.scrollToEnd).toHaveBeenCalledWith({ behavior: "auto" });
  });

  it("publishes the visible range", () => {
    const onRangeChanged = vi.fn();
    render(
      <AnsiVirtualizedViewport
        {...defaultProps}
        lines={["line-1", "line-2"]}
        isAtBottom
        onRangeChanged={onRangeChanged}
      />,
    );

    expect(onRangeChanged).toHaveBeenCalledWith({ startIndex: 0, endIndex: 1 });
  });
});
