import { describe, expect, it, vi } from "vitest";

import { resolveActivityTimestamp } from "./activity-resolver";

const toIso = (value: number) => new Date(value * 1000).toISOString();

describe("resolveActivityTimestamp", () => {
  it("prefers pane activity when available", () => {
    const result = resolveActivityTimestamp({
      paneId: "%1",
      paneActivity: 1_700_000_000,
      windowActivity: 1_700_000_100,
      paneActive: false,
      suppressor: () => false,
    });

    expect(result).toBe(toIso(1_700_000_000));
  });

  it("does not fall back to window activity when pane activity is missing", () => {
    const result = resolveActivityTimestamp({
      paneId: "%1",
      paneActivity: null,
      windowActivity: 1_700_000_100,
      paneActive: true,
      suppressor: () => false,
    });

    expect(result).toBeNull();
  });

  it("does not fall back to window activity when pane activity is suppressed", () => {
    const paneIso = toIso(1_700_000_000);
    const suppressor = vi.fn((_: string, activityIso: string | null) => activityIso === paneIso);

    const result = resolveActivityTimestamp({
      paneId: "%1",
      paneActivity: 1_700_000_000,
      windowActivity: 1_700_000_100,
      paneActive: true,
      suppressor,
    });

    expect(result).toBeNull();
    expect(suppressor).toHaveBeenCalledTimes(1);
  });
});
