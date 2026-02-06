import { describe, expect, it } from "vitest";

import { parseBoundsSet } from "./macos-bounds.js";

describe("parseBoundsSet", () => {
  it("parses content and window bounds", () => {
    const input = "1, 2, 3, 4|5, 6, 7, 8";
    const result = parseBoundsSet(input);
    expect(result.content).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(result.window).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });

  it("falls back to content bounds when window is missing", () => {
    const input = "1, 2, 3, 4";
    const result = parseBoundsSet(input);
    expect(result.window).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("drops invalid bounds with non-positive size", () => {
    const input = "1, 2, 0, 4|5, 6, 7, 8";
    const result = parseBoundsSet(input);
    expect(result.content).toBeNull();
    expect(result.window).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });
});
