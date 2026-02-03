import { describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "./rate-limit.js";

describe("createRateLimiter", () => {
  it("enforces max per window and resets after window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      const limiter = createRateLimiter(1000, 2);

      expect(limiter("client")).toBe(true);
      expect(limiter("client")).toBe(true);
      expect(limiter("client")).toBe(false);

      vi.setSystemTime(new Date("2025-01-01T00:00:01.001Z"));
      expect(limiter("client")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
