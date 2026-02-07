import { describe, expect, it } from "vitest";

import { buildWeztermTargetArgs, normalizeWeztermTarget } from "./target.js";

describe("normalizeWeztermTarget", () => {
  it("normalizes null/blank/auto to auto", () => {
    expect(normalizeWeztermTarget(null)).toBe("auto");
    expect(normalizeWeztermTarget("")).toBe("auto");
    expect(normalizeWeztermTarget("   ")).toBe("auto");
    expect(normalizeWeztermTarget("auto")).toBe("auto");
  });

  it("trims target values", () => {
    expect(normalizeWeztermTarget(" dev ")).toBe("dev");
  });
});

describe("buildWeztermTargetArgs", () => {
  it("omits --target for auto", () => {
    expect(buildWeztermTargetArgs("auto")).toEqual([]);
    expect(buildWeztermTargetArgs("")).toEqual([]);
    expect(buildWeztermTargetArgs(null)).toEqual([]);
  });

  it("adds --target for explicit target", () => {
    expect(buildWeztermTargetArgs(" dev ")).toEqual(["--target", "dev"]);
  });
});
