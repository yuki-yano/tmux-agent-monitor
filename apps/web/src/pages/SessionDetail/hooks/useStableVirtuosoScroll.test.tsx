// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { __testables, useStableVirtuosoScroll } from "./useStableVirtuosoScroll";

type Control = {
  scroller: HTMLDivElement;
  handleRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
};

type HarnessProps = {
  items: string[];
  isAtBottom: boolean;
  enabled?: boolean;
  hideDataIndex?: boolean;
  isUserScrollingOverride?: boolean;
  onUserScrollStateChange?: (value: boolean) => void;
  onReady: (control: Control) => void;
  children?: ReactNode;
};

const prepareScrollMetrics = (scroller: HTMLDivElement) => {
  Object.defineProperty(scroller, "scrollHeight", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(scroller, "clientHeight", {
    value: 100,
    configurable: true,
  });
};

const TestHarness = ({
  items,
  isAtBottom,
  enabled = true,
  hideDataIndex = false,
  isUserScrollingOverride,
  onUserScrollStateChange,
  onReady,
}: HarnessProps) => {
  const { scrollerRef, handleRangeChanged } = useStableVirtuosoScroll({
    items,
    isAtBottom,
    enabled,
    isUserScrolling: isUserScrollingOverride,
    onUserScrollStateChange,
  });

  useEffect(() => {
    if (!scrollerRef.current) return;
    prepareScrollMetrics(scrollerRef.current);
    onReady({ scroller: scrollerRef.current, handleRangeChanged });
  }, [handleRangeChanged, onReady, scrollerRef]);

  return (
    <div
      data-testid="scroller"
      data-top="0"
      data-height="100"
      ref={scrollerRef}
      style={{ overflow: "auto", height: 100 }}
    >
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          data-index={hideDataIndex ? undefined : index}
          data-top={index * 10}
          data-height="10"
        >
          {item}
        </div>
      ))}
    </div>
  );
};

const mockRects = () => {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function mockRect(this: HTMLElement) {
      const top = Number(this.getAttribute("data-top") ?? 0);
      const height = Number(this.getAttribute("data-height") ?? 0);
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 0,
        bottom: top + height,
        width: 0,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });
};

describe("useStableVirtuosoScroll", () => {
  it("adjusts scrollTop when items are prepended", () => {
    const rectSpy = mockRects();
    let control: Control | null = null;
    const getControl = () => {
      if (!control) throw new Error("control not ready");
      return control;
    };

    const { rerender } = render(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    getControl().handleRangeChanged({ startIndex: 1, endIndex: 3 });
    rerender(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    getControl().scroller.scrollTop = 0;
    rerender(
      <TestHarness
        items={["X", "Y", "A", "B", "C", "D"]}
        isAtBottom={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    expect(getControl().scroller.scrollTop).toBe(20);
    rectSpy.mockRestore();
  });

  it("does not adjust scrollTop when already at bottom", () => {
    const rectSpy = mockRects();
    let control: Control | null = null;
    const getControl = () => {
      if (!control) throw new Error("control not ready");
      return control;
    };

    const { rerender } = render(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    getControl().handleRangeChanged({ startIndex: 1, endIndex: 3 });
    rerender(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom
        onReady={(next) => {
          control = next;
        }}
      />,
    );
    getControl().scroller.scrollTop = 15;
    rerender(
      <TestHarness
        items={["X", "Y", "A", "B", "C", "D"]}
        isAtBottom
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    expect(getControl().scroller.scrollTop).toBe(15);
    rectSpy.mockRestore();
  });

  it("skips correction while user is scrolling and applies after scroll end", async () => {
    const rectSpy = mockRects();
    let control: Control | null = null;
    const getControl = () => {
      if (!control) throw new Error("control not ready");
      return control;
    };

    const { rerender } = render(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        enabled={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    getControl();
    rerender(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        enabled
        onReady={(next) => {
          control = next;
        }}
      />,
    );
    getControl().handleRangeChanged({ startIndex: 0, endIndex: 2 });
    rerender(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        enabled
        onReady={(next) => {
          control = next;
        }}
      />,
    );
    await act(async () => {});
    rerender(
      <TestHarness
        items={["X", "A", "B", "C", "D"]}
        isAtBottom={false}
        enabled
        isUserScrollingOverride
        onReady={(next) => {
          control = next;
        }}
      />,
    );
    expect(getControl().scroller.scrollTop).toBe(0);

    rerender(
      <TestHarness
        items={["Y", "X", "A", "B", "C", "D"]}
        isAtBottom={false}
        enabled
        isUserScrollingOverride={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );
    expect(getControl().scroller.scrollTop).toBe(10);

    rectSpy.mockRestore();
  });

  it("suppresses correction when internal scrolling is active even if external flag is false", () => {
    expect(
      __testables.shouldSuppressCorrection({
        isInternalUserScrolling: true,
        isExternalUserScrolling: false,
        recentlyScrolled: false,
        allowCorrectionOnce: true,
      }),
    ).toBe(true);
  });

  it("falls back to previous scrollTop when data-index is unavailable", () => {
    const rectSpy = mockRects();
    let control: Control | null = null;
    const getControl = () => {
      if (!control) throw new Error("control not ready");
      return control;
    };
    const { rerender } = render(
      <TestHarness
        items={["A", "B", "C"]}
        isAtBottom={false}
        hideDataIndex
        enabled={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    getControl();
    rerender(
      <TestHarness
        items={["A", "B", "C"]}
        isAtBottom={false}
        hideDataIndex
        enabled
        isUserScrollingOverride
        onReady={(next) => {
          control = next;
        }}
      />,
    );
    getControl().scroller.scrollTop = 40;
    getControl().handleRangeChanged({ startIndex: 0, endIndex: 2 });

    rerender(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        hideDataIndex
        enabled
        isUserScrollingOverride={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    expect(getControl().scroller.scrollTop).toBe(40);
    rectSpy.mockRestore();
  });

  it("does not treat programmatic scroll as user scroll", () => {
    const rectSpy = mockRects();
    let control: Control | null = null;
    const onUserScrollStateChange = vi.fn();
    const getControl = () => {
      if (!control) throw new Error("control not ready");
      return control;
    };

    render(
      <TestHarness
        items={["A", "B", "C"]}
        isAtBottom={false}
        onUserScrollStateChange={onUserScrollStateChange}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    const event = new Event("scroll");
    act(() => {
      getControl().scroller.dispatchEvent(event);
    });

    expect(onUserScrollStateChange).not.toHaveBeenCalled();
    rectSpy.mockRestore();
  });

  it("suppresses correction after programmatic scroll", () => {
    const rectSpy = mockRects();
    let control: Control | null = null;
    const getControl = () => {
      if (!control) throw new Error("control not ready");
      return control;
    };

    const { rerender } = render(
      <TestHarness
        items={["A", "B", "C", "D"]}
        isAtBottom={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    getControl().scroller.scrollTop = 20;
    getControl().handleRangeChanged({ startIndex: 2, endIndex: 3 });

    const event = new Event("scroll");
    act(() => {
      getControl().scroller.dispatchEvent(event);
    });

    rerender(
      <TestHarness
        items={["X", "A", "B", "C", "D"]}
        isAtBottom={false}
        onReady={(next) => {
          control = next;
        }}
      />,
    );

    expect(getControl().scroller.scrollTop).toBe(20);
    rectSpy.mockRestore();
  });
});
