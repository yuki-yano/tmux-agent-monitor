import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SESSION_LIST_FILTER,
  isSessionListFilter,
} from "@/features/shared-session-ui/model/session-list-filters";
import { defaultLaunchConfig } from "@/state/launch-agent-options";

import { normalizeSessionListSearchQuery } from "./sessionListSearch";
import { useSessionListVM } from "./useSessionListVM";

const STORAGE_KEY = "vde-monitor-session-list-pins";

const mockUseSessions = vi.hoisted(() => vi.fn());
const mockUseSessionLogs = vi.hoisted(
  () =>
    ({
      quickPanelOpen: false,
      logModalOpen: false,
      selectedPaneId: null as string | null,
      selectedSession: null as SessionSummary | null,
      selectedLogLines: [] as string[],
      selectedLogLoading: false,
      selectedLogError: null as string | null,
      openLogModal: vi.fn<(paneId: string) => void>(),
      closeLogModal: vi.fn<() => void>(),
      toggleQuickPanel: vi.fn<() => void>(),
      closeQuickPanel: vi.fn<() => void>(),
    }) satisfies {
      quickPanelOpen: boolean;
      logModalOpen: boolean;
      selectedPaneId: string | null;
      selectedSession: SessionSummary | null;
      selectedLogLines: string[];
      selectedLogLoading: boolean;
      selectedLogError: string | null;
      openLogModal: (paneId: string) => void;
      closeLogModal: () => void;
      toggleQuickPanel: () => void;
      closeQuickPanel: () => void;
    },
);
const mockUseWorkspaceTabs = vi.hoisted(
  () =>
    ({
      enabled: false as boolean,
      activeTabId: "system:sessions",
      tabs: [],
      openSessionTab: vi.fn<(paneId: string) => void>(),
      activateTab: vi.fn<(tabId: string) => void>(),
      closeTab: vi.fn<(tabId: string) => void>(),
      dismissSessionTab: vi.fn<(paneId: string) => void>(),
      reorderTabs: vi.fn<(activeTabId: string, overTabId: string) => void>(),
      reorderTabsByClosableOrder: vi.fn<(orderedClosableTabIds: string[]) => void>(),
    }) satisfies {
      enabled: boolean;
      activeTabId: string;
      tabs: unknown[];
      openSessionTab: (paneId: string) => void;
      activateTab: (tabId: string) => void;
      closeTab: (tabId: string) => void;
      dismissSessionTab: (paneId: string) => void;
      reorderTabs: (activeTabId: string, overTabId: string) => void;
      reorderTabsByClosableOrder: (orderedClosableTabIds: string[]) => void;
    },
);

vi.mock("@/state/session-context", () => ({
  useSessionStreamData: () => mockUseSessions(),
  useSessionConfigData: () => mockUseSessions(),
  useSessionCoreApi: () => mockUseSessions(),
  useSessionBranchesApi: () => mockUseSessions(),
  useSessionLaunchApi: () => mockUseSessions(),
}));

vi.mock("@/state/theme-context", () => ({
  useTheme: () => ({ resolvedTheme: "latte" }),
}));

vi.mock("@/lib/use-now-ms", () => ({
  useNowMs: () => 0,
}));

vi.mock("@/lib/use-sidebar-width", () => ({
  useSidebarWidth: () => ({
    sidebarWidth: 280,
    handlePointerDown: vi.fn(),
  }),
}));

vi.mock("@/features/shared-session-ui/hooks/useSessionLogs", () => ({
  useSessionLogs: () => mockUseSessionLogs,
}));

vi.mock("@/features/pwa-tabs/context/workspace-tabs-context", () => ({
  useWorkspaceTabs: () => mockUseWorkspaceTabs,
}));

const buildSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  paneId: "pane-1",
  sessionId: "session-id-1",
  sessionName: "session-1",
  windowId: "window-id-1",
  windowIndex: 1,
  paneIndex: 0,
  paneActive: true,
  currentCommand: null,
  currentPath: "/Users/test/repo",
  paneTty: null,
  title: "Session Title",
  customTitle: null,
  repoRoot: "/Users/test/repo",
  agent: "codex",
  state: "RUNNING",
  stateReason: "ok",
  lastMessage: "Hello",
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: new Date(0).toISOString(),
  lastRunStartedAt: null,
  manualSortAt: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
  completion: null,
  ...overrides,
});

const createTestRouter = (initialEntries: string[]) => {
  const rootRoute = createRootRoute({
    component: () => null,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
    validateSearch: (search: Record<string, unknown>) => {
      const filter = isSessionListFilter(search.filter)
        ? search.filter
        : DEFAULT_SESSION_LIST_FILTER;
      const q = normalizeSessionListSearchQuery(search.q);
      if (q.length === 0) {
        return { filter };
      }
      return { filter, q };
    },
  });
  const chatGridRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/chat-grid",
    component: () => null,
    validateSearch: (search: Record<string, unknown>) => {
      const panes = typeof search.panes === "string" ? search.panes : undefined;
      return panes ? { panes } : {};
    },
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, chatGridRoute]),
    history: createMemoryHistory({ initialEntries }),
  });
};

const TestComponent = () => {
  const vm = useSessionListVM();
  return (
    <div>
      <span data-testid="filter">{vm.filter}</span>
      <button type="button" onClick={() => vm.onFilterChange("SHELL")}>
        set-shell
      </button>
      <button type="button" onClick={() => vm.onFilterChange("UNKNOWN")}>
        set-unknown
      </button>
      <button type="button" onClick={() => vm.onFilterChange("EDITOR")}>
        set-editor
      </button>
      <button type="button" onClick={() => vm.onFilterChange("invalid")}>
        set-invalid
      </button>
      <button type="button" onClick={() => vm.onSearchQueryChange("repo")}>
        set-query
      </button>
      <button type="button" onClick={() => vm.onSearchQueryChange("repo backend")}>
        set-query-words
      </button>
      <button type="button" onClick={() => vm.onSearchQueryChange("")}>
        clear-query
      </button>
      <button type="button" onClick={() => vm.onTouchPanePin("pane-test")}>
        touch-pane
      </button>
      <button
        type="button"
        onClick={() =>
          void vm.onLaunchAgentInSession("session-launch", "codex", {
            worktreePath: "/Users/test/repo/.worktree/feature/launch",
            worktreeBranch: "feature/launch",
          })
        }
      >
        launch-agent
      </button>
      <button type="button" onClick={vm.onOpenNewTab}>
        open-new-tab
      </button>
      <button type="button" onClick={() => vm.onOpenPaneInNewWindow("pane direct/2")}>
        open-pane-new-window
      </button>
      <button type="button" onClick={vm.onOpenChatGrid}>
        open-chat-grid
      </button>
      <span data-testid="query">{vm.searchQuery}</span>
      <span data-testid="screen-error">{vm.screenError ?? ""}</span>
      <span data-testid="visible-count">{vm.visibleSessionCount}</span>
      <span data-testid="initial-sessions-loaded">{String(vm.hasLoadedInitialSessions)}</span>
    </div>
  );
};

const renderWithRouter = async (initialEntries: string[] = ["/"]) => {
  const router = createTestRouter(initialEntries);
  await act(async () => {
    await router.load();
  });
  return {
    ...render(
      <RouterContextProvider router={router}>
        <TestComponent />
      </RouterContextProvider>,
    ),
    router,
  };
};

describe("useSessionListVM", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseSessionLogs.quickPanelOpen = false;
    mockUseSessionLogs.logModalOpen = false;
    mockUseSessionLogs.selectedPaneId = null;
    mockUseSessionLogs.selectedSession = null;
    mockUseSessionLogs.selectedLogLines = [];
    mockUseSessionLogs.selectedLogLoading = false;
    mockUseSessionLogs.selectedLogError = null;
    mockUseSessionLogs.openLogModal = vi.fn();
    mockUseSessionLogs.closeLogModal = vi.fn();
    mockUseSessionLogs.toggleQuickPanel = vi.fn();
    mockUseSessionLogs.closeQuickPanel = vi.fn();
    mockUseWorkspaceTabs.enabled = false;
    mockUseWorkspaceTabs.activeTabId = "system:sessions";
    mockUseWorkspaceTabs.tabs = [];
    mockUseWorkspaceTabs.openSessionTab = vi.fn();
    mockUseWorkspaceTabs.activateTab = vi.fn();
    mockUseWorkspaceTabs.closeTab = vi.fn();
    mockUseWorkspaceTabs.dismissSessionTab = vi.fn();
    mockUseWorkspaceTabs.reorderTabs = vi.fn();
    mockUseWorkspaceTabs.reorderTabsByClosableOrder = vi.fn();
    mockUseSessions.mockReturnValue({
      sessions: [],
      connected: true,
      hasLoadedInitialSessions: true,
      connectionStatus: "healthy",
      connectionIssue: null,
      refreshSessions: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
      launchAgentInSession: vi.fn(),
      touchSession: vi.fn(),
      moveSessionToTop: vi.fn(),
      highlightCorrections: { codex: true, claude: true },
      launchConfig: defaultLaunchConfig,
      capabilities: {
        screenImage: true,
        launchAgent: true,
        resumeAgent: true,
      },
    });
  });

  it("reads filter from search params", async () => {
    await renderWithRouter(["/?filter=SHELL"]);
    expect(screen.getByTestId("filter").textContent).toBe("SHELL");
    expect(screen.getByTestId("initial-sessions-loaded").textContent).toBe("true");
  });

  it("defaults to AGENT when search is missing", async () => {
    await renderWithRouter(["/"]);
    expect(screen.getByTestId("filter").textContent).toBe("AGENT");
    expect(screen.getByTestId("query").textContent).toBe("");
  });

  it("updates filter when onFilterChange is called", async () => {
    await renderWithRouter(["/?filter=AGENT"]);
    fireEvent.click(screen.getByRole("button", { name: "set-unknown" }));
    await waitFor(() => {
      expect(screen.getByTestId("filter").textContent).toBe("UNKNOWN");
    });
  });

  it("accepts EDITOR filter value", async () => {
    await renderWithRouter(["/?filter=AGENT"]);
    fireEvent.click(screen.getByRole("button", { name: "set-editor" }));
    await waitFor(() => {
      expect(screen.getByTestId("filter").textContent).toBe("EDITOR");
    });
  });

  it("falls back to default for invalid filter values", async () => {
    await renderWithRouter(["/?filter=SHELL"]);
    fireEvent.click(screen.getByRole("button", { name: "set-invalid" }));
    await waitFor(() => {
      expect(screen.getByTestId("filter").textContent).toBe("AGENT");
    });
  });

  it("reads search query from search params", async () => {
    await renderWithRouter(["/?filter=AGENT&q=backend"]);
    expect(screen.getByTestId("query").textContent).toBe("backend");
  });

  it("updates query when onSearchQueryChange is called", async () => {
    await renderWithRouter(["/?filter=AGENT"]);
    fireEvent.click(screen.getByRole("button", { name: "set-query" }));
    await waitFor(() => {
      expect(screen.getByTestId("query").textContent).toBe("repo");
    });
  });

  it("keeps space-separated query terms", async () => {
    await renderWithRouter(["/?filter=AGENT"]);
    fireEvent.click(screen.getByRole("button", { name: "set-query-words" }));
    await waitFor(() => {
      expect(screen.getByTestId("query").textContent).toBe("repo backend");
    });
  });

  it("filters sessions by search query", async () => {
    const matchSession = buildSession({
      paneId: "pane-match",
      repoRoot: "/Users/test/repo-match",
      title: "Session Match",
      currentPath: "/Users/test/repo-match/apps/server",
      branch: "feature/match",
    });
    const unmatchSession = buildSession({
      paneId: "pane-unmatch",
      repoRoot: "/Users/test/another-repo",
      title: "Other Session",
      currentPath: "/Users/test/another-repo",
      branch: "feature/other",
    });
    mockUseSessions.mockReturnValue({
      sessions: [matchSession, unmatchSession],
      connected: true,
      connectionStatus: "healthy",
      connectionIssue: null,
      refreshSessions: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
      launchAgentInSession: vi.fn(),
      touchSession: vi.fn(),
      highlightCorrections: { codex: true, claude: true },
      launchConfig: defaultLaunchConfig,
    });

    await renderWithRouter(["/?filter=ALL&q=repo-match"]);
    expect(screen.getByTestId("query").textContent).toBe("repo-match");
    expect(screen.getByTestId("visible-count").textContent).toBe("1");
  });

  it("uses moveSessionToTop for pane move action without touching the repo anchor", async () => {
    const moveSessionToTop = vi.fn().mockResolvedValue(undefined);
    const pinnedSession = buildSession({
      paneId: "pane-test",
      repoRoot: "/Users/test/repo-pin-target",
    });
    mockUseSessions.mockReturnValue({
      sessions: [pinnedSession],
      connected: true,
      connectionStatus: "healthy",
      connectionIssue: null,
      refreshSessions: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
      launchAgentInSession: vi.fn(),
      moveSessionToTop,
      highlightCorrections: { codex: true, claude: true },
      launchConfig: defaultLaunchConfig,
    });

    await renderWithRouter(["/"]);
    fireEvent.click(screen.getByRole("button", { name: "touch-pane" }));

    await waitFor(() => {
      expect(moveSessionToTop).toHaveBeenCalledWith("pane-test");
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("launches agent session with worktree options and refreshes sessions", async () => {
    const refreshSessions = vi.fn();
    const launchAgentInSession = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        sessionName: "session-launch",
        agent: "codex",
        windowId: "@9",
        windowIndex: 1,
        windowName: "codex-work",
        paneId: "%9",
        launchedCommand: "codex",
        resolvedOptions: [],
        verification: { status: "verified", observedCommand: "codex", attempts: 1 },
      },
      rollback: { attempted: false, ok: true },
    });

    mockUseSessions.mockReturnValue({
      sessions: [],
      connected: true,
      connectionStatus: "healthy",
      connectionIssue: null,
      refreshSessions,
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
      launchAgentInSession,
      touchSession: vi.fn(),
      highlightCorrections: { codex: true, claude: true },
      launchConfig: defaultLaunchConfig,
    });

    await renderWithRouter(["/"]);
    fireEvent.click(screen.getByRole("button", { name: "launch-agent" }));

    await waitFor(() => {
      expect(launchAgentInSession).toHaveBeenCalledWith(
        "session-launch",
        "codex",
        expect.any(String),
        {
          worktreePath: "/Users/test/repo/.worktree/feature/launch",
          worktreeBranch: "feature/launch",
        },
      );
    });
    await waitFor(() => {
      expect(refreshSessions).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("screen-error").textContent).toBe("");
  });

  it("shows launch error when launchAgentInSession returns error", async () => {
    const launchAgentInSession = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "WEZTERM_UNAVAILABLE", message: "launch-agent requires tmux backend" },
      rollback: { attempted: false, ok: true },
    });

    mockUseSessions.mockReturnValue({
      sessions: [],
      connected: true,
      connectionStatus: "healthy",
      connectionIssue: null,
      refreshSessions: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
      launchAgentInSession,
      touchSession: vi.fn(),
      highlightCorrections: { codex: true, claude: true },
      launchConfig: defaultLaunchConfig,
    });

    await renderWithRouter(["/"]);
    fireEvent.click(screen.getByRole("button", { name: "launch-agent" }));

    await waitFor(() => {
      expect(screen.getByTestId("screen-error").textContent).toBe(
        "launch-agent requires tmux backend",
      );
    });
  });

  it("closes quick panel and log modal before opening selected pane in new tab", async () => {
    const closeQuickPanel = vi.fn();
    const closeLogModal = vi.fn();
    mockUseSessionLogs.selectedPaneId = "pane target/1";
    mockUseSessionLogs.closeQuickPanel = closeQuickPanel;
    mockUseSessionLogs.closeLogModal = closeLogModal;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await renderWithRouter(["/"]);
    fireEvent.click(screen.getByRole("button", { name: "open-new-tab" }));

    expect(closeQuickPanel).toHaveBeenCalledTimes(1);
    expect(closeLogModal).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "/sessions/pane%20target%2F1",
      "_blank",
      "noopener,noreferrer",
    );
    const openOrder = openSpy.mock.invocationCallOrder[0];
    const closeQuickOrder = closeQuickPanel.mock.invocationCallOrder[0];
    const closeLogOrder = closeLogModal.mock.invocationCallOrder[0];
    expect(openOrder).toBeDefined();
    expect(closeQuickOrder).toBeDefined();
    expect(closeLogOrder).toBeDefined();
    if (openOrder == null || closeQuickOrder == null || closeLogOrder == null) {
      throw new Error("missing invocation order");
    }
    expect(closeQuickOrder).toBeLessThan(openOrder);
    expect(closeLogOrder).toBeLessThan(openOrder);
    openSpy.mockRestore();
  });
  it("opens specified pane in new window from quick panel action", async () => {
    const closeQuickPanel = vi.fn();
    const closeLogModal = vi.fn();
    mockUseSessionLogs.closeQuickPanel = closeQuickPanel;
    mockUseSessionLogs.closeLogModal = closeLogModal;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await renderWithRouter(["/"]);
    fireEvent.click(screen.getByRole("button", { name: "open-pane-new-window" }));

    expect(closeQuickPanel).toHaveBeenCalledTimes(1);
    expect(closeLogModal).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "/sessions/pane%20direct%2F2",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("opens workspace tab instead of window when pwa tabs are enabled", async () => {
    const closeQuickPanel = vi.fn();
    const closeLogModal = vi.fn();
    mockUseSessionLogs.selectedPaneId = "pane target/1";
    mockUseSessionLogs.closeQuickPanel = closeQuickPanel;
    mockUseSessionLogs.closeLogModal = closeLogModal;
    mockUseWorkspaceTabs.enabled = true;
    const openSessionTab = vi.fn();
    mockUseWorkspaceTabs.openSessionTab = openSessionTab;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await renderWithRouter(["/"]);
    fireEvent.click(screen.getByRole("button", { name: "open-new-tab" }));

    expect(closeQuickPanel).toHaveBeenCalledTimes(1);
    expect(closeLogModal).toHaveBeenCalledTimes(1);
    expect(openSessionTab).toHaveBeenCalledWith("pane target/1");
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("closes overlays and navigates to chat grid", async () => {
    const closeQuickPanel = vi.fn();
    const closeLogModal = vi.fn();
    mockUseSessionLogs.closeQuickPanel = closeQuickPanel;
    mockUseSessionLogs.closeLogModal = closeLogModal;

    const { router } = await renderWithRouter(["/"]);
    const navigateSpy = vi.spyOn(router, "navigate").mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "open-chat-grid" }));

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: "/chat-grid" }));
    });
    expect(closeQuickPanel).toHaveBeenCalledTimes(1);
    expect(closeLogModal).toHaveBeenCalledTimes(1);
  });
});
