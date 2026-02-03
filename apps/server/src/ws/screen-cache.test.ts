import { describe, expect, it } from "vitest";

import { createScreenCache } from "./screen-cache.js";

describe("createScreenCache", () => {
  it("returns full response on first capture and deltas for small changes", () => {
    const cache = createScreenCache();
    const first = cache.buildTextResponse({
      paneId: "%1",
      lineCount: 3,
      screen: "a\nb\nc",
      alternateOn: false,
      truncated: null,
    });

    expect(first.full).toBe(true);
    expect(first.screen).toBe("a\nb\nc");

    const second = cache.buildTextResponse({
      paneId: "%1",
      lineCount: 3,
      screen: "a\nb\nc!",
      alternateOn: false,
      truncated: null,
      cursor: first.cursor,
    });

    expect(second.full).toBe(false);
    expect(second.deltas?.length ?? 0).toBeGreaterThan(0);
  });

  it("forces full response when alternate state changes", () => {
    const cache = createScreenCache();
    const first = cache.buildTextResponse({
      paneId: "%1",
      lineCount: 2,
      screen: "a\nb",
      alternateOn: false,
      truncated: null,
    });

    const second = cache.buildTextResponse({
      paneId: "%1",
      lineCount: 2,
      screen: "a\nb",
      alternateOn: true,
      truncated: null,
      cursor: first.cursor,
    });

    expect(second.full).toBe(true);
  });
});
