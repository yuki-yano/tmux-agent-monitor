import { QueryClientProvider } from "@tanstack/react-query";
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
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/state/theme-context";
import { createAppQueryClient } from "@/state/query-client";

import { createSessionContextMock } from "./session-context-mock";
import { SessionDetailProvider } from "./SessionDetailProvider";
import { SessionDetailView } from "./SessionDetailView";
import { createSessionDetail } from "./test-helpers";

// Provider<->View wiring smoke test (T15b #3).
//
// SessionDetailProvider.test.tsx exercises the real Provider but mocks
// SessionDetailView out of the picture (renderHook against the context
// directly), and SessionDetailView.test.tsx exercises the real View but
// mocks the whole SessionDetailProvider/context away. Neither test would
// catch a mismatch between what the Provider's context value actually
// contains and what the View (or the props/state hooks it composes)
// destructures from it. This test mounts the real Provider, the real View,
// and every real SessionDetail-internal hook/component in between, so a
// wiring break shows up as a render-time exception or a missing section
// here even though it's invisible to the other two suites.
//
// The only stubbed boundary is session-context's 7 context hooks (the
// equivalent of the server/SSE layer) via a module mock, following the
// exact pattern SessionDetailProvider.test.tsx already uses -- everything
// SessionDetail reads from the server flows through these injected
// `request*`/data callbacks, so mocking them also covers the "no real API
// fetch" boundary without needing MSW handlers. `token` is left `null` so
// the real (also unmocked) push-notifications and SSE-stream hooks take
// their "disabled" early-return path instead of touching `fetch`/
// `EventSource`.
const session = createSessionDetail({ paneId: "pane-1" });
const requestRepoFileContent = vi.fn(async () => ({
  path: "README.md",
  sizeBytes: 18,
  isBinary: false,
  truncated: false,
  languageHint: "markdown" as const,
  content: "# Changed preview",
}));

const sessionContextValue = createSessionContextMock({
  stream: {
    sessions: [session],
    getSessionDetail: (paneId: string) => (paneId === session.paneId ? session : null),
  },
  config: {
    token: null,
    apiBaseUrl: null,
    authError: null,
    highlightCorrections: { codex: true, claude: true },
  },
  core: {
    requestScreen: vi.fn(async () => ({
      ok: true as const,
      paneId: session.paneId,
      mode: "text" as const,
      capturedAt: new Date(0).toISOString(),
      screen: "",
      full: true,
    })),
    requestStateTimeline: vi.fn(async () => ({
      paneId: session.paneId,
      now: new Date(0).toISOString(),
      range: "1h" as const,
      items: [],
      totalsMs: {
        RUNNING: 0,
        DONE: 0,
        WAITING_INPUT: 0,
        WAITING_PERMISSION: 0,
        SHELL: 0,
        UNKNOWN: 0,
      },
      current: null,
    })),
  },
  branches: {
    requestDiffSummary: vi.fn(async () => ({
      repoRoot: session.repoRoot,
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      files: [
        {
          path: "README.md",
          status: "M" as const,
          staged: false,
          additions: 1,
          deletions: 0,
        },
      ],
    })),
    requestCommitLog: vi.fn(async () => ({
      repoRoot: session.repoRoot,
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
      totalCount: 0,
    })),
    requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
    requestBranches: vi.fn(async () => ({
      repoRoot: session.repoRoot,
      defaultBranch: "main",
      currentBranch: "main",
      entries: [],
    })),
  },
  files: {
    requestRepoFileTree: vi.fn(async () => ({ basePath: ".", entries: [] })),
    requestRepoFileContent,
  },
  notes: {
    requestRepoNotes: vi.fn(async () => []),
  },
});

vi.mock("@/state/session-context", () => ({
  useSessionStreamData: () => sessionContextValue,
  useSessionConfigData: () => sessionContextValue,
  useSessionCoreApi: () => sessionContextValue,
  useSessionBranchesApi: () => sessionContextValue,
  useSessionFilesApi: () => sessionContextValue,
  useSessionNotesApi: () => sessionContextValue,
  useSessionLaunchApi: () => sessionContextValue,
}));

const renderWithRouter = (ui: ReactNode) => {
  const queryClient = createAppQueryClient();
  const rootRoute = createRootRoute({ component: () => null });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <ThemeProvider>{ui}</ThemeProvider>
      </RouterContextProvider>
    </QueryClientProvider>,
  );
};

describe("SessionDetail Provider <-> View wiring (smoke)", () => {
  it("mounts the real Provider + View and switches between every inspector section", async () => {
    const store = createStore();

    renderWithRouter(
      <JotaiProvider store={store}>
        <SessionDetailProvider paneId="pane-1">
          <SessionDetailView />
        </SessionDetailProvider>
      </JotaiProvider>,
    );

    expect(await screen.findByRole("button", { name: "Edit session title" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "State Timeline" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Session inspector sections" })).toBeTruthy();

    const inspectorSections = [
      ["Changes panel", "Changes"],
      ["Files panel", "File Navigator"],
      ["Commits panel", "Commit Log"],
      ["Branches panel", "Branches"],
      ["Notes panel", "Notes"],
    ] as const;

    for (const [tabName, headingName] of inspectorSections) {
      fireEvent.mouseDown(screen.getByRole("tab", { name: tabName }), { button: 0 });
      expect(screen.getByRole("heading", { name: headingName })).toBeTruthy();
    }

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Worktrees panel" }), { button: 0 });
    expect(screen.getByTestId("worktree-section")).toBeTruthy();
  });

  it("opens a changed file in the shared content preview", async () => {
    const store = createStore();

    renderWithRouter(
      <JotaiProvider store={store}>
        <SessionDetailProvider paneId="pane-1">
          <SessionDetailView />
        </SessionDetailProvider>
      </JotaiProvider>,
    );

    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Changes panel" }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Preview README.md" }));

    expect(await screen.findByRole("heading", { name: "Changed preview" })).toBeTruthy();
    expect(requestRepoFileContent).toHaveBeenCalledWith(
      "pane-1",
      "README.md",
      expect.objectContaining({ maxBytes: 256 * 1024 }),
    );
  });
});
