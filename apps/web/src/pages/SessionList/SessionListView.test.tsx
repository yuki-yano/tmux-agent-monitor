// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSessionGroups } from "@/lib/session-group";

import type { SessionListViewProps } from "./SessionListView";
import { SessionListView } from "./SessionListView";

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock("@/pages/SessionDetail/components/SessionSidebar", () => ({
  SessionSidebar: ({ state }: { state: { sessionGroups: unknown[] } }) => (
    <div data-testid="session-sidebar" data-count={state.sessionGroups.length} />
  ),
}));

vi.mock("@/pages/SessionDetail/components/QuickPanel", () => ({
  QuickPanel: ({
    state,
    actions,
  }: {
    state: { open: boolean };
    actions: {
      onOpenLogModal: (paneId: string) => void;
      onOpenSessionLink: (paneId: string) => void;
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
      <button type="button" onClick={actions.onToggle}>
        toggle-panel
      </button>
    </div>
  ),
}));

vi.mock("@/pages/SessionDetail/components/LogModal", () => ({
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
  sessionName: "session-1",
  windowIndex: 1,
  paneIndex: 0,
  windowActivity: null,
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
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
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
    filterOptions,
    connectionStatus: "healthy",
    connectionIssue: null,
    nowMs: Date.now(),
    sidebarWidth: 280,
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
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
    onOpenHere: vi.fn(),
    onOpenNewTab: vi.fn(),
    isRepoPinned: vi.fn(() => false),
    isWindowPinned: vi.fn(() => false),
    isPanePinned: vi.fn(() => false),
    onToggleRepoPin: vi.fn(),
    onToggleWindowPin: vi.fn(),
    onTogglePanePin: vi.fn(),
    ...overrides,
  };
};

describe("SessionListView", () => {
  afterEach(() => {
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

  it("calls refresh when refresh button is clicked", () => {
    const onRefresh = vi.fn();
    const props = createViewProps({ connectionStatus: "healthy", onRefresh });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("calls onFilterChange when filter button is clicked", () => {
    const onFilterChange = vi.fn();
    const props = createViewProps({ onFilterChange });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "SHELL" }));
    expect(onFilterChange).toHaveBeenCalledWith("SHELL");
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

  it("uses window-level pane totals for each window section", () => {
    const agentPane = buildSession({
      paneId: "pane-1",
      windowIndex: 1,
      paneIndex: 0,
      state: "RUNNING",
    });
    const shellPane1 = buildSession({
      paneId: "pane-2",
      windowIndex: 1,
      paneIndex: 1,
      state: "SHELL",
    });
    const shellPane2 = buildSession({
      paneId: "pane-3",
      windowIndex: 1,
      paneIndex: 2,
      state: "SHELL",
    });
    const agentPane2 = buildSession({
      paneId: "pane-4",
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

  it("wires repo, window, and pane pin handlers", () => {
    const session = buildSession({
      paneId: "pane-pin-target",
      sessionName: "session-pin-target",
      windowIndex: 7,
      repoRoot: "/Users/test/repo-pin-target",
    });
    const onToggleRepoPin = vi.fn();
    const onToggleWindowPin = vi.fn();
    const onTogglePanePin = vi.fn();
    const props = createViewProps({
      sessions: [session],
      onToggleRepoPin,
      onToggleWindowPin,
      onTogglePanePin,
    });

    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Pin repo to top" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin window to top" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin pane to top" }));

    expect(onToggleRepoPin).toHaveBeenCalledWith("/Users/test/repo-pin-target");
    expect(onToggleWindowPin).toHaveBeenCalledWith("session-pin-target", 7);
    expect(onTogglePanePin).toHaveBeenCalledWith("pane-pin-target");
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

  it("wires QuickPanel handlers", () => {
    const onOpenLogModal = vi.fn();
    const onOpenPaneHere = vi.fn();
    const onToggleQuickPanel = vi.fn();
    const props = createViewProps({
      quickPanelOpen: true,
      onOpenLogModal,
      onOpenPaneHere,
      onToggleQuickPanel,
    });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "open-link" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-panel" }));
    expect(onOpenLogModal).toHaveBeenCalledWith("pane-quick");
    expect(onOpenPaneHere).toHaveBeenCalledWith("pane-quick-link");
    expect(onToggleQuickPanel).toHaveBeenCalled();
  });
});
