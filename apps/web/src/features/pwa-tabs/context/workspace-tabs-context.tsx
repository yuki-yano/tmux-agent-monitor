import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { WorkspaceTabsDisplayMode } from "@vde-monitor/shared";
import { useAtomValue } from "jotai";
import {
  type PropsWithChildren,
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { PWA_DISPLAY_MODE_QUERIES, isPwaDisplayMode } from "@/lib/pwa-display-mode";
import { useLazyRef } from "@/lib/use-lazy-ref";
import { useSessionStreamData } from "@/state/session-context";
import { sessionWorkspaceTabsDisplayModeAtom } from "@/state/session-state-atoms";

import {
  SYSTEM_CHAT_GRID_TAB_ID,
  SYSTEM_USAGE_TAB_ID,
  WORKSPACE_TABS_STORAGE_KEY,
  type WorkspaceTab,
  type WorkspaceTabsState,
  activateWorkspaceTab,
  closeAllWorkspaceTabs,
  closeWorkspaceTab,
  createInitialWorkspaceTabsState,
  deserializeWorkspaceTabsState,
  dismissWorkspaceSessionTabsByPaneIds,
  reorderWorkspaceTabs,
  reorderWorkspaceTabsByClosableOrder,
  resolveWorkspaceTabPath,
  serializeWorkspaceTabsState,
  syncWorkspaceTabsWithPathname,
} from "../model/workspace-tabs";
import {
  WORKSPACE_TABS_MOBILE_MEDIA_QUERY,
  isWorkspaceTabsMobileViewport,
  resolveWorkspaceTabsEnabled,
} from "../model/workspace-tabs-visibility";

type WorkspaceTabsContextValue = {
  enabled: boolean;
  activeTabId: string;
  tabs: WorkspaceTab[];
  openSessionTab: (paneId: string) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeAllTabs: () => void;
  dismissSessionTab: (paneId: string) => void;
  reorderTabs: (activeTabId: string, overTabId: string) => void;
  reorderTabsByClosableOrder: (orderedClosableTabIds: string[]) => void;
};

const WorkspaceTabsContext = createContext<WorkspaceTabsContextValue | null>(null);
const WORKSPACE_TABS_FALLBACK: WorkspaceTabsContextValue = {
  enabled: false,
  activeTabId: "system:sessions",
  tabs: [],
  openSessionTab: () => undefined,
  activateTab: () => undefined,
  closeTab: () => undefined,
  closeAllTabs: () => undefined,
  dismissSessionTab: () => undefined,
  reorderTabs: () => undefined,
  reorderTabsByClosableOrder: () => undefined,
};

// Grace period before auto-closing a tab whose pane is missing from the live
// session list: a freshly launched pane can take a moment to show up there.
const MISSING_PANE_TAB_DISMISS_GRACE_MS = 5000;

const subscribeToDisplayEnvironment = (update: () => void) => {
  const mediaList = [...PWA_DISPLAY_MODE_QUERIES, WORKSPACE_TABS_MOBILE_MEDIA_QUERY]
    .map((query) => window.matchMedia?.(query))
    .filter((candidate): candidate is MediaQueryList => candidate != null);
  mediaList.forEach((media) => {
    media.addEventListener("change", update);
  });
  window.addEventListener("pageshow", update);
  window.addEventListener("focus", update);
  return () => {
    mediaList.forEach((media) => {
      media.removeEventListener("change", update);
    });
    window.removeEventListener("pageshow", update);
    window.removeEventListener("focus", update);
  };
};

type WorkspaceTabsTransition = {
  state: WorkspaceTabsState;
  navigationTarget: WorkspaceTab | null;
};

const withoutNavigation = (state: WorkspaceTabsState): WorkspaceTabsTransition => ({
  state,
  navigationTarget: null,
});

const resolveActivateTabTransition = (
  state: WorkspaceTabsState,
  tabId: string,
  now: number,
): WorkspaceTabsTransition => {
  const targetTab = state.tabs.find((tab) => tab.id === tabId) ?? null;
  if (targetTab == null) return withoutNavigation(state);
  return {
    state: activateWorkspaceTab(state, tabId, now),
    navigationTarget: targetTab,
  };
};

const resolveCloseTabTransition = (
  state: WorkspaceTabsState,
  tabId: string,
  pathname: string,
  now: number,
): WorkspaceTabsTransition => {
  const closed = closeWorkspaceTab(state, tabId, now);
  if (!closed.changed) return withoutNavigation(state);
  const navigationTarget =
    state.activeTabId === tabId
      ? (closed.state.tabs.find((tab) => tab.id === closed.state.activeTabId) ??
        closed.state.tabs.find((tab) => resolveWorkspaceTabPath(tab) === pathname) ??
        null)
      : null;
  return { state: closed.state, navigationTarget };
};

const resolveDismissSessionTabsTransition = (
  state: WorkspaceTabsState,
  paneIds: readonly string[],
  now: number,
): WorkspaceTabsTransition => {
  const dismissed = dismissWorkspaceSessionTabsByPaneIds(state, paneIds, now);
  if (!dismissed.changed) return withoutNavigation(state);
  const navigationTarget =
    dismissed.state.activeTabId === state.activeTabId
      ? null
      : (dismissed.state.tabs.find((tab) => tab.id === dismissed.state.activeTabId) ?? null);
  return { state: dismissed.state, navigationTarget };
};

const resolveCloseAllTabsTransition = (
  state: WorkspaceTabsState,
  now: number,
): WorkspaceTabsTransition => {
  const closed = closeAllWorkspaceTabs(state, now);
  if (!closed.changed) return withoutNavigation(state);
  const navigationTarget =
    closed.state.activeTabId === state.activeTabId
      ? null
      : (closed.state.tabs.find((tab) => tab.id === closed.state.activeTabId) ?? null);
  return { state: closed.state, navigationTarget };
};

// The explicit resume flow has already selected and navigated to its target.
// Dismiss only the source tabs so that transition cannot replace that target.
const resolvePostNavigationDismissSessionTabsTransition = (
  state: WorkspaceTabsState,
  paneIds: readonly string[],
  now: number,
): WorkspaceTabsTransition => {
  const dismissed = dismissWorkspaceSessionTabsByPaneIds(state, paneIds, now);
  return withoutNavigation(dismissed.changed ? dismissed.state : state);
};

const buildInitialState = (displayMode: WorkspaceTabsDisplayMode): WorkspaceTabsState => {
  const now = Date.now();
  if (typeof window === "undefined") {
    return createInitialWorkspaceTabsState(now);
  }
  if (
    !resolveWorkspaceTabsEnabled({
      displayMode,
      pwaDisplayMode: isPwaDisplayMode(),
      mobileViewport: isWorkspaceTabsMobileViewport(),
    })
  ) {
    return createInitialWorkspaceTabsState(now);
  }
  return (
    deserializeWorkspaceTabsState(window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY), now) ??
    createInitialWorkspaceTabsState(now)
  );
};

const useDismissMissingWorkspaceSessionTabs = ({
  enabled,
  connected,
  tabs,
  livePaneIds,
  dismissSessionTabsByPaneIds,
}: {
  enabled: boolean;
  connected: boolean;
  tabs: WorkspaceTab[];
  livePaneIds: Set<string>;
  dismissSessionTabsByPaneIds: (paneIds: string[]) => void;
}) => {
  const [missingPaneCheckTick, setMissingPaneCheckTick] = useState(0);
  const missingPaneSinceRef = useLazyRef(() => new Map<string, number>());

  // Auto-close session tabs whose pane no longer exists (e.g. the pane was
  // killed while the PWA was closed). Panes must stay missing for the grace
  // period before their tabs are dismissed.
  useEffect(() => {
    const missingSince = missingPaneSinceRef.current;
    if (!enabled || !connected) {
      missingSince.clear();
      return;
    }
    const missingPaneIds = tabs
      .filter(
        (tab): tab is WorkspaceTab & { paneId: string } =>
          tab.kind === "session" &&
          tab.closable &&
          tab.paneId != null &&
          !livePaneIds.has(tab.paneId),
      )
      .map((tab) => tab.paneId);
    const missingPaneIdSet = new Set(missingPaneIds);
    [...missingSince.keys()].forEach((paneId) => {
      if (!missingPaneIdSet.has(paneId)) {
        missingSince.delete(paneId);
      }
    });
    if (missingPaneIds.length === 0) {
      return;
    }
    const now = Date.now();
    missingPaneIds.forEach((paneId) => {
      if (!missingSince.has(paneId)) {
        missingSince.set(paneId, now);
      }
    });
    const expiredPaneIds = missingPaneIds.filter(
      (paneId) => now - (missingSince.get(paneId) ?? now) >= MISSING_PANE_TAB_DISMISS_GRACE_MS,
    );
    if (expiredPaneIds.length > 0) {
      expiredPaneIds.forEach((paneId) => {
        missingSince.delete(paneId);
      });
      dismissSessionTabsByPaneIds(expiredPaneIds);
      return;
    }
    const earliestMissingAt = Math.min(
      ...missingPaneIds.map((paneId) => missingSince.get(paneId) ?? now),
    );
    const timer = window.setTimeout(
      () => {
        setMissingPaneCheckTick((tick) => tick + 1);
      },
      Math.max(earliestMissingAt + MISSING_PANE_TAB_DISMISS_GRACE_MS - now, 0) + 50,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    connected,
    dismissSessionTabsByPaneIds,
    enabled,
    livePaneIds,
    missingPaneCheckTick,
    missingPaneSinceRef,
    tabs,
  ]);
};

export const WorkspaceTabsProvider = ({ children }: PropsWithChildren) => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const workspaceTabsDisplayMode = useAtomValue(sessionWorkspaceTabsDisplayModeAtom);
  const [displayEnvironmentVersion, bumpDisplayEnvironmentVersion] = useReducer(
    (version: number) => version + 1,
    0,
  );
  const enabled = useMemo(() => {
    void displayEnvironmentVersion;
    return resolveWorkspaceTabsEnabled({
      displayMode: workspaceTabsDisplayMode,
      pwaDisplayMode: isPwaDisplayMode(),
      mobileViewport: isWorkspaceTabsMobileViewport(),
    });
  }, [displayEnvironmentVersion, workspaceTabsDisplayMode]);
  const [tabsState, setTabsState] = useState<WorkspaceTabsState>(() =>
    buildInitialState(workspaceTabsDisplayMode),
  );
  const tabsStateRef = useRef(tabsState);
  const { sessions, connected } = useSessionStreamData();
  const livePaneIds = useMemo(() => new Set(sessions.map((session) => session.paneId)), [sessions]);

  const navigateToWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      if (tab.kind === "session" && tab.paneId != null) {
        void navigate({
          to: "/sessions/$paneId",
          params: { paneId: tab.paneId },
        });
        return;
      }
      if (tab.id === SYSTEM_CHAT_GRID_TAB_ID) {
        void navigate({ to: "/chat-grid" });
        return;
      }
      if (tab.id === SYSTEM_USAGE_TAB_ID) {
        void navigate({ to: "/usage" });
        return;
      }
      void navigate({ href: "/" });
    },
    [navigate],
  );

  const applyTabsTransition = useCallback(
    (transition: (previous: WorkspaceTabsState) => WorkspaceTabsTransition) => {
      const previous = tabsStateRef.current;
      const result = transition(previous);
      if (result.state !== previous) {
        tabsStateRef.current = result.state;
        setTabsState(result.state);
      }
      if (result.navigationTarget != null) {
        navigateToWorkspaceTab(result.navigationTarget);
      }
    },
    [navigateToWorkspaceTab],
  );

  useEffect(() => {
    const update = () => bumpDisplayEnvironmentVersion();
    return subscribeToDisplayEnvironment(update);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    applyTabsTransition((previous) =>
      withoutNavigation(syncWorkspaceTabsWithPathname(previous, pathname, Date.now())),
    );
  }, [applyTabsTransition, enabled, pathname]);

  // False positive: this effect persists the tab state to localStorage, an
  // external system. Moving it into setState updaters would risk duplicate
  // writes under StrictMode and spread persistence across every tab action.
  // react-doctor-disable-next-line no-effect-chain
  useEffect(() => {
    if (!enabled) {
      return;
    }
    window.localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, serializeWorkspaceTabsState(tabsState));
  }, [enabled, tabsState]);

  const dismissSessionTabsByPaneIds = useCallback(
    (paneIds: string[]) => {
      applyTabsTransition((previous) =>
        resolveDismissSessionTabsTransition(previous, paneIds, Date.now()),
      );
    },
    [applyTabsTransition],
  );

  useDismissMissingWorkspaceSessionTabs({
    enabled,
    connected,
    tabs: tabsState.tabs,
    livePaneIds,
    dismissSessionTabsByPaneIds,
  });

  const openSessionTab = useCallback(
    (paneId: string) => {
      if (!enabled) {
        return;
      }
      const normalizedPaneId = paneId.trim();
      if (normalizedPaneId.length === 0) {
        return;
      }
      void navigate({
        to: "/sessions/$paneId",
        params: { paneId: normalizedPaneId },
      });
    },
    [enabled, navigate],
  );

  const activateTab = useCallback(
    (tabId: string) => {
      if (!enabled) {
        return;
      }
      applyTabsTransition((previous) => resolveActivateTabTransition(previous, tabId, Date.now()));
    },
    [applyTabsTransition, enabled],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      if (!enabled) {
        return;
      }
      applyTabsTransition((previous) =>
        resolveCloseTabTransition(previous, tabId, pathname, Date.now()),
      );
    },
    [applyTabsTransition, enabled, pathname],
  );

  const closeAllTabs = useCallback(() => {
    if (!enabled) {
      return;
    }
    applyTabsTransition((previous) => resolveCloseAllTabsTransition(previous, Date.now()));
  }, [applyTabsTransition, enabled]);

  const dismissSessionTab = useCallback(
    (paneId: string) => {
      if (!enabled) {
        return;
      }
      const normalizedPaneId = paneId.trim();
      if (normalizedPaneId.length === 0) {
        return;
      }
      applyTabsTransition((previous) =>
        resolvePostNavigationDismissSessionTabsTransition(previous, [normalizedPaneId], Date.now()),
      );
    },
    [applyTabsTransition, enabled],
  );

  const reorderTabs = useCallback(
    (activeTabId: string, overTabId: string) => {
      if (!enabled) {
        return;
      }
      applyTabsTransition((previous) =>
        withoutNavigation(reorderWorkspaceTabs(previous, activeTabId, overTabId)),
      );
    },
    [applyTabsTransition, enabled],
  );

  const reorderTabsByClosableOrder = useCallback(
    (orderedClosableTabIds: string[]) => {
      if (!enabled) {
        return;
      }
      applyTabsTransition((previous) =>
        withoutNavigation(reorderWorkspaceTabsByClosableOrder(previous, orderedClosableTabIds)),
      );
    },
    [applyTabsTransition, enabled],
  );

  const value = useMemo<WorkspaceTabsContextValue>(
    () => ({
      enabled,
      activeTabId: tabsState.activeTabId,
      tabs: tabsState.tabs,
      openSessionTab,
      activateTab,
      closeTab,
      closeAllTabs,
      dismissSessionTab,
      reorderTabs,
      reorderTabsByClosableOrder,
    }),
    [
      activateTab,
      closeAllTabs,
      closeTab,
      dismissSessionTab,
      enabled,
      openSessionTab,
      reorderTabs,
      reorderTabsByClosableOrder,
      tabsState,
    ],
  );

  return <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>;
};

export const useWorkspaceTabs = () => {
  const context = use(WorkspaceTabsContext);
  return context ?? WORKSPACE_TABS_FALLBACK;
};
