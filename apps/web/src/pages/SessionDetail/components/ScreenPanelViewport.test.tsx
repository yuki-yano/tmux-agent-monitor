import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { VirtualizedViewportHandle } from "@/features/shared-session-ui/components/AnsiVirtualizedViewport";

import { ScreenPanelViewport } from "./ScreenPanelViewport";

vi.mock("@/features/shared-session-ui/components/AnsiVirtualizedViewport", () => ({
  AnsiVirtualizedViewport: ({
    onRangeChanged,
  }: {
    onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
  }) => (
    <button type="button" onClick={() => onRangeChanged?.({ startIndex: 2, endIndex: 4 })}>
      Publish ANSI range
    </button>
  ),
}));

describe("ScreenPanelViewport", () => {
  it("publishes visible ranges only from the ANSI viewport after switching smart mode off", () => {
    const onRangeChanged = vi.fn();
    const scrollerRef = createRef<HTMLDivElement>();
    const viewportRef = createRef<VirtualizedViewportHandle>();
    const props = {
      mode: "text" as const,
      scrollContextKey: "pane-1\0text",
      imageBase64: null,
      isAtBottom: true,
      shouldFollowOutput: true,
      isScreenLoading: false,
      screenLines: ["line-1", "line-2"],
      smartLineClassifications: [],
      viewportRef,
      scrollerRef,
      onAtBottomChange: vi.fn(),
      onRangeChanged,
      onScrollToBottom: vi.fn(),
      onUserScrollStateChange: vi.fn(),
      onResolveFileReference: vi.fn(),
      onResolveFileReferenceKeyDown: vi.fn(),
    };
    const view = render(<ScreenPanelViewport {...props} effectiveWrapMode="smart" />);

    expect(onRangeChanged).not.toHaveBeenCalled();

    view.rerender(<ScreenPanelViewport {...props} effectiveWrapMode="off" />);
    fireEvent.click(screen.getByRole("button", { name: "Publish ANSI range" }));

    expect(onRangeChanged).toHaveBeenCalledOnce();
    expect(onRangeChanged).toHaveBeenCalledWith({ startIndex: 2, endIndex: 4 });
  });
});
