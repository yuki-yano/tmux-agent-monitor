export const WORKSPACE_TABS_STORAGE_KEY = "vde-monitor-workspace-tabs";
export const WORKSPACE_TABS_VERSION = 1;
export const WORKSPACE_TABS_MAX_COUNT = 10;

export const SYSTEM_SESSIONS_TAB_ID = "system:sessions";
export const SYSTEM_CHAT_GRID_TAB_ID = "system:chat-grid";
export const SYSTEM_USAGE_TAB_ID = "system:usage";

type WorkspaceSystemRoute = "sessions" | "chat-grid" | "usage";

export type WorkspaceTab = {
  id: string;
  kind: "system" | "session";
  paneId: string | null;
  systemRoute: WorkspaceSystemRoute | null;
  closable: boolean;
  lastActivatedAt: number;
};

export type WorkspaceTabsState = {
  activeTabId: string;
  tabs: WorkspaceTab[];
};

type PersistedWorkspaceTabs = {
  version: number;
  activeTabId: string;
  tabs: Array<{
    id: string;
    kind: "system" | "session";
    paneId: string | null;
    systemRoute: WorkspaceSystemRoute | null;
    closable: boolean;
    lastActivatedAt: number;
  }>;
};

const isWorkspaceSystemRoute = (value: unknown): value is WorkspaceSystemRoute =>
  value === "sessions" || value === "chat-grid" || value === "usage";

const createSessionsTab = (now: number): WorkspaceTab => ({
  id: SYSTEM_SESSIONS_TAB_ID,
  kind: "system",
  paneId: null,
  systemRoute: "sessions",
  closable: false,
  lastActivatedAt: now,
});

const createChatGridTab = (now: number): WorkspaceTab => ({
  id: SYSTEM_CHAT_GRID_TAB_ID,
  kind: "system",
  paneId: null,
  systemRoute: "chat-grid",
  closable: true,
  lastActivatedAt: now,
});

const createUsageTab = (now: number): WorkspaceTab => ({
  id: SYSTEM_USAGE_TAB_ID,
  kind: "system",
  paneId: null,
  systemRoute: "usage",
  closable: true,
  lastActivatedAt: now,
});

const createSessionTab = (paneId: string, now: number): WorkspaceTab => ({
  id: `session:${paneId}`,
  kind: "session",
  paneId,
  systemRoute: null,
  closable: true,
  lastActivatedAt: now,
});

const decodePaneIdFromPathname = (pathname: string): string | null => {
  if (!pathname.startsWith("/sessions/")) {
    return null;
  }
  const encodedPaneId = pathname.slice("/sessions/".length);
  if (encodedPaneId.trim().length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(encodedPaneId);
  } catch {
    return encodedPaneId;
  }
};

const ensureSessionsTab = (tabs: WorkspaceTab[], now: number) => {
  if (tabs.some((tab) => tab.id === SYSTEM_SESSIONS_TAB_ID)) {
    return tabs;
  }
  return [createSessionsTab(now), ...tabs];
};

const pruneOverflowTabs = (
  tabs: WorkspaceTab[],
  activeTabId: string,
  maxCount: number,
): WorkspaceTab[] => {
  if (tabs.length <= maxCount) {
    return tabs;
  }
  const nextTabs = [...tabs];
  while (nextTabs.length > maxCount) {
    let targetIndex = -1;
    let oldestActivatedAt = Number.POSITIVE_INFINITY;
    nextTabs.forEach((tab, index) => {
      if (!tab.closable || tab.id === activeTabId) {
        return;
      }
      if (tab.lastActivatedAt < oldestActivatedAt) {
        oldestActivatedAt = tab.lastActivatedAt;
        targetIndex = index;
      }
    });
    if (targetIndex < 0) {
      break;
    }
    nextTabs.splice(targetIndex, 1);
  }
  return nextTabs;
};

const normalizeActiveTabId = (tabs: WorkspaceTab[], activeTabId: string): string => {
  if (tabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return tabs.find((tab) => tab.id === SYSTEM_SESSIONS_TAB_ID)?.id ?? tabs[0]?.id ?? activeTabId;
};

export const resolveWorkspaceTabByPathname = (pathname: string, now: number): WorkspaceTab => {
  if (pathname === "/chat-grid") {
    return createChatGridTab(now);
  }
  if (pathname === "/usage") {
    return createUsageTab(now);
  }
  const paneId = decodePaneIdFromPathname(pathname);
  if (paneId != null) {
    return createSessionTab(paneId, now);
  }
  return createSessionsTab(now);
};

export const createInitialWorkspaceTabsState = (now: number): WorkspaceTabsState => {
  const baseTab = createSessionsTab(now);
  return {
    activeTabId: baseTab.id,
    tabs: [baseTab],
  };
};

export const syncWorkspaceTabsWithPathname = (
  state: WorkspaceTabsState,
  pathname: string,
  now: number,
): WorkspaceTabsState => {
  const currentTabs = ensureSessionsTab(state.tabs, now);
  const routeTab = resolveWorkspaceTabByPathname(pathname, now);
  const currentIndex = currentTabs.findIndex((tab) => tab.id === routeTab.id);
  const sameActive = currentIndex >= 0 && state.activeTabId === routeTab.id;
  if (sameActive) {
    if (currentTabs === state.tabs) {
      return state;
    }
    return {
      activeTabId: state.activeTabId,
      tabs: currentTabs,
    };
  }
  if (currentIndex >= 0) {
    const updatedTabs = currentTabs.map((tab, index) =>
      index === currentIndex ? { ...tab, lastActivatedAt: now } : tab,
    );
    if (
      state.activeTabId === routeTab.id &&
      updatedTabs.length === state.tabs.length &&
      updatedTabs.every((tab, index) => tab.id === state.tabs[index]?.id)
    ) {
      return state;
    }
    return {
      activeTabId: routeTab.id,
      tabs: updatedTabs,
    };
  }
  const nextTabs = pruneOverflowTabs(
    [...currentTabs, routeTab],
    routeTab.id,
    WORKSPACE_TABS_MAX_COUNT,
  );
  return {
    activeTabId: routeTab.id,
    tabs: nextTabs,
  };
};

export const activateWorkspaceTab = (
  state: WorkspaceTabsState,
  tabId: string,
  now: number,
): WorkspaceTabsState => {
  const tabs = ensureSessionsTab(state.tabs, now);
  const targetIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (targetIndex < 0) {
    return state;
  }
  const nextTabs = tabs.map((tab, index) =>
    index === targetIndex ? { ...tab, lastActivatedAt: now } : tab,
  );
  if (
    state.activeTabId === tabId &&
    nextTabs.length === state.tabs.length &&
    nextTabs.every(
      (tab, index) =>
        tab.id === state.tabs[index]?.id &&
        tab.lastActivatedAt === state.tabs[index]?.lastActivatedAt,
    )
  ) {
    return state;
  }
  return {
    activeTabId: tabId,
    tabs: nextTabs,
  };
};

export const closeWorkspaceTab = (
  state: WorkspaceTabsState,
  tabId: string,
  now = Date.now(),
): {
  changed: boolean;
  state: WorkspaceTabsState;
} => {
  const targetTab = state.tabs.find((tab) => tab.id === tabId);
  if (!targetTab || !targetTab.closable) {
    return {
      changed: false,
      state,
    };
  }
  const remainingTabs = ensureSessionsTab(
    state.tabs.filter((tab) => tab.id !== tabId),
    now,
  );
  if (remainingTabs.length === 0) {
    return {
      changed: true,
      state: createInitialWorkspaceTabsState(now),
    };
  }
  let activeTabId = state.activeTabId;
  if (activeTabId === tabId) {
    const sortedByRecent = [...remainingTabs].sort(
      (left, right) => right.lastActivatedAt - left.lastActivatedAt,
    );
    activeTabId = sortedByRecent[0]?.id ?? SYSTEM_SESSIONS_TAB_ID;
  }
  activeTabId = normalizeActiveTabId(remainingTabs, activeTabId);
  return {
    changed: true,
    state: {
      activeTabId,
      tabs: remainingTabs,
    },
  };
};

export const closeAllWorkspaceTabs = (
  state: WorkspaceTabsState,
  now = Date.now(),
): {
  changed: boolean;
  state: WorkspaceTabsState;
} => {
  if (!state.tabs.some((tab) => tab.closable)) {
    return {
      changed: false,
      state,
    };
  }
  const remainingTabs = ensureSessionsTab(
    state.tabs.filter((tab) => !tab.closable),
    now,
  );
  return {
    changed: true,
    state: {
      activeTabId: normalizeActiveTabId(remainingTabs, state.activeTabId),
      tabs: remainingTabs,
    },
  };
};

export const dismissWorkspaceSessionTabByPaneId = (
  state: WorkspaceTabsState,
  paneId: string,
  now = Date.now(),
): {
  changed: boolean;
  state: WorkspaceTabsState;
} => {
  const targetTab = state.tabs.find((tab) => tab.kind === "session" && tab.paneId === paneId);
  if (!targetTab) {
    return {
      changed: false,
      state,
    };
  }
  return closeWorkspaceTab(state, targetTab.id, now);
};

export const dismissWorkspaceSessionTabsByPaneIds = (
  state: WorkspaceTabsState,
  paneIds: readonly string[],
  now = Date.now(),
): {
  changed: boolean;
  state: WorkspaceTabsState;
} => {
  let current = state;
  let changed = false;
  paneIds.forEach((paneId) => {
    const dismissed = dismissWorkspaceSessionTabByPaneId(current, paneId, now);
    if (dismissed.changed) {
      changed = true;
      current = dismissed.state;
    }
  });
  return { changed, state: current };
};

const arrayMove = <T>(items: T[], from: number, to: number): T[] => {
  if (from === to) {
    return items;
  }
  const result = [...items];
  const [item] = result.splice(from, 1);
  if (item == null) {
    return items;
  }
  result.splice(to, 0, item);
  return result;
};

export const reorderWorkspaceTabs = (
  state: WorkspaceTabsState,
  activeId: string,
  overId: string,
): WorkspaceTabsState => {
  if (activeId === overId) {
    return state;
  }
  const closableTabs = state.tabs.filter((tab) => tab.closable);
  const fromIndex = closableTabs.findIndex((tab) => tab.id === activeId);
  const toIndex = closableTabs.findIndex((tab) => tab.id === overId);
  if (fromIndex < 0 || toIndex < 0) {
    return state;
  }
  const reorderedClosableTabs = arrayMove(closableTabs, fromIndex, toIndex);
  const fixedTabs = state.tabs.filter((tab) => !tab.closable);
  const nextTabs = [...fixedTabs, ...reorderedClosableTabs];
  if (
    nextTabs.length === state.tabs.length &&
    nextTabs.every((tab, index) => tab.id === state.tabs[index]?.id)
  ) {
    return state;
  }
  return {
    activeTabId: normalizeActiveTabId(nextTabs, state.activeTabId),
    tabs: nextTabs,
  };
};

export const reorderWorkspaceTabsByClosableOrder = (
  state: WorkspaceTabsState,
  orderedClosableTabIds: string[],
): WorkspaceTabsState => {
  const closableTabs = state.tabs.filter((tab) => tab.closable);
  if (closableTabs.length !== orderedClosableTabIds.length) {
    return state;
  }
  const closableTabById = new Map(closableTabs.map((tab) => [tab.id, tab]));
  if (
    new Set(orderedClosableTabIds).size !== orderedClosableTabIds.length ||
    orderedClosableTabIds.some((tabId) => !closableTabById.has(tabId))
  ) {
    return state;
  }
  const reorderedClosableTabs = orderedClosableTabIds
    .map((tabId) => closableTabById.get(tabId))
    .filter((tab): tab is WorkspaceTab => tab != null);
  if (reorderedClosableTabs.length !== closableTabs.length) {
    return state;
  }
  const fixedTabs = state.tabs.filter((tab) => !tab.closable);
  const nextTabs = [...fixedTabs, ...reorderedClosableTabs];
  if (
    nextTabs.length === state.tabs.length &&
    nextTabs.every((tab, index) => tab.id === state.tabs[index]?.id)
  ) {
    return state;
  }
  return {
    activeTabId: normalizeActiveTabId(nextTabs, state.activeTabId),
    tabs: nextTabs,
  };
};

const isPersistedWorkspaceTab = (
  value: unknown,
): value is PersistedWorkspaceTabs["tabs"][number] => {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const tab = value as Record<string, unknown>;
  if (typeof tab.id !== "string" || tab.id.trim().length === 0) {
    return false;
  }
  if (tab.kind !== "system" && tab.kind !== "session") {
    return false;
  }
  if (!(typeof tab.paneId === "string" || tab.paneId == null)) {
    return false;
  }
  if (!(isWorkspaceSystemRoute(tab.systemRoute) || tab.systemRoute == null)) {
    return false;
  }
  if (typeof tab.closable !== "boolean") {
    return false;
  }
  if (typeof tab.lastActivatedAt !== "number" || !Number.isFinite(tab.lastActivatedAt)) {
    return false;
  }
  if (tab.kind === "session" && typeof tab.paneId !== "string") {
    return false;
  }
  return true;
};

const normalizeLoadedTabs = (tabs: WorkspaceTab[], activeTabId: string, now: number) => {
  const dedupedTabs: WorkspaceTab[] = [];
  const seen = new Set<string>();
  tabs.forEach((tab) => {
    if (seen.has(tab.id)) {
      return;
    }
    seen.add(tab.id);
    dedupedTabs.push(tab);
  });
  const withSessions = ensureSessionsTab(dedupedTabs, now);
  const pruned = pruneOverflowTabs(withSessions, activeTabId, WORKSPACE_TABS_MAX_COUNT);
  const normalizedActive = normalizeActiveTabId(pruned, activeTabId);
  return {
    activeTabId: normalizedActive,
    tabs: pruned,
  };
};

export const serializeWorkspaceTabsState = (state: WorkspaceTabsState): string =>
  JSON.stringify({
    version: WORKSPACE_TABS_VERSION,
    activeTabId: state.activeTabId,
    tabs: state.tabs,
  } satisfies PersistedWorkspaceTabs);

export const deserializeWorkspaceTabsState = (
  raw: string | null,
  now: number,
): WorkspaceTabsState | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed == null) {
      return null;
    }
    const candidate = parsed as Partial<PersistedWorkspaceTabs>;
    if (candidate.version !== WORKSPACE_TABS_VERSION) {
      return null;
    }
    if (typeof candidate.activeTabId !== "string") {
      return null;
    }
    if (!Array.isArray(candidate.tabs)) {
      return null;
    }
    const tabs = candidate.tabs.filter(isPersistedWorkspaceTab);
    if (tabs.length === 0) {
      return createInitialWorkspaceTabsState(now);
    }
    return normalizeLoadedTabs(tabs, candidate.activeTabId, now);
  } catch {
    return null;
  }
};

export const resolveWorkspaceTabPath = (tab: WorkspaceTab): string => {
  if (tab.id === SYSTEM_CHAT_GRID_TAB_ID) {
    return "/chat-grid";
  }
  if (tab.id === SYSTEM_USAGE_TAB_ID) {
    return "/usage";
  }
  if (tab.kind === "session" && tab.paneId != null) {
    return `/sessions/${encodeURIComponent(tab.paneId)}`;
  }
  return "/";
};
