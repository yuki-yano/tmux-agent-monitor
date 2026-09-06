import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOverflowTruncate } from "./file-path-label-utils";

const OverflowLabel = ({ text }: { text: string }) => {
  const { ref, truncate } = useOverflowTruncate(text);
  return (
    <span ref={ref} data-testid="label" data-truncate={truncate}>
      {text}
    </span>
  );
};

describe("useOverflowTruncate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("measures text and resize events, clears empty text, and releases observers", () => {
    let width = 20;
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(10);
    const view = render(<OverflowLabel text="long" />);
    expect(screen.getByTestId("label").getAttribute("data-truncate")).toBe("true");
    width = 5;
    act(() => resize?.());
    expect(screen.getByTestId("label").getAttribute("data-truncate")).toBe("false");
    width = 20;
    act(() => resize?.());
    view.rerender(<OverflowLabel text="" />);
    expect(screen.getByTestId("label").getAttribute("data-truncate")).toBe("false");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    width = 5;
    view.rerender(<OverflowLabel text="short" />);
    expect(screen.getByTestId("label").getAttribute("data-truncate")).toBe("false");
    expect(observe).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
