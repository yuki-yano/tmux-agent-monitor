import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RepoNote } from "@vde-monitor/shared";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/state/theme-context";
import { createAppQueryClient } from "@/state/query-client";

import { createSessionContextMock } from "./session-context-mock";
import { sessionDetailQueryKeys } from "./session-detail-query-keys";
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
const requestRepoNotes = vi.fn(async (): Promise<RepoNote[]> => []);
const updateRepoNote = vi.fn();
const requestStateTimeline = vi.fn(async () => ({
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
    requestStateTimeline,
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
    requestRepoNotes,
    updateRepoNote,
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

const renderWithRouter = (ui: ReactNode, queryClient = createAppQueryClient()) => {
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

const expectSingleGitScopeObservers = (queryClient: ReturnType<typeof createAppQueryClient>) => {
  const branchQueryKey = sessionDetailQueryKeys.branches("pane-1", session.repoRoot);
  const worktreeQueryKey = sessionDetailQueryKeys.worktrees("pane-1", session.repoRoot);
  expect(
    queryClient
      .getQueryCache()
      .find({ queryKey: branchQueryKey, exact: true })
      ?.getObserversCount(),
  ).toBe(1);
  expect(
    queryClient
      .getQueryCache()
      .find({ queryKey: worktreeQueryKey, exact: true })
      ?.getObserversCount(),
  ).toBe(1);
  const activeCommitHeadQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: sessionDetailQueryKeys.commitsRoot("pane-1") })
    .filter(
      (query) => query.queryKey[3] === "log" && query.queryKey[4] === "head" && query.isActive(),
    );
  expect(activeCommitHeadQueries).toHaveLength(1);
  expect(activeCommitHeadQueries[0]?.getObserversCount()).toBe(1);
  const commitTailQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: sessionDetailQueryKeys.commitsRoot("pane-1") })
    .filter(
      (query) =>
        query.queryKey[3] === "log" &&
        query.queryKey[4] === "tail" &&
        query.getObserversCount() > 0,
    );
  expect(commitTailQueries).toHaveLength(1);
  expect(commitTailQueries[0]?.getObserversCount()).toBe(1);
};

describe("SessionDetail Provider <-> View wiring (smoke)", () => {
  beforeEach(() => {
    requestRepoFileContent.mockClear();
    requestRepoNotes.mockClear();
    requestRepoNotes.mockResolvedValue([]);
    updateRepoNote.mockClear();
    requestStateTimeline.mockClear();
  });

  it("mounts the real Provider + View and switches between every inspector section", async () => {
    const store = createStore();
    const queryClient = createAppQueryClient();

    renderWithRouter(
      <JotaiProvider store={store}>
        <SessionDetailProvider paneId="pane-1">
          <SessionDetailView />
        </SessionDetailProvider>
      </JotaiProvider>,
      queryClient,
    );

    expect(await screen.findByRole("button", { name: "Edit session title" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "State Timeline" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Session inspector sections" })).toBeTruthy();
    expect(requestRepoNotes).toHaveBeenCalledWith("pane-1", expect.any(AbortSignal));
    expectSingleGitScopeObservers(queryClient);

    fireEvent.click(screen.getByRole("button", { name: "Toggle session quick panel" }));
    expect(screen.getByRole("button", { name: "Close quick panel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close quick panel" }));

    const inspectorSections = [
      ["Changes panel", "Changes"],
      ["Files panel", "File Navigator"],
      ["Commits panel", "Commit Log"],
      ["Notes panel", "Notes"],
    ] as const;

    for (const [tabName, headingName] of inspectorSections) {
      fireEvent.mouseDown(screen.getByRole("tab", { name: tabName }), { button: 0 });
      expect(screen.getByRole("heading", { name: headingName })).toBeTruthy();
    }

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Branches panel" }), { button: 0 });
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
    expectSingleGitScopeObservers(queryClient);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Worktrees panel" }), { button: 0 });
    expect(screen.getByTestId("worktree-section")).toBeTruthy();
    expectSingleGitScopeObservers(queryClient);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes panel" }), { button: 0 });
    expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();
    expectSingleGitScopeObservers(queryClient);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Branches panel" }), { button: 0 });
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
    expectSingleGitScopeObservers(queryClient);
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

  it("keeps one timeline observer polling while the mobile section is hidden", async () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    try {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: vi.fn((query: string) => ({
          matches: query === "(max-width: 767px)",
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
      const store = createStore();
      const queryClient = createAppQueryClient();
      const timelineQueryKey = sessionDetailQueryKeys.timeline("pane-1", {
        repoRoot: session.repoRoot,
        scope: "pane",
        range: "1h",
        limit: undefined,
      });

      renderWithRouter(
        <JotaiProvider store={store}>
          <SessionDetailProvider paneId="pane-1">
            <SessionDetailView />
          </SessionDetailProvider>
        </JotaiProvider>,
        queryClient,
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(requestStateTimeline).toHaveBeenCalledTimes(1);
      expect(requestStateTimeline).toHaveBeenLastCalledWith(
        "pane-1",
        { range: "1h" },
        expect.any(AbortSignal),
      );
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: timelineQueryKey, exact: true })
          ?.getObserversCount(),
      ).toBe(1);
      expectSingleGitScopeObservers(queryClient);

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Branches panel" }), { button: 0 });
      expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
      expectSingleGitScopeObservers(queryClient);

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Worktrees panel" }), { button: 0 });
      expect(screen.getByTestId("worktree-section")).toBeTruthy();
      expectSingleGitScopeObservers(queryClient);

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes panel" }), { button: 0 });
      expect(screen.queryByRole("heading", { name: "State Timeline" })).toBeNull();
      expect(requestStateTimeline).toHaveBeenCalledTimes(1);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: timelineQueryKey, exact: true })
          ?.getObserversCount(),
      ).toBe(1);
      expectSingleGitScopeObservers(queryClient);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(requestStateTimeline).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
      vi.useRealTimers();
    }
  });

  it("keeps the notes query mounted while polling only when the Notes section is visible", async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      const queryClient = createAppQueryClient();
      const repoRoot = session.repoRoot ?? "/repo";
      const note: RepoNote = {
        id: "note-1",
        repoRoot,
        title: null,
        body: "original body",
        createdAt: "2026-02-10T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      };
      requestRepoNotes.mockResolvedValue([note]);
      const notesQueryKey = sessionDetailQueryKeys.notes("pane-1", repoRoot);

      renderWithRouter(
        <JotaiProvider store={store}>
          <SessionDetailProvider paneId="pane-1">
            <SessionDetailView />
          </SessionDetailProvider>
        </JotaiProvider>,
        queryClient,
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(requestRepoNotes).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(notesQueryKey)).toEqual([note]);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: notesQueryKey, exact: true })
          ?.getObserversCount(),
      ).toBe(1);

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(requestRepoNotes).toHaveBeenCalledTimes(1);

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Notes panel" }), { button: 0 });
      await act(async () => {
        await Promise.resolve();
      });
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: notesQueryKey, exact: true })
          ?.getObserversCount(),
      ).toBe(1);

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(requestRepoNotes).toHaveBeenCalledTimes(3);

      fireEvent.click(screen.getByRole("button", { name: "Expand note note-1" }));
      fireEvent.click(screen.getByRole("button", { name: "Start editing note note-1" }));
      fireEvent.change(screen.getByLabelText("Edit note body note-1"), {
        target: { value: "unsaved draft" },
      });
      expect(screen.getByDisplayValue("unsaved draft")).toBeTruthy();
      expect(updateRepoNote).not.toHaveBeenCalled();

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes panel" }), { button: 0 });
      expect(screen.queryByLabelText("Edit note body note-1")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(requestRepoNotes).toHaveBeenCalledTimes(3);
      expect(updateRepoNote).not.toHaveBeenCalled();
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: notesQueryKey, exact: true })
          ?.getObserversCount(),
      ).toBe(1);

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Notes panel" }), { button: 0 });
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: "Expand note note-1" }));
      fireEvent.click(screen.getByRole("button", { name: "Start editing note note-1" }));
      expect((screen.getByLabelText("Edit note body note-1") as HTMLTextAreaElement).value).toBe(
        "original body",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
