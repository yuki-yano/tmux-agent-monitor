import type { SessionDetail } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { cleanupRegistry } from "./registry-cleanup.js";

describe("cleanupRegistry", () => {
  it("removes missing panes and saves state", () => {
    const registry = {
      removeMissing: vi.fn(() => ["1", "2"]),
      values: vi.fn(() => [{ paneId: "3" } as SessionDetail]),
    };
    const paneStates = {
      remove: vi.fn(),
      pruneMissing: vi.fn(),
    };
    const customTitles = new Map<string, string>([
      ["1", "A"],
      ["2", "B"],
      ["3", "C"],
    ]);
    const saveState = vi.fn();
    const activePaneIds = new Set<string>(["3"]);

    cleanupRegistry({ registry, paneStates, customTitles, activePaneIds, saveState });

    expect(paneStates.remove).toHaveBeenCalledWith("1");
    expect(paneStates.remove).toHaveBeenCalledWith("2");
    expect(customTitles.has("1")).toBe(false);
    expect(customTitles.has("2")).toBe(false);
    expect(customTitles.has("3")).toBe(true);
    expect(paneStates.pruneMissing).toHaveBeenCalledWith(activePaneIds);
    expect(saveState).toHaveBeenCalledWith([{ paneId: "3" }]);
  });
});
