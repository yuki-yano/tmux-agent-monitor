import { describe, expect, it } from "vitest";

import { cropPaneBounds } from "./crop.js";

describe("cropPaneBounds", () => {
  it("returns cropped bounds based on pane geometry", () => {
    const base = { x: 0, y: 0, width: 200, height: 100 };
    const geometry = {
      left: 10,
      top: 5,
      width: 50,
      height: 20,
      windowWidth: 100,
      windowHeight: 50,
    };
    expect(cropPaneBounds(base, geometry)).toEqual({
      x: 20,
      y: 10,
      width: 100,
      height: 40,
    });
  });

  it("returns null when geometry is invalid", () => {
    const base = { x: 0, y: 0, width: 200, height: 100 };
    const geometry = {
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      windowWidth: 0,
      windowHeight: 0,
    };
    expect(cropPaneBounds(base, geometry)).toBeNull();
  });
});
