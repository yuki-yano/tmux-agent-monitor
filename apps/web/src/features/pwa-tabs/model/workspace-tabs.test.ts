import { describe, expect, it } from "vitest";

import {
  SYSTEM_SESSIONS_TAB_ID,
  WORKSPACE_TABS_MAX_COUNT,
  activateWorkspaceTab,
  closeAllWorkspaceTabs,
  closeWorkspaceTab,
  createInitialWorkspaceTabsState,
  deserializeWorkspaceTabsState,
  dismissWorkspaceSessionTabByPaneId,
  dismissWorkspaceSessionTabsByPaneIds,
  reorderWorkspaceTabs,
  reorderWorkspaceTabsByClosableOrder,
  serializeWorkspaceTabsState,
  syncWorkspaceTabsWithPathname,
} from "./workspace-tabs";

describe("workspace-tabs model", () => {
  it("adds and activates a session tab from pathname", () => {
    const state = createInitialWorkspaceTabsState(100);
    const next = syncWorkspaceTabsWithPathname(state, "/sessions/pane%201", 200);

    expect(next.activeTabId).toBe("session:pane 1");
    expect(next.tabs.map((tab) => tab.id)).toEqual([SYSTEM_SESSIONS_TAB_ID, "session:pane 1"]);
  });

  it("prunes least recently used closable tabs when max count is exceeded", () => {
    let state = createInitialWorkspaceTabsState(0);
    for (let index = 0; index < WORKSPACE_TABS_MAX_COUNT + 2; index += 1) {
      state = syncWorkspaceTabsWithPathname(state, `/sessions/pane-${index}`, index + 1);
    }

    expect(state.tabs.length).toBe(WORKSPACE_TABS_MAX_COUNT);
    expect(state.tabs.some((tab) => tab.id === SYSTEM_SESSIONS_TAB_ID)).toBe(true);
    expect(state.tabs.some((tab) => tab.id === "session:pane-0")).toBe(false);
  });

  it("falls back to most recently activated tab when active tab is closed", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/b", 2);
    state = activateWorkspaceTab(state, "session:a", 3);

    const closed = closeWorkspaceTab(state, "session:a");
    expect(closed.state.activeTabId).toBe("session:b");
  });

  it("accepts explicit timestamp when ensuring fallback sessions tab on close", () => {
    const closed = closeWorkspaceTab(
      {
        activeTabId: "session:a",
        tabs: [
          {
            id: "session:a",
            kind: "session",
            paneId: "a",
            systemRoute: null,
            closable: true,
            lastActivatedAt: 10,
          },
        ],
      },
      "session:a",
      1234,
    );

    expect(closed.changed).toBe(true);
    expect(closed.state.tabs).toEqual([
      {
        id: SYSTEM_SESSIONS_TAB_ID,
        kind: "system",
        paneId: null,
        systemRoute: "sessions",
        closable: false,
        lastActivatedAt: 1234,
      },
    ]);
  });

  it("closes every closable tab and activates the fixed sessions tab", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);
    state = syncWorkspaceTabsWithPathname(state, "/chat-grid", 2);

    const closed = closeAllWorkspaceTabs(state, 999);

    expect(closed.changed).toBe(true);
    expect(closed.state.activeTabId).toBe(SYSTEM_SESSIONS_TAB_ID);
    expect(closed.state.tabs.map((tab) => tab.id)).toEqual([SYSTEM_SESSIONS_TAB_ID]);
  });

  it("reports no change when there are no closable tabs", () => {
    const state = createInitialWorkspaceTabsState(0);

    const closed = closeAllWorkspaceTabs(state, 999);

    expect(closed.changed).toBe(false);
    expect(closed.state).toBe(state);
  });

  it("restores the fixed Sessions tab when all stored tabs are closable", () => {
    const closed = closeAllWorkspaceTabs(
      {
        activeTabId: "session:a",
        tabs: [
          {
            id: "session:a",
            kind: "session",
            paneId: "a",
            systemRoute: null,
            closable: true,
            lastActivatedAt: 10,
          },
        ],
      },
      999,
    );

    expect(closed.changed).toBe(true);
    expect(closed.state.activeTabId).toBe(SYSTEM_SESSIONS_TAB_ID);
    expect(closed.state.tabs).toEqual([
      {
        id: SYSTEM_SESSIONS_TAB_ID,
        kind: "system",
        paneId: null,
        systemRoute: "sessions",
        closable: false,
        lastActivatedAt: 999,
      },
    ]);
  });

  it("dismisses a session tab by pane id", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/b", 2);

    const dismissed = dismissWorkspaceSessionTabByPaneId(state, "a", 999);
    expect(dismissed.changed).toBe(true);
    expect(dismissed.state.tabs.map((tab) => tab.id)).toEqual([
      SYSTEM_SESSIONS_TAB_ID,
      "session:b",
    ]);
    expect(dismissed.state.activeTabId).toBe("session:b");
  });

  it("dismisses multiple session tabs by pane ids", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/b", 2);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/c", 3);

    const dismissed = dismissWorkspaceSessionTabsByPaneIds(state, ["a", "c"], 999);
    expect(dismissed.changed).toBe(true);
    expect(dismissed.state.tabs.map((tab) => tab.id)).toEqual([
      SYSTEM_SESSIONS_TAB_ID,
      "session:b",
    ]);
    expect(dismissed.state.activeTabId).toBe("session:b");
  });

  it("reports no change when pane ids have no matching session tabs", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);

    const dismissed = dismissWorkspaceSessionTabsByPaneIds(state, ["missing"], 999);
    expect(dismissed.changed).toBe(false);
    expect(dismissed.state).toBe(state);
  });

  it("reorders closable tabs without moving fixed sessions tab", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/b", 2);
    state = syncWorkspaceTabsWithPathname(state, "/chat-grid", 3);

    const reordered = reorderWorkspaceTabs(state, "session:a", "system:chat-grid");
    expect(reordered.tabs.map((tab) => tab.id)).toEqual([
      SYSTEM_SESSIONS_TAB_ID,
      "session:b",
      "system:chat-grid",
      "session:a",
    ]);
  });

  it("applies explicit closable tab order", () => {
    let state = createInitialWorkspaceTabsState(0);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/a", 1);
    state = syncWorkspaceTabsWithPathname(state, "/sessions/b", 2);
    state = syncWorkspaceTabsWithPathname(state, "/chat-grid", 3);

    const reordered = reorderWorkspaceTabsByClosableOrder(state, [
      "system:chat-grid",
      "session:b",
      "session:a",
    ]);
    expect(reordered.tabs.map((tab) => tab.id)).toEqual([
      SYSTEM_SESSIONS_TAB_ID,
      "system:chat-grid",
      "session:b",
      "session:a",
    ]);
  });

  it("serializes and deserializes state safely", () => {
    const source = syncWorkspaceTabsWithPathname(
      createInitialWorkspaceTabsState(0),
      "/sessions/a",
      1,
    );
    const restored = deserializeWorkspaceTabsState(serializeWorkspaceTabsState(source), 10);

    expect(restored).toEqual(source);
    expect(deserializeWorkspaceTabsState("invalid-json", 10)).toBeNull();
  });
});
