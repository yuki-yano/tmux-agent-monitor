// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionDetail } from "../test-helpers";
import { SessionSidebar } from "./SessionSidebar";

vi.mock("../hooks/useSidebarPreview", () => ({
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
    return render(<RouterContextProvider router={router}>{ui}</RouterContextProvider>);
  };

  const buildState = (overrides: Partial<SessionSidebarState> = {}): SessionSidebarState => ({
    sessionGroups: [],
    nowMs: Date.now(),
    connected: true,
    connectionIssue: null,
    requestStateTimeline: vi.fn(),
    requestScreen: vi.fn(),
    highlightCorrections: { codex: true, claude: true },
    resolvedTheme: "latte",
    currentPaneId: null,
    ...overrides,
  });

  const buildActions = (overrides: Partial<SessionSidebarActions> = {}): SessionSidebarActions => ({
    onSelectSession: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("filters non-agent sessions and groups by window", () => {
    const sessionOne = createSessionDetail({
      paneId: "pane-1",
      title: "Codex Session",
      agent: "codex",
      windowIndex: 1,
      sessionName: "alpha",
    });
    const sessionTwo = createSessionDetail({
      paneId: "pane-2",
      title: "Claude Session",
      agent: "claude",
      windowIndex: 2,
      sessionName: "alpha",
    });
    const sessionUnknown = createSessionDetail({
      paneId: "pane-3",
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
    expect(screen.getByText("2 windows")).toBeTruthy();
    expect(screen.getAllByText("1 / 2 panes")).toHaveLength(2);
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
    expect(codexLink?.className).toContain("border-green-500/50");
    expect(screen.queryByText("Shell Session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "SHELL" }));

    expect(screen.getByText("Shell Session")).toBeTruthy();
    expect(screen.queryByText("Codex Session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "EDITOR" }));

    expect(screen.getByText("Neovim Session")).toBeTruthy();
    const neovimLink = screen.getByText("Neovim Session").closest("a");
    expect(neovimLink?.className).toContain("border-latte-maroon/55");
    const editorIcon = screen.getByLabelText("EDITOR");
    expect(editorIcon.className).toContain("border-latte-maroon/45");
    expect(screen.queryByText("Codex Session")).toBeNull();
    expect(screen.queryByText("Shell Session")).toBeNull();
  });

  it("reorders repo groups by filtered sessions like session list", () => {
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

    const beforePinLinks = screen.getAllByRole("link");
    expect(beforePinLinks[0]?.textContent).toContain("Repo B Agent");
    expect(beforePinLinks[1]?.textContent).toContain("Repo A Agent");

    const repoPinButtons = screen.getAllByRole("button", { name: "Pin repo to top" });
    fireEvent.click(repoPinButtons[1]!);

    const afterPinLinks = screen.getAllByRole("link");
    expect(afterPinLinks[0]?.textContent).toContain("Repo A Agent");
    expect(afterPinLinks[1]?.textContent).toContain("Repo B Agent");
  });

  it("calls onFocusPane without triggering session selection", () => {
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

    const pinButton = screen.getByRole("button", { name: "Pin pane to top" });
    fireEvent.click(pinButton);

    expect(onTouchSession).toHaveBeenCalledWith("pane-1");
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("reorders repo groups when pane pin is pressed like session list", () => {
    const repoASession = createSessionDetail({
      paneId: "pane-a",
      title: "Repo A Session",
      repoRoot: "/Users/test/repo-a",
      sessionName: "alpha",
      windowIndex: 1,
      state: "RUNNING",
      lastInputAt: "2026-02-07T10:00:00.000Z",
    });
    const repoBSession = createSessionDetail({
      paneId: "pane-b",
      title: "Repo B Session",
      repoRoot: "/Users/test/repo-b",
      sessionName: "beta",
      windowIndex: 1,
      state: "RUNNING",
      lastInputAt: "2026-02-07T11:00:00.000Z",
    });
    const onTouchSession = vi.fn();
    const state = buildState({
      sessionGroups: [
        {
          repoRoot: "/Users/test/repo-a",
          sessions: [repoASession],
          lastInputAt: repoASession.lastInputAt,
        },
        {
          repoRoot: "/Users/test/repo-b",
          sessions: [repoBSession],
          lastInputAt: repoBSession.lastInputAt,
        },
      ],
    });

    renderWithRouter(<SessionSidebar state={state} actions={{ onTouchSession }} />);

    const beforePinLinks = screen.getAllByRole("link");
    expect(beforePinLinks[0]?.textContent).toContain("Repo B Session");
    expect(beforePinLinks[1]?.textContent).toContain("Repo A Session");

    const panePinButtons = screen.getAllByRole("button", { name: "Pin pane to top" });
    fireEvent.click(panePinButtons[1]!);

    const afterPinLinks = screen.getAllByRole("link");
    expect(afterPinLinks[0]?.textContent).toContain("Repo A Session");
    expect(afterPinLinks[1]?.textContent).toContain("Repo B Session");
    expect(onTouchSession).toHaveBeenCalledWith("pane-a");
  });
});
