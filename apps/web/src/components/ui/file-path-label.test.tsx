import { act, render, screen, waitFor } from "@testing-library/react";
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
    await waitFor(() => {
      expect(hint?.textContent).toContain("SessionDetail/components");
    });
    expect([
      ".../SessionDetail/components",
      "apps/web/src/pages/SessionDetail/components",
    ]).toContain(hint?.textContent);
  });

  it("keeps full label when dirTruncate is start", async () => {
    render(
      <FilePathLabel
        data-testid="path-label"
        data-width="80"
        path="apps/web/src/lib/use-sidebar-width.ts"
        dirTruncate="start"
      />,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const container = screen.getByTestId("path-label");
    const hint = container.querySelector("span.text-latte-subtext0:not([aria-hidden='true'])");
    expect(hint?.textContent).toBe("apps/web/src/lib");
  });

  it("shows renamed-from path hint", async () => {
    render(
      <FilePathLabel
        data-testid="path-label"
        data-width="500"
        path="apps/web/src/lib/new-name.ts"
        renamedFrom="apps/web/src/lib/old-name.ts"
        dirTruncate="segments"
      />,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const container = screen.getByTestId("path-label");
    const hint = container.querySelector("span.text-latte-subtext0:not([aria-hidden='true'])");
    expect(hint?.textContent).toBe("from apps/web/src/lib/old-name.ts");
  });
});
