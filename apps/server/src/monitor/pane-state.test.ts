import { describe, expect, it } from "vitest";

import { createPaneStateStore, updateOutputAt } from "./pane-state.js";

describe("pane-state", () => {
  it("initializes default state", () => {
    const store = createPaneStateStore();
    const state = store.get("pane-1");
    expect(state.lastOutputAt).toBeNull();
    expect(state.lastEventAt).toBeNull();
    expect(state.lastMessage).toBeNull();
    expect(state.lastInputAt).toBeNull();
    expect(state.lastFingerprint).toBeNull();
    expect(state.hookState).toBeNull();
  });

  it("updates output timestamp only when newer", () => {
    const store = createPaneStateStore();
    const state = store.get("pane-1");
    state.lastOutputAt = "2024-01-02T00:00:00.000Z";
    updateOutputAt(state, "2024-01-01T00:00:00.000Z");
    expect(state.lastOutputAt).toBe("2024-01-02T00:00:00.000Z");
    updateOutputAt(state, "2024-01-03T00:00:00.000Z");
    expect(state.lastOutputAt).toBe("2024-01-03T00:00:00.000Z");
  });

  it("prunes missing panes", () => {
    const store = createPaneStateStore();
    const state = store.get("pane-1");
    state.lastInputAt = "keep";
    store.get("pane-2");
    store.pruneMissing(new Set(["pane-2"]));
    const refreshed = store.get("pane-1");
    expect(refreshed.lastInputAt).toBeNull();
  });
});
