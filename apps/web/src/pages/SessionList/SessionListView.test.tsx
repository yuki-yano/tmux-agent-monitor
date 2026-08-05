import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSessionGroups } from "@/lib/session-group";
import { defaultLaunchConfig } from "@/state/launch-agent-options";

import type { SessionListViewProps } from "./SessionListView";
import { SessionListView } from "./SessionListView";

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock("@/features/shared-session-ui/components/SessionSidebar", () => ({
  SessionSidebar: ({
    state,
    actions,
  }: {
    state: { sessionGroups: unknown[] };
    actions: {
      onFocusPane?: (paneId: string) => Promise<void> | void;
      onLaunchAgentInSession?: (
        sessionName: string,
        agent: "codex" | "claude",
        options?: {
          worktreePath?: string;
          worktreeBranch?: string;
        },
      ) => Promise<void> | void;
      onTouchSession?: (paneId: string) => void;
      onTouchRepoPin?: (repoRoot: string | null) => void;
    };
  }) => (
    <div data-testid="session-sidebar" data-count={state.sessionGroups.length}>
      <button type="button" onClick={() => actions.onFocusPane?.("pane-sidebar-open")}>
        sidebar-open
      </button>
      <button type="button" onClick={() => actions.onTouchSession?.("pane-sidebar-pin")}>
        sidebar-pin-pane
      </button>
      <button type="button" onClick={() => actions.onTouchRepoPin?.("/Users/test/sidebar-repo")}>
        sidebar-pin-repo
      </button>
      <button
        type="button"
        onClick={() =>
          actions.onLaunchAgentInSession?.("sidebar-session", "claude", {
            worktreePath: "/Users/test/sidebar-repo/.worktree/feature/sidebar",
            worktreeBranch: "feature/sidebar",
          })
        }
      >
        sidebar-launch
      </button>
    </div>
  ),
}));

vi.mock("@/features/shared-session-ui/components/QuickPanel", () => ({
  QuickPanel: ({
    state,
    actions,
  }: {
    state: { open: boolean };
    actions: {
      onOpenLogModal: (paneId: string) => void;
      onOpenSessionLink: (paneId: string) => void;
      onOpenSessionLinkInNewWindow: (paneId: string) => void;
      onToggle: () => void;
    };
  }) => (
    <div data-testid="quick-panel" data-open={String(state.open)}>
      <button type="button" onClick={() => actions.onOpenLogModal("pane-quick")}>
        open-log
      </button>
      <button type="button" onClick={() => actions.onOpenSessionLink("pane-quick-link")}>
        open-link
      </button>
      <button
        type="button"
        onClick={() => actions.onOpenSessionLinkInNewWindow("pane-quick-link-new")}
      >
        open-link-new-window
      </button>
      <button type="button" onClick={actions.onToggle}>
        toggle-panel
      </button>
    </div>
  ),
}));

vi.mock("@/features/shared-session-ui/components/LogModal", () => ({
  LogModal: ({ actions }: { actions: { onOpenHere: () => void; onOpenNewTab: () => void } }) => (
    <div data-testid="log-modal">
      <button type="button" onClick={actions.onOpenHere}>
        open-here
      </button>
      <button type="button" onClick={actions.onOpenNewTab}>
        open-new-tab
      </button>
    </div>
  ),
}));

vi.mock("@/features/launch-agent/LaunchAgentButton", () => ({
  LaunchAgentButton: ({
    sessionName,
    sourceSession,
    onLaunchAgentInSession,
  }: {
    sessionName: string;
    sourceSession?: SessionSummary;
    onLaunchAgentInSession: (
      sessionName: string,
      agent: "codex" | "claude",
      options?: { worktreePath?: string; worktreeBranch?: string; cwd?: string },
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        const hasWorktree = Boolean(sourceSession?.worktreePath?.includes(".worktree"));
        onLaunchAgentInSession(
          sessionName,
          "codex",
          hasWorktree
            ? {
                worktreePath: sourceSession?.worktreePath ?? undefined,
                worktreeBranch: sourceSession?.branch ?? undefined,
              }
            : {
                cwd: sourceSession?.repoRoot ?? undefined,
              },
        );
      }}
    >
      Launch Agent
    </button>
  ),
}));

const renderWithRouter = (ui: ReactNode) => {
  const rootRoute = createRootRoute({
    component: () => null,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterContextProvider router={router}>{ui}</RouterContextProvider>);
};

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

const filterValues = ["ALL", "AGENT", "EDITOR", "SHELL", "UNKNOWN"] as const;

const filterOptions = filterValues.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

const createViewProps = (overrides: Partial<SessionListViewProps> = {}): SessionListViewProps => {
  const sessions = overrides.sessions ?? [];
  const groups = overrides.groups ?? buildSessionGroups(sessions);
  const sidebarSessionGroups = overrides.sidebarSessionGroups ?? buildSessionGroups(sessions);
  const quickPanelGroups = overrides.quickPanelGroups ?? buildSessionGroups(sessions);
  const visibleSessionCount = overrides.visibleSessionCount ?? sessions.length;
  return {
    sessions,
    groups,
    sidebarSessionGroups,
    visibleSessionCount,
    quickPanelGroups,
    filter: "AGENT",
    searchQuery: "",
    filterOptions,
    connected: true,
    hasLoadedInitialSessions: true,
    connectionStatus: "healthy",
    connectionIssue: null,
    transport: "polling" as const,
    requestStateTimeline: vi.fn(),
    requestScreen: vi.fn(),
    requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
    highlightCorrections: { codex: true, claude: true },
    launchConfig: defaultLaunchConfig,
    capabilities: {
      screenImage: true,
      launchAgent: true,
      resumeAgent: true,
    },
    resolvedTheme: "latte",
    nowMs: Date.now(),
    sidebarWidth: 280,
    onFilterChange: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onRefresh: vi.fn(),
    onOpenChatGrid: vi.fn(),
    onOpenUsage: vi.fn(),
    onSidebarResizeStart: vi.fn(),
    quickPanelOpen: false,
    logModalOpen: false,
    selectedSession: null,
    selectedLogLines: [],
    selectedLogLoading: false,
    selectedLogError: null,
    onOpenLogModal: vi.fn(),
    onCloseLogModal: vi.fn(),
    onToggleQuickPanel: vi.fn(),
    onCloseQuickPanel: vi.fn(),
    onOpenPaneHere: vi.fn(),
    onOpenPaneInNewWindow: vi.fn(),
    onOpenHere: vi.fn(),
    onOpenNewTab: vi.fn(),
    screenError: null,
    launchPendingSessions: new Set<string>(),
    onLaunchAgentInSession: vi.fn(),
    onTouchRepoPin: vi.fn(),
    onTouchPanePin: vi.fn(),
    ...overrides,
  };
};

describe("SessionListView", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders empty state when no sessions", () => {
    const props = createViewProps({
      sessions: [],
      groups: [],
      visibleSessionCount: 0,
      quickPanelGroups: [],
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("No Active Sessions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check Again" }));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("renders loading state while discovering sessions", () => {
    const props = createViewProps({
      sessions: [],
      groups: [],
      visibleSessionCount: 0,
      quickPanelGroups: [],
      connected: false,
      hasLoadedInitialSessions: false,
      connectionStatus: "degraded",
      connectionIssue: null,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("Loading Sessions...")).toBeTruthy();
    const status = screen.getByRole("status");
    const content = screen.getByTestId("session-list-content");
    const skeleton = screen.getByTestId("session-list-loading-skeleton");
    expect(content.getAttribute("aria-busy")).toBe("true");
    expect(content.contains(status)).toBe(false);
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    expect(
      screen.queryByText("Checking tmux sessions in the background. This should finish shortly."),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "Live Sessions" })).toBeTruthy();
    expect(screen.queryByText("No Active Sessions")).toBeNull();
  });

  it("keeps the empty state after the initial load when the connection degrades", () => {
    const props = createViewProps({
      sessions: [],
      groups: [],
      visibleSessionCount: 0,
      quickPanelGroups: [],
      connected: false,
      hasLoadedInitialSessions: true,
      connectionStatus: "degraded",
      connectionIssue: null,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.queryByTestId("session-list-loading-skeleton")).toBeNull();
    expect(screen.getByTestId("session-list-content").getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("No Active Sessions")).toBeTruthy();
  });

  it("keeps loading after SSE opens until the initial snapshot arrives", () => {
    const props = createViewProps({
      sessions: [],
      groups: [],
      visibleSessionCount: 0,
      quickPanelGroups: [],
      connected: true,
      hasLoadedInitialSessions: false,
      connectionStatus: "healthy",
      connectionIssue: null,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByTestId("session-list-loading-skeleton")).toBeTruthy();
    expect(screen.queryByText("No Active Sessions")).toBeNull();
  });

  it("renders empty filter state when sessions exist but no groups", () => {
    const session = buildSession();
    const onFilterChange = vi.fn();
    const props = createViewProps({
      sessions: [session],
      groups: [],
      visibleSessionCount: 0,
      onFilterChange,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("No Matching Sessions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show All Sessions" }));
    expect(onFilterChange).toHaveBeenCalledWith("ALL");
  });

  it("renders clear search action when no results with search query", () => {
    const session = buildSession();
    const onSearchQueryChange = vi.fn();
    const props = createViewProps({
      sessions: [session],
      groups: [],
      visibleSessionCount: 0,
      searchQuery: "repo",
      onSearchQueryChange,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("No Matching Sessions")).toBeTruthy();
    expect(
      screen.getByText("No sessions match the current search query. Try a different query."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear Search" }));
    expect(onSearchQueryChange).toHaveBeenCalledWith("");
  });

  it("keeps connection status on the second mobile row and moves actions beside the title", () => {
    renderWithRouter(<SessionListView {...createViewProps()} />);

    const actions = screen.getByRole("toolbar", { name: "Session list actions" });
    const statusRow = screen.getByText("Connected").parentElement?.parentElement;

    expect(actions.className).toContain("col-start-2");
    expect(actions.className).toContain("row-start-1");
    expect(actions.className).toContain("sm:row-auto");
    expect(statusRow?.className).toContain("col-span-2");
    expect(statusRow?.className).toContain("row-start-2");
    expect(statusRow?.className).toContain("sm:row-auto");
  });

  it("calls refresh when refresh button is clicked", () => {
    const onRefresh = vi.fn();
    const props = createViewProps({ connectionStatus: "healthy", onRefresh });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("calls onOpenChatGrid when chat grid button is clicked", () => {
    const onOpenChatGrid = vi.fn();
    const props = createViewProps({ onOpenChatGrid });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Chat Grid" }));
    expect(onOpenChatGrid).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenUsage when usage button is clicked", () => {
    const onOpenUsage = vi.fn();
    const props = createViewProps({ onOpenUsage });
    renderWithRouter(<SessionListView {...props} />);

    const usageButton = screen.getAllByRole("button", { name: "Usage" })[0]!;
    fireEvent.click(usageButton);
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it("calls onFilterChange when filter button is clicked", () => {
    const onFilterChange = vi.fn();
    const props = createViewProps({ onFilterChange });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "SHELL" }));
    expect(onFilterChange).toHaveBeenCalledWith("SHELL");
  });

  it("calls onSearchQueryChange with debounce when typing in search input", () => {
    vi.useFakeTimers();
    const onSearchQueryChange = vi.fn();
    const props = createViewProps({ onSearchQueryChange });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "repo" },
    });

    expect(onSearchQueryChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(onSearchQueryChange).toHaveBeenCalledWith("repo");
  });

  it("includes scope filter buttons", () => {
    const props = createViewProps();
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByRole("button", { name: "AGENT" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SHELL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "UNKNOWN" })).toBeTruthy();
  });

  it("renders window group and session card", () => {
    const session = buildSession({
      customTitle: "Custom Session",
    });
    const props = createViewProps({ sessions: [session] });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getAllByText("Window 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Custom Session")).toBeTruthy();
    const cardLink = screen.getByText("Custom Session").closest("a");
    expect(cardLink).toBeTruthy();
    if (!cardLink) return;
    const cardScope = within(cardLink);
    expect(cardScope.getByText("RUNNING")).toBeTruthy();
    expect(cardScope.getByText("CODEX")).toBeTruthy();
  });

  it("calls onLaunchAgentInSession from session section launch button", () => {
    const session = buildSession({
      sessionName: "launch-target",
      worktreePath: "/Users/test/repo/.worktree/feature/a",
      branch: "feature/a",
    });
    const onLaunchAgentInSession = vi.fn();
    const props = createViewProps({
      sessions: [session],
      onLaunchAgentInSession,
    });

    renderWithRouter(<SessionListView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Launch Agent" }));

    expect(onLaunchAgentInSession).toHaveBeenCalledWith("launch-target", "codex", {
      worktreePath: "/Users/test/repo/.worktree/feature/a",
      worktreeBranch: "feature/a",
    });
  });

  it("hides session launch controls when the backend does not support launching agents", () => {
    const props = createViewProps({
      sessions: [buildSession({ sessionName: "launch-target" })],
      capabilities: {
        screenImage: false,
        launchAgent: false,
        resumeAgent: false,
      },
    });

    renderWithRouter(<SessionListView {...props} />);

    expect(screen.queryByRole("button", { name: "Launch Agent" })).toBeNull();
  });

  it("prefers repo root pane for launch options even when another pane is vw worktree", () => {
    const activeNonWorktreePane = buildSession({
      paneId: "pane-active",
      sessionName: "launch-target",
      paneActive: true,
      worktreePath: "/Users/test/repo",
      branch: "main",
    });
    const inactiveWorktreePane = buildSession({
      paneId: "pane-worktree",
      sessionName: "launch-target",
      paneActive: false,
      worktreePath: "/Users/test/repo/.worktree/feature/a",
      branch: "feature/a",
    });
    const onLaunchAgentInSession = vi.fn();
    const props = createViewProps({
      sessions: [activeNonWorktreePane, inactiveWorktreePane],
      groups: buildSessionGroups([activeNonWorktreePane, inactiveWorktreePane]),
      onLaunchAgentInSession,
    });

    renderWithRouter(<SessionListView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Launch Agent" }));

    expect(onLaunchAgentInSession).toHaveBeenCalledWith("launch-target", "codex", {
      cwd: "/Users/test/repo",
    });
  });

  it("uses window-level pane totals for each window section", () => {
    const agentPane = buildSession({
      paneId: "pane-1",
      windowId: "window-1",
      windowIndex: 1,
      paneIndex: 0,
      state: "RUNNING",
    });
    const shellPane1 = buildSession({
      paneId: "pane-2",
      windowId: "window-1",
      windowIndex: 1,
      paneIndex: 1,
      state: "SHELL",
    });
    const shellPane2 = buildSession({
      paneId: "pane-3",
      windowId: "window-1",
      windowIndex: 1,
      paneIndex: 2,
      state: "SHELL",
    });
    const agentPane2 = buildSession({
      paneId: "pane-4",
      windowId: "window-2",
      windowIndex: 2,
      paneIndex: 0,
      state: "RUNNING",
    });
    const sessions = [agentPane, shellPane1, shellPane2, agentPane2];
    const visibleSessions = [agentPane, agentPane2];
    const props = createViewProps({
      sessions,
      groups: buildSessionGroups(visibleSessions),
      visibleSessionCount: visibleSessions.length,
    });

    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getAllByText("1 / 3 panes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 / 1 panes").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("1 / 2 panes").length).toBe(0);
  });

  it("orders tmux sessions by the latest descendant window activity within a repo", () => {
    const alphaOlderWindow = buildSession({
      paneId: "pane-alpha-older",
      sessionId: "session-alpha",
      sessionName: "alpha",
      windowId: "window-alpha-1",
      windowIndex: 1,
      lastInputAt: "2026-02-07T10:00:00.000Z",
    });
    const alphaNewestWindow = buildSession({
      paneId: "pane-alpha-newest",
      sessionId: "session-alpha",
      sessionName: "alpha",
      windowId: "window-alpha-2",
      windowIndex: 2,
      lastRunStartedAt: "2026-02-07T13:00:00.000Z",
    });
    const beta = buildSession({
      paneId: "pane-beta",
      sessionId: "session-beta",
      sessionName: "beta",
      windowId: "window-beta-1",
      windowIndex: 1,
      lastInputAt: "2026-02-07T12:00:00.000Z",
    });
    const sessions = [alphaOlderWindow, beta, alphaNewestWindow];
    const props = createViewProps({
      sessions,
      groups: buildSessionGroups(sessions),
    });

    renderWithRouter(<SessionListView {...props} />);

    const sessionLabels = screen
      .getAllByText(/^Session (alpha|beta)$/)
      .map((element) => element.textContent);
    const orderedUniqueLabels = Array.from(new Set(sessionLabels));
    expect(orderedUniqueLabels[0]).toContain("Session alpha");
    expect(orderedUniqueLabels[1]).toContain("Session beta");
  });

  it("passes sidebar groups independently from visible groups", () => {
    const agentSession = buildSession({
      paneId: "pane-agent",
      repoRoot: "/Users/test/agent-repo",
      currentPath: "/Users/test/agent-repo",
      state: "RUNNING",
      title: "Agent Session",
    });
    const shellSession = buildSession({
      paneId: "pane-shell",
      repoRoot: "/Users/test/shell-repo",
      currentPath: "/Users/test/shell-repo",
      state: "SHELL",
      title: "Shell Session",
    });
    const sessions = [agentSession, shellSession];
    const props = createViewProps({
      sessions,
      groups: buildSessionGroups([agentSession]),
      visibleSessionCount: 1,
      sidebarSessionGroups: buildSessionGroups(sessions),
    });

    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByTestId("session-sidebar").getAttribute("data-count")).toBe("2");
  });

  it("wires sidebar open and pin handlers", () => {
    const onOpenPaneHere = vi.fn();
    const onLaunchAgentInSession = vi.fn();
    const onTouchRepoPin = vi.fn();
    const onTouchPanePin = vi.fn();
    const props = createViewProps({
      onOpenPaneHere,
      onLaunchAgentInSession,
      onTouchRepoPin,
      onTouchPanePin,
    });

    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "sidebar-open" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar-pin-pane" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar-pin-repo" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar-launch" }));

    expect(onOpenPaneHere).toHaveBeenCalledWith("pane-sidebar-open");
    expect(onLaunchAgentInSession).toHaveBeenCalledWith("sidebar-session", "claude", {
      worktreePath: "/Users/test/sidebar-repo/.worktree/feature/sidebar",
      worktreeBranch: "feature/sidebar",
    });
    expect(onTouchPanePin).toHaveBeenCalledWith("pane-sidebar-pin");
    expect(onTouchRepoPin).toHaveBeenCalledWith("/Users/test/sidebar-repo");
  });

  it("wires repo and pane pin handlers", () => {
    const session = buildSession({
      paneId: "pane-pin-target",
      sessionName: "session-pin-target",
      windowIndex: 7,
      repoRoot: "/Users/test/repo-pin-target",
    });
    const onTouchRepoPin = vi.fn();
    const onTouchPanePin = vi.fn();
    const props = createViewProps({
      sessions: [session],
      onTouchRepoPin,
      onTouchPanePin,
    });

    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Move repo to top" }));
    fireEvent.click(screen.getByRole("button", { name: "Move pane to top" }));

    expect(onTouchRepoPin).toHaveBeenCalledWith("/Users/test/repo-pin-target");
    expect(onTouchPanePin).toHaveBeenCalledWith("pane-pin-target");
  });

  it("uses requestAnimationFrame to scroll the pinned pane card into view", () => {
    const session = buildSession({
      paneId: "pane-pin-target",
      sessionName: "session-pin-target",
      windowIndex: 7,
      repoRoot: "/Users/test/repo-pin-target",
    });
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const scrollIntoViewSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const props = createViewProps({
      sessions: [session],
      onTouchPanePin: vi.fn(),
    });

    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Move pane to top" }));

    expect(requestAnimationFrameSpy).toHaveBeenCalled();
    expect(scrollIntoViewSpy).toHaveBeenCalled();

    requestAnimationFrameSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
  });

  it("opens GitHub repository from repo header button", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const session = buildSession({
      repoRoot: "/Users/test/repos/github.com/acme/project",
      currentPath: "/Users/test/repos/github.com/acme/project",
    });
    const props = createViewProps({
      sessions: [session],
      groups: buildSessionGroups([session]),
    });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Open repository on GitHub" }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/acme/project",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("wires LogModal actions", () => {
    const onOpenHere = vi.fn();
    const onOpenNewTab = vi.fn();
    const props = createViewProps({ onOpenHere, onOpenNewTab });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "open-here" }));
    fireEvent.click(screen.getByRole("button", { name: "open-new-tab" }));
    expect(onOpenHere).toHaveBeenCalled();
    expect(onOpenNewTab).toHaveBeenCalled();
  });

  it("renders callout for connectionIssue", () => {
    const props = createViewProps({
      connectionIssue: "Connection unstable",
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("Connection unstable")).toBeTruthy();
  });

  it("renders error cause below 500 status in connectionIssue callout", () => {
    const cause =
      "invalid config: /tmp/.config/vde/monitor/config.yml activity.pollIntervalMs Invalid input: expected number, received string";
    const props = createViewProps({
      connectionIssue: `Request failed (500)\nError cause: ${cause}`,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("Request failed (500)")).toBeTruthy();
    expect(screen.getByText(`Error cause: ${cause}`)).toBeTruthy();
  });

  it("wires QuickPanel handlers", () => {
    const onOpenLogModal = vi.fn();
    const onOpenPaneHere = vi.fn();
    const onOpenPaneInNewWindow = vi.fn();
    const onToggleQuickPanel = vi.fn();
    const props = createViewProps({
      quickPanelOpen: true,
      onOpenLogModal,
      onOpenPaneHere,
      onOpenPaneInNewWindow,
      onToggleQuickPanel,
    });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "open-link" }));
    fireEvent.click(screen.getByRole("button", { name: "open-link-new-window" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-panel" }));
    expect(onOpenLogModal).toHaveBeenCalledWith("pane-quick");
    expect(onOpenPaneHere).toHaveBeenCalledWith("pane-quick-link");
    expect(onOpenPaneInNewWindow).toHaveBeenCalledWith("pane-quick-link-new");
    expect(onToggleQuickPanel).toHaveBeenCalled();
  });
});
