// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createSessionDetail } from "../test-helpers";
import { SessionSidebar } from "./SessionSidebar";

const mockSessionsContext = {
  connected: true,
  connectionIssue: null,
  requestScreen: vi.fn(),
  highlightCorrections: { codex: true, claude: true },
};

vi.mock("@/state/session-context", () => ({
  useSessions: () => mockSessionsContext,
}));

vi.mock("@/state/theme-context", () => ({
  useTheme: () => ({
    preference: "system",
    resolvedTheme: "latte",
    setPreference: vi.fn(),
  }),
}));

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
    currentPaneId: null,
    ...overrides,
  });

  const buildActions = (overrides: Partial<SessionSidebarActions> = {}): SessionSidebarActions => ({
    onSelectSession: vi.fn(),
    ...overrides,
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

    expect(screen.getByText("No agent sessions available.")).toBeTruthy();
  });
});
