import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoadingOverlay } from "./loading-overlay";

describe("LoadingOverlay", () => {
  it("uses the immediate entrance animation by default", () => {
    render(<LoadingOverlay label="Loading" />);

    expect(screen.getByText("Loading").parentElement?.className).toContain("animate-fade-in");
  });

  it("can delay its entrance to avoid flashing for short loads", () => {
    render(<LoadingOverlay label="Loading" entrance="delayed" />);

    const className = screen.getByText("Loading").parentElement?.className;
    expect(className).toContain("animate-delayed-fade-in");
    expect(className).not.toContain("animate-fade-in");
  });
});
