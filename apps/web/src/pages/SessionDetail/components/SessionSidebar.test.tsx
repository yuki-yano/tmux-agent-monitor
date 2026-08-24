import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionDetail } from "../test-helpers";
import { SessionSidebar } from "@/features/shared-session-ui/components/SessionSidebar";

vi.mock("@/features/shared-session-ui/hooks/useSidebarPreview", () => ({
  useSidebarPreview: () => ({
    preview: null,
    handleHoverStart: vi.fn(),
    handleHoverEnd: vi.fn(),
    handleFocus: vi.fn(),
    handleBlur: vi.fn(),
    handleSelect: vi.fn(),
    handleListScroll: vi.fn(),
    registerItemRef: vi.fn(),
  }),
}));

vi.mock("@/features/launch-agent/LaunchAgentButton", () => ({
  LaunchAgentButton: ({
    sessionName,
    sourceSession,
    onLaunchAgentInSession,
  }: {
    sessionName: string;
    sourceSession?: {
      worktreePath?: string | null;
      branch?: string | null;
      repoRoot?: string | null;
    };
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

describe("SessionSidebar", () => {
  type SessionSidebarState = Parameters<typeof SessionSidebar>[0]["state"];
  type SessionSidebarActions = Parameters<typeof SessionSidebar>[0]["actions"];

  const renderWithRouter = (ui: ReactNode) => {
    const rootRoute = createRootRoute({ component: () => null });
    const sessionRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/sessions/$paneId",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([sessionRoute]),
      history: createMemoryHistory({ initialEntries: ["/sessions/pane-1"] }),
    });
    return render(
      <RouterContextProvider router={router}>
        <JotaiProvider store={createStore()}>{ui}</JotaiProvider>
      </RouterContextProvider>,
    );
  };

  const buildState = (overrides: Partial<SessionSidebarState> = {}): SessionSidebarState => ({
    sessionGroups: [],
    nowMs: Date.now(),
    connected: true,
    connectionIssue: null,
    launchAgentAvailable: true,
    requestStateTimeline: vi.fn(),
    requestScreen: vi.fn(),
    launchConfig: {
      agents: {
        codex: { options: [] },
        claude: { options: [] },
      },
    },
    requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
    highlightCorrections: { codex: true, claude: true },
    resolvedTheme: "latte",
    currentPaneId: null,
    ...overrides,
  });

  const buildActions = (overrides: Partial<SessionSidebarActions> = {}): SessionSidebarActions => ({
    onSelectSession: vi.fn(),
    ...overrides,
  });
  const platformDescriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
  const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");

  const setNavigatorPlatform = (platform: string, maxTouchPoints: number) => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: platform,
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: maxTouchPoints,
    });
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterAll(() => {
    if (platformDescriptor) {
      Object.defineProperty(navigator, "platform", platformDescriptor);
    }
    if (maxTouchPointsDescriptor) {
      Object.defineProperty(navigator, "maxTouchPoints", maxTouchPointsDescriptor);
    }
  });

  it("filters non-agent sessions and groups by window", () => {
    const sessionOne = createSessionDetail({
      paneId: "pane-1",
      sessionId: "session-alpha",
      windowId: "window-alpha-1",
      title: "Codex Session",
      agent: "codex",
      branch: "feature/codex",
      worktreePath: "/Users/test/repo/.worktree/feature/codex",
      worktreeDirty: true,
      worktreeLocked: false,
      worktreeMerged: false,
      windowIndex: 1,
      sessionName: "alpha",
    });
    const sessionTwo = createSessionDetail({
      paneId: "pane-2",
      sessionId: "session-alpha",
      windowId: "window-alpha-2",
      title: "Claude Session",
      agent: "claude",
      branch: "feature/claude",
      worktreePath: "/Users/test/repo",
      windowIndex: 2,
      sessionName: "alpha",
    });
    const sessionUnknown = createSessionDetail({
      paneId: "pane-3",
      sessionId: "session-alpha",
      windowId: "window-alpha-1",
      title: "Shell Session",
      agent: "unknown",
      state: "SHELL",
      windowIndex: 1,
      sessionName: "alpha",
    });

    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [sessionOne, sessionTwo, sessionUnknown],
          lastInputAt: sessionOne.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    expect(screen.getByText("Codex Session")).toBeTruthy();
    expect(screen.getByText("Claude Session")).toBeTruthy();
    expect(screen.queryByText("Shell Session")).toBeNull();
    expect(screen.getByText("Window 1")).toBeTruthy();
    expect(screen.getByText("Window 2")).toBeTruthy();
    expect(screen.getByText("feature/codex")).toBeTruthy();
    expect(screen.getByText("feature/claude")).toBeTruthy();
    expect(screen.queryByText("D:Y")).toBeNull();
    expect(screen.queryByText("L:N")).toBeNull();
    expect(screen.queryByText("PR:Y")).toBeNull();
    expect(screen.queryByText("M:N")).toBeNull();
    expect(screen.queryByText("D:?")).toBeNull();
    expect(screen.getByText("2 windows")).toBeTruthy();
    expect(screen.getAllByText("1 / 2 panes")).toHaveLength(2);
  });

  it("renders agent/time row with branch on the next line", () => {
    const session = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      branch: "feature/sidebar-layout",
      lastInputAt: "2026-02-07T10:00:00.000Z",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const state = buildState({
      nowMs: Date.parse("2026-02-07T10:01:00.000Z"),
      sidebarWidth: 400,
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [session],
          lastInputAt: session.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    expect(screen.getByText("CODEX")).toBeTruthy();
    const branchText = screen.getByText("feature/sidebar-layout");
    const branchPill = branchText.parentElement;
    expect(branchPill?.className).toContain("max-w-[140px]");
    expect(branchPill?.className).not.toContain("basis-full");

    const lastInputValue = screen.getByText("1m ago");
    const lastInputPill = lastInputValue.closest("span.inline-flex");
    expect(lastInputPill?.parentElement?.className).not.toContain("ml-auto");
    const sessionLink = screen.getByText("Codex Session").closest("a");
    expect(sessionLink?.querySelector("span.basis-full")).toBeTruthy();
  });

  it("renders branch inline to the right of last input when sidebar is 460px or wider", () => {
    const session = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      branch: "feature/sidebar-inline",
      lastInputAt: "2026-02-07T10:00:00.000Z",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const state = buildState({
      nowMs: Date.parse("2026-02-07T10:01:00.000Z"),
      sidebarWidth: 460,
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [session],
          lastInputAt: session.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    const branchPill = screen.getByText("feature/sidebar-inline").parentElement;
    expect(branchPill?.className).toContain("ml-auto");
    expect(branchPill?.className).toContain("max-w-[140px]");
    const lastInputValue = screen.getByText("1m ago");
    const lastInputPill = lastInputValue.closest("span.inline-flex");
    expect(lastInputPill?.parentElement?.className).toContain("flex-nowrap");
    const sessionLink = screen.getByText("Codex Session").closest("a");
    expect(sessionLink?.querySelector("span.basis-full")).toBeNull();
  });

  it("shows empty state when no agent sessions", () => {
    const sessionUnknown = createSessionDetail({
      paneId: "pane-3",
      title: "Shell Session",
      agent: "unknown",
      state: "SHELL",
    });
    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [sessionUnknown],
          lastInputAt: sessionUnknown.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    expect(screen.getByText("No sessions available for this filter.")).toBeTruthy();
  });

  it("filters sessions with local sidebar filter", () => {
    const agentSession = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      state: "RUNNING",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const shellSession = createSessionDetail({
      paneId: "pane-2",
      title: "Shell Session",
      agent: "unknown",
      state: "SHELL",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const editorSession = createSessionDetail({
      paneId: "pane-3",
      title: "Neovim Session",
      currentCommand: "nvim",
      agent: "unknown",
      state: "UNKNOWN",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [agentSession, shellSession, editorSession],
          lastInputAt: agentSession.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    expect(screen.getByText("Codex Session")).toBeTruthy();
    const codexLink = screen.getByText("Codex Session").closest("a");
    expect(codexLink?.className).toContain("before:bg-latte-green");
    expect(screen.queryByText("Shell Session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "SHELL" }));

    expect(screen.getByText("Shell Session")).toBeTruthy();
    expect(screen.queryByText("Codex Session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "EDITOR" }));

    expect(screen.getByText("Neovim Session")).toBeTruthy();
    const neovimLink = screen.getByText("Neovim Session").closest("a");
    expect(neovimLink?.className).toContain("before:bg-latte-maroon");
    const editorIcon = screen.getByLabelText("EDITOR");
    expect(editorIcon.className).toContain("border-latte-maroon/45");
    expect(screen.queryByText("Codex Session")).toBeNull();
    expect(screen.queryByText("Shell Session")).toBeNull();
  });

  it("applies repo pin timestamps to filtered group sorting like session list", () => {
    const repoSortAnchorUpdatedAt = Date.parse("2026-02-07T13:00:00.000Z");
    const repoAAgent = createSessionDetail({
      paneId: "pane-a-agent",
      title: "Repo A Agent",
      repoRoot: "/Users/test/repo-a",
      sessionName: "alpha",
      windowIndex: 1,
      state: "RUNNING",
      lastInputAt: "2026-02-07T10:00:00.000Z",
    });
    const repoAShell = createSessionDetail({
      paneId: "pane-a-shell",
      title: "Repo A Shell",
      repoRoot: "/Users/test/repo-a",
      sessionName: "alpha",
      windowIndex: 1,
      state: "SHELL",
      agent: "unknown",
      lastInputAt: "2026-02-07T12:00:00.000Z",
    });
    const repoBAgent = createSessionDetail({
      paneId: "pane-b-agent",
      title: "Repo B Agent",
      repoRoot: "/Users/test/repo-b",
      sessionName: "beta",
      windowIndex: 1,
      state: "RUNNING",
      lastInputAt: "2026-02-07T11:00:00.000Z",
    });

    const state = buildState({
      getRepoSortAnchorAt: (repoRoot) =>
        repoRoot === "/Users/test/repo-a" ? repoSortAnchorUpdatedAt : null,
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo-a",
          sessions: [repoAAgent, repoAShell],
          lastInputAt: repoAShell.lastInputAt,
        },
        {
          repoRoot: "/Users/test/repo-b",
          sessions: [repoBAgent],
          lastInputAt: repoBAgent.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    const links = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/sessions/"));
    expect(links[0]?.textContent).toContain("Repo A Agent");
    expect(links[1]?.textContent).toContain("Repo B Agent");
  });

  it("calls onTouchRepoPin when repo pin button is pressed", () => {
    const repoAAgent = createSessionDetail({
      paneId: "pane-a-agent",
      title: "Repo A Agent",
      repoRoot: "/Users/test/repo-a",
      sessionName: "alpha",
      windowIndex: 1,
      state: "RUNNING",
      lastInputAt: "2026-02-07T10:00:00.000Z",
    });
    const repoBAgent = createSessionDetail({
      paneId: "pane-b-agent",
      title: "Repo B Agent",
      repoRoot: "/Users/test/repo-b",
      sessionName: "beta",
      windowIndex: 1,
      state: "RUNNING",
      lastInputAt: "2026-02-07T11:00:00.000Z",
    });
    const onTouchRepoPin = vi.fn();
    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo-a",
          sessions: [repoAAgent],
          lastInputAt: repoAAgent.lastInputAt,
        },
        {
          repoRoot: "/Users/test/repo-b",
          sessions: [repoBAgent],
          lastInputAt: repoBAgent.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={{ onTouchRepoPin }} />);

    const repoPinButtons = screen.getAllByRole("button", { name: "Move repo to top" });
    fireEvent.click(repoPinButtons[1]!);
    expect(onTouchRepoPin).toHaveBeenCalledWith("/Users/test/repo-a");
  });

  it("calls onFocusPane without triggering session selection", () => {
    setNavigatorPlatform("MacIntel", 0);
    const sessionOne = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const onSelectSession = vi.fn();
    const onFocusPane = vi.fn();
    const state = buildState({
      currentPaneId: "pane-2",
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [sessionOne],
          lastInputAt: sessionOne.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={{ onSelectSession, onFocusPane }} />);

    const focusButton = screen.getByRole("button", { name: "Focus terminal pane" });
    fireEvent.click(focusButton);

    expect(onFocusPane).toHaveBeenCalledWith("pane-1");
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("hides focus button on non-mac platforms", () => {
    setNavigatorPlatform("Win32", 0);
    const sessionOne = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [sessionOne],
          lastInputAt: sessionOne.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={{ onFocusPane: vi.fn() }} />);

    expect(screen.queryByRole("button", { name: "Focus terminal pane" })).toBeNull();
  });

  it("calls onTouchSession without triggering session selection", () => {
    const sessionOne = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const onSelectSession = vi.fn();
    const onTouchSession = vi.fn();
    const state = buildState({
      currentPaneId: "pane-2",
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [sessionOne],
          lastInputAt: sessionOne.lastInputAt,
        },
      ],
    });

    renderWithRouter(
      <SessionSidebar state={state} actions={{ onSelectSession, onTouchSession }} />,
    );

    const pinButton = screen.getByRole("button", { name: "Move pane to top" });
    fireEvent.click(pinButton);

    expect(onTouchSession).toHaveBeenCalledWith("pane-1");
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("prefers repo root launch options over vw worktree pane", () => {
    const inactiveWorktreePane = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session Worktree",
      agent: "codex",
      sessionName: "alpha",
      windowIndex: 1,
      paneActive: false,
      branch: "feature/alpha-worktree",
      worktreePath: "/Users/test/repo/.worktree/feature/alpha-worktree",
    });
    const activeNonWorktreePane = createSessionDetail({
      paneId: "pane-2",
      title: "Codex Session Active",
      agent: "codex",
      sessionName: "alpha",
      windowIndex: 2,
      paneActive: true,
      branch: "main",
      worktreePath: "/Users/test/repo",
    });
    const onLaunchAgentInSession = vi.fn();
    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [inactiveWorktreePane, activeNonWorktreePane],
          lastInputAt: activeNonWorktreePane.lastInputAt,
        },
      ],
    });

    renderWithRouter(
      <SessionSidebar
        state={state}
        actions={{
          onLaunchAgentInSession,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Launch Agent" }));

    expect(onLaunchAgentInSession).toHaveBeenCalledWith("alpha", "codex", {
      cwd: "/Users/test/repo",
    });
  });

  it("hides launch controls when the backend does not support launching agents", () => {
    const session = createSessionDetail({ sessionName: "alpha" });
    const state = buildState({
      launchAgentAvailable: false,
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo",
          sessions: [session],
          lastInputAt: session.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={buildActions()} />);

    expect(screen.queryByRole("button", { name: "Launch Agent" })).toBeNull();
  });
});
