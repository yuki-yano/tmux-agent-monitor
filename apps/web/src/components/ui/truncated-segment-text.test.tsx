import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TruncatedSegmentText } from "./truncated-segment-text";

const rect = (width: number): DOMRect =>
  ({
    width,
    height: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => "",
  }) as DOMRect;

const getVisibleLabel = (testId: string) => {
  const text = screen.getByTestId(testId);
  return text.querySelector("span:not([aria-hidden='true'])");
};

describe("TruncatedSegmentText", () => {
  let originalGetBoundingClientRect: PropertyDescriptor | undefined;
  let originalFonts: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );
    HTMLElement.prototype.getBoundingClientRect = function () {
      const dataWidth = this.getAttribute?.("data-width");
      if (dataWidth) {
        return rect(Number(dataWidth));
      }
      if (this.tagName === "SPAN") {
        const text = this.textContent ?? "";
        return rect(text.length * 6);
      }
      return rect(0);
    };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      return window.setTimeout(() => callback(0), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      window.clearTimeout(id);
    });
    originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      value: { ready: Promise.resolve() },
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalGetBoundingClientRect) {
      Object.defineProperty(
        HTMLElement.prototype,
        "getBoundingClientRect",
        originalGetBoundingClientRect,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "getBoundingClientRect");
    }
    if (originalFonts) {
      Object.defineProperty(document, "fonts", originalFonts);
    } else {
      Reflect.deleteProperty(document, "fonts");
    }
    vi.restoreAllMocks();
  });

  it("shows full text when it fits", async () => {
    render(
      <TruncatedSegmentText data-testid="text" data-width="300" text="feature/very/long/branch" />,
    );

    await waitFor(() => {
      expect(getVisibleLabel("text")?.textContent).toBe("feature/very/long/branch");
    });
  });

  it("keeps at least two segments when truncated", async () => {
    render(
      <TruncatedSegmentText data-testid="text" data-width="110" text="aaaaaa/bbbbbb/cccccc" />,
    );

    await waitFor(() => {
      expect(getVisibleLabel("text")?.textContent).toBe(".../bbbbbb/cccccc");
    });
  });

  it("truncates long single-segment text from the start", async () => {
    render(
      <TruncatedSegmentText
        data-testid="text"
        data-width="110"
        text="feature-super-long-branch-name"
      />,
    );

    await waitFor(() => {
      const visibleLabel = getVisibleLabel("text");
      expect(visibleLabel?.textContent?.startsWith("…")).toBe(true);
      expect(visibleLabel?.textContent).not.toBe("feature-super-long-branch-name");
    });
  });
});
