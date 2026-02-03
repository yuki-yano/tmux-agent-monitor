// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilePathLabel } from "./file-path-label";

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

describe("FilePathLabel", () => {
  let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;
  let originalFonts: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
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
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      return window.setTimeout(() => cb(0), 0);
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
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalFonts) {
      Object.defineProperty(document, "fonts", originalFonts);
    } else {
      // @ts-expect-error - allow cleanup for test runtime
      delete document.fonts;
    }
    vi.restoreAllMocks();
  });

  it("shows full directory when it fits", async () => {
    render(
      <FilePathLabel
        data-testid="path-label"
        data-width="200"
        path="apps/web/src/lib/use-sidebar-width.ts"
        dirTruncate="segments"
      />,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const container = screen.getByTestId("path-label");
    const hint = container.querySelector("span.text-latte-subtext0:not([aria-hidden='true'])");
    expect(hint?.textContent).toBe("apps/web/src/lib");
  });

  it("adds ellipsis and fits trailing segments when truncated", async () => {
    render(
      <FilePathLabel
        data-testid="path-label"
        data-width="180"
        path="apps/web/src/pages/SessionDetail/components/CommitSection.tsx"
        dirTruncate="segments"
      />,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const container = screen.getByTestId("path-label");
    const hint = container.querySelector("span.text-latte-subtext0:not([aria-hidden='true'])");
    expect(hint?.textContent).toBe(".../SessionDetail/components");
  });
});
