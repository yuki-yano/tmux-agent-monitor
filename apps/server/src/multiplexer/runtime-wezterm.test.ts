import { describe, expect, it } from "vitest";

import { createWeztermServerKey } from "./runtime-wezterm.js";

describe("createWeztermServerKey", () => {
  it("uses same serverKey for null/blank/auto", () => {
    const base = createWeztermServerKey(null);
    expect(createWeztermServerKey("")).toBe(base);
    expect(createWeztermServerKey("   ")).toBe(base);
    expect(createWeztermServerKey("auto")).toBe(base);
  });

  it("normalizes trimmed targets to same serverKey", () => {
    expect(createWeztermServerKey(" dev ")).toBe(createWeztermServerKey("dev"));
  });
});
