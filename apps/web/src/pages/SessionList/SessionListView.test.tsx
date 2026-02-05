// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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
    actions: { onOpenLogModal: (paneId: string) => void; onToggle: () => void };
  }) => (
    <div data-testid="quick-panel" data-open={String(state.open)}>
      <button type="button" onClick={() => actions.onOpenLogModal("pane-quick")}>
        open-log
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

const filterValues = ["ALL", "AGENT", "SHELL", "UNKNOWN"] as const;

const filterOptions = filterValues.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

const statusOrder = ["RUNNING", "WAITING_INPUT", "WAITING_PERMISSION", "SHELL", "UNKNOWN"] as const;

const buildStatusSections = (sessions: SessionSummary[]) => {
  return statusOrder
    .map((state) => {
      const filtered = sessions.filter((session) => session.state === state);
      return {
        state,
        count: filtered.length,
        groups: buildSessionGroups(filtered),
      };
    })
    .filter((section) => section.count > 0);
};

const createViewProps = (overrides: Partial<SessionListViewProps> = {}): SessionListViewProps => {
  const sessions = overrides.sessions ?? [];
  const statusSections = overrides.statusSections ?? buildStatusSections(sessions);
  const quickPanelGroups = overrides.quickPanelGroups ?? buildSessionGroups(sessions);
  const visibleSessionCount = overrides.visibleSessionCount ?? sessions.length;
  return {
    sessions,
    statusSections,
    visibleSessionCount,
    quickPanelGroups,
    filter: "AGENT",
    filterOptions,
    connected: true,
    connectionIssue: null,
    readOnly: false,
    nowMs: Date.now(),
    sidebarWidth: 280,
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    onReconnect: vi.fn(),
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
    onOpenHere: vi.fn(),
    onOpenNewTab: vi.fn(),
    ...overrides,
  };
};

describe("SessionListView", () => {
  it("renders empty state when no sessions", () => {
    const props = createViewProps({
      sessions: [],
      statusSections: [],
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
      statusSections: [],
      visibleSessionCount: 0,
      onFilterChange,
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("No Matching Sessions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show All Sessions" }));
    expect(onFilterChange).toHaveBeenCalledWith("ALL");
  });

  it("calls refresh when connected", () => {
    const onRefresh = vi.fn();
    const props = createViewProps({ connected: true, onRefresh });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("calls reconnect when disconnected", () => {
    const onReconnect = vi.fn();
    const props = createViewProps({ connected: false, onReconnect });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalled();
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

  it("renders repo group and session card", () => {
    const session = buildSession({
      repoRoot: "/Users/test/my-repo",
      customTitle: "Custom Session",
    });
    const props = createViewProps({ sessions: [session] });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("my-repo")).toBeTruthy();
    expect(screen.getByText("Custom Session")).toBeTruthy();
    const cardLink = screen.getByText("Custom Session").closest("a");
    expect(cardLink).toBeTruthy();
    if (!cardLink) return;
    const cardScope = within(cardLink);
    expect(cardScope.getByText("RUNNING")).toBeTruthy();
    expect(cardScope.getByText("CODEX")).toBeTruthy();
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

  it("renders callouts for readOnly and connectionIssue", () => {
    const props = createViewProps({
      readOnly: true,
      connectionIssue: "Connection unstable",
    });
    renderWithRouter(<SessionListView {...props} />);

    expect(screen.getByText("Read-only mode is active. Actions are disabled.")).toBeTruthy();
    expect(screen.getByText("Connection unstable")).toBeTruthy();
  });

  it("wires QuickPanel handlers", () => {
    const onOpenLogModal = vi.fn();
    const onToggleQuickPanel = vi.fn();
    const props = createViewProps({
      quickPanelOpen: true,
      onOpenLogModal,
      onToggleQuickPanel,
    });
    renderWithRouter(<SessionListView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "open-log" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-panel" }));
    expect(onOpenLogModal).toHaveBeenCalledWith("pane-quick");
    expect(onToggleQuickPanel).toHaveBeenCalled();
  });
});
