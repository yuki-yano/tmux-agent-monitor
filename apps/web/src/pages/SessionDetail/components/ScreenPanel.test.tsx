// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ScreenPanel } from "./ScreenPanel";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data = [],
    itemContent,
  }: {
    data?: string[];
    itemContent: (index: number, item: string) => ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}));

describe("ScreenPanel", () => {
  const baseRawProps = { rawMode: false, allowDangerKeys: false };

  it("shows raw indicator when enabled", () => {
    render(
      <ScreenPanel
        mode="text"
        onModeChange={vi.fn()}
        connected
        onRefresh={vi.fn()}
        fallbackReason={null}
        error={null}
        isScreenLoading={false}
        imageBase64={null}
        screenLines={["line"]}
        virtuosoRef={{ current: null }}
        scrollerRef={{ current: null }}
        isAtBottom
        forceFollow={false}
        onAtBottomChange={vi.fn()}
        onScrollToBottom={vi.fn()}
        onUserScrollStateChange={vi.fn()}
        rawMode
        allowDangerKeys
        controls={null}
      />,
    );

    expect(screen.getByText("Raw")).toBeTruthy();
    expect(screen.getByText("Unsafe")).toBeTruthy();
  });

  it("renders fallback and error messages", () => {
    render(
      <ScreenPanel
        mode="text"
        onModeChange={vi.fn()}
        connected
        onRefresh={vi.fn()}
        fallbackReason="image_failed"
        error="Screen error"
        isScreenLoading={false}
        imageBase64={null}
        screenLines={["line"]}
        virtuosoRef={{ current: null }}
        scrollerRef={{ current: null }}
        isAtBottom
        forceFollow={false}
        onAtBottomChange={vi.fn()}
        onScrollToBottom={vi.fn()}
        onUserScrollStateChange={vi.fn()}
        {...baseRawProps}
        controls={null}
      />,
    );

    expect(screen.getByText("Image fallback: image_failed")).toBeTruthy();
    expect(screen.getByText("Screen error")).toBeTruthy();
  });

  it("renders image mode content", () => {
    render(
      <ScreenPanel
        mode="image"
        onModeChange={vi.fn()}
        connected
        onRefresh={vi.fn()}
        fallbackReason={null}
        error={null}
        isScreenLoading={false}
        imageBase64="abc123"
        screenLines={[]}
        virtuosoRef={{ current: null }}
        scrollerRef={{ current: null }}
        isAtBottom
        forceFollow={false}
        onAtBottomChange={vi.fn()}
        onScrollToBottom={vi.fn()}
        onUserScrollStateChange={vi.fn()}
        {...baseRawProps}
        controls={null}
      />,
    );

    const img = screen.getByAltText("screen") as HTMLImageElement;
    expect(img.src).toContain("data:image/png;base64,abc123");
  });

  it("shows scroll-to-bottom button when not at bottom", () => {
    const onScrollToBottom = vi.fn();
    render(
      <ScreenPanel
        mode="text"
        onModeChange={vi.fn()}
        connected
        onRefresh={vi.fn()}
        fallbackReason={null}
        error={null}
        isScreenLoading={false}
        imageBase64={null}
        screenLines={["line"]}
        virtuosoRef={{ current: null }}
        scrollerRef={{ current: null }}
        isAtBottom={false}
        forceFollow={false}
        onAtBottomChange={vi.fn()}
        onScrollToBottom={onScrollToBottom}
        onUserScrollStateChange={vi.fn()}
        {...baseRawProps}
        controls={null}
      />,
    );

    fireEvent.click(screen.getByLabelText("Scroll to bottom"));
    expect(onScrollToBottom).toHaveBeenCalledWith("smooth");
  });

  it("invokes refresh handler", () => {
    const onRefresh = vi.fn();
    render(
      <ScreenPanel
        mode="text"
        onModeChange={vi.fn()}
        connected
        onRefresh={onRefresh}
        fallbackReason={null}
        error={null}
        isScreenLoading={false}
        imageBase64={null}
        screenLines={["line"]}
        virtuosoRef={{ current: null }}
        scrollerRef={{ current: null }}
        isAtBottom
        forceFollow={false}
        onAtBottomChange={vi.fn()}
        onScrollToBottom={vi.fn()}
        onUserScrollStateChange={vi.fn()}
        {...baseRawProps}
        controls={null}
      />,
    );

    const buttons = screen.queryAllByLabelText("Refresh screen");
    const first = buttons[0];
    expect(first).toBeTruthy();
    fireEvent.click(first as Element);
    expect(onRefresh).toHaveBeenCalled();
  });

  it("sanitizes copied log text", () => {
    const selection = { toString: () => "line\u0007bell" } as unknown as Selection;
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue(selection);
    const setData = vi.fn();

    render(
      <ScreenPanel
        mode="text"
        onModeChange={vi.fn()}
        connected
        onRefresh={vi.fn()}
        fallbackReason={null}
        error={null}
        isScreenLoading={false}
        imageBase64={null}
        screenLines={["line"]}
        virtuosoRef={{ current: null }}
        scrollerRef={{ current: null }}
        isAtBottom
        forceFollow={false}
        onAtBottomChange={vi.fn()}
        onScrollToBottom={vi.fn()}
        onUserScrollStateChange={vi.fn()}
        {...baseRawProps}
        controls={null}
      />,
    );

    const container = screen.getByTestId("virtuoso").parentElement;
    expect(container).toBeTruthy();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    container?.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith("text/plain", "linebell");
    expect(event.defaultPrevented).toBe(true);
    getSelectionSpy.mockRestore();
  });
});
