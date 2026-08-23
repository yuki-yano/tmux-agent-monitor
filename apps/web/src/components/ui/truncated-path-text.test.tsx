import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TruncatedPathText } from "./truncated-path-text";

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

const expectVisibleLabel = async (testId: string, expected: string) => {
  await waitFor(() => {
    const path = screen.getByTestId(testId);
    const visibleLabel = path.querySelector("span:not([aria-hidden='true'])");
    expect(visibleLabel?.textContent).toBe(expected);
  });
};

describe("TruncatedPathText", () => {
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

  it("shows the full path when it fits", async () => {
    render(<TruncatedPathText data-testid="path" data-width="240" path="apps/web/src/index.ts" />);

    await expectVisibleLabel("path", "apps/web/src/index.ts");

    const path = screen.getByTestId("path");
    expect(path.getAttribute("title")).toBe("apps/web/src/index.ts");
  });

  it("keeps at least two trailing segments by default", async () => {
    render(<TruncatedPathText data-testid="path" data-width="110" path="aaaaaa/bbbbbb/cccccc" />);

    await expectVisibleLabel("path", ".../bbbbbb/cccccc");
  });

  it("allows one trailing segment when minVisibleSegments is 1", async () => {
    render(
      <TruncatedPathText
        data-testid="path"
        data-width="70"
        path="aaaaaa/bbbbbb/cccccc"
        minVisibleSegments={1}
      />,
    );

    await expectVisibleLabel("path", ".../cccccc");
  });
});
