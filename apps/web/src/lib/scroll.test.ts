import { describe, expect, it } from "vitest";

import { isNearBottom } from "./scroll";

describe("isNearBottom", () => {
  it("returns true when within threshold from bottom", () => {
    expect(isNearBottom(1000, 900, 80, 30)).toBe(true);
  });

  it("returns false when above threshold from bottom", () => {
    expect(isNearBottom(1000, 800, 80, 30)).toBe(false);
  });

  it("treats exact threshold as near bottom", () => {
    expect(isNearBottom(1000, 890, 80, 30)).toBe(true);
  });
});
