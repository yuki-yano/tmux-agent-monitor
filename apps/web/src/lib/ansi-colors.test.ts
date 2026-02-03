import { describe, expect, it } from "vitest";

import { blendRgb, contrastRatio, luminance, parseColor } from "./ansi-colors";

describe("ansi-colors", () => {
  it("parses hex colors", () => {
    expect(parseColor("#abc")).toEqual([170, 187, 204]);
    expect(parseColor("#0a1b2c")).toEqual([10, 27, 44]);
  });

  it("parses rgb colors", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
  });

  it("returns null for invalid colors", () => {
    expect(parseColor("nope")).toBeNull();
  });

  it("computes luminance ordering", () => {
    expect(luminance([0, 0, 0])).toBeLessThan(luminance([255, 255, 255]));
  });

  it("computes contrast ratio", () => {
    expect(contrastRatio([0, 0, 0], [0, 0, 0])).toBeCloseTo(1, 5);
  });

  it("blends and clamps ratio", () => {
    expect(blendRgb([0, 0, 0], [255, 255, 255], 0)).toEqual([0, 0, 0]);
    expect(blendRgb([0, 0, 0], [255, 255, 255], 1)).toEqual([255, 255, 255]);
    expect(blendRgb([0, 0, 0], [255, 255, 255], 2)).toEqual([255, 255, 255]);
  });
});
