import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { LaunchCommandResponse, SessionDetail } from "@vde-monitor/shared";
import type { MutableRefObject, ReactNode } from "react";
import type { VirtualizedViewportHandle } from "@/features/shared-session-ui/components/AnsiVirtualizedViewport";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { buildSessionGroups } from "@/lib/session-group";
import { ThemeProvider } from "@/state/theme-context";

import { useSessionDetailLayoutState } from "./hooks/useSessionDetailLayoutState";
import type { SessionDetailContextValue } from "./SessionDetailProvider";
import { SessionDetailView } from "./SessionDetailView";
import { createSessionDetail } from "./test-helpers";

const { sessionSidebarSpy } = vi.hoisted(() => ({ sessionSidebarSpy: vi.fn() }));

vi.mock("@/features/shared-session-ui/components/SessionSidebar", () => ({
  SessionSidebar: (props: unknown) => {
    sessionSidebarSpy(props);
    return <div data-testid="session-sidebar" />;
  },
}));

const defaultLaunchResponse: LaunchCommandResponse = {
  ok: true as const,
  result: {
    sessionName: "session",
    agent: "codex" as const,
    windowId: "@1",
    windowIndex: 1,
    windowName: "codex-work",
    paneId: "%1",
    launchedCommand: "codex" as const,
    resolvedOptions: [],
    verification: {
      status: "verified" as const,
      observedCommand: "codex",
      attempts: 1,
    },
  },
  rollback: { attempted: false, ok: true as const },
};

// SessionDetailView now reads SessionDetailContext + a handful of dedicated
// hooks directly instead of receiving one namespaced VM props object. These
// module-level mocks stand in for that context/hooks so the view can still be
// exercised as a pure function of "what state currently exists", the same way
// the old prop-based tests did.
let mockContextValue: SessionDetailContextValue;
let mockLayoutValue: ReturnType<typeof useSessionDetailLayoutState>;
const { timelineHookSpy } = vi.hoisted(() => ({ timelineHookSpy: vi.fn() }));

vi.mock("./SessionDetailProvider", () => ({
  useSessionDetailContext: () => mockContextValue,
}));

vi.mock("./SessionDetailCommitsProvider", () => ({
  ConnectedCommitSection: () => <h2>Commit Log</h2>,
}));

vi.mock("./SessionDetailContexts", () => ({
  useSessionDetailBase: () => mockContextValue.base,
  useSessionDetailHeaderActions: () => mockContextValue.logsActions.actions,
  useSessionDetailLogModal: () => mockContextValue.logsActions,
  useSessionDetailQuickPanel: () => mockContextValue.logsActions,
  useSessionDetailRepoPins: () => mockContextValue.repoPins,
  useSessionDetailSidebarActions: () => mockContextValue.logsActions.actions,
  useSessionDetailScope: () => mockContextValue.scope,
  useSessionDetailTerminal: () => mockContextValue.terminal,
}));

vi.mock("./hooks/useSessionDetailLayoutState", () => ({
  useSessionDetailLayoutState: () => mockLayoutValue,
}));

vi.mock("./hooks/useSessionTitleEditor", () => ({
  useSessionTitleEditor: () => ({
    titleDraft: "",
    titleEditing: false,
    titleSaving: false,
    titleError: null,
    openTitleEditor: vi.fn(),
    closeTitleEditor: vi.fn(),
    updateTitleDraft: vi.fn(),
    saveTitle: vi.fn(),
    resetTitle: vi.fn(),
  }),
}));

vi.mock("./hooks/useSessionRepoNotes", () => ({
  useSessionRepoNotes: () => ({
    notes: [],
    notesLoading: false,
    notesError: null,
    creatingNote: false,
    savingNoteId: null,
    deletingNoteId: null,
    refreshNotes: vi.fn(),
    createNote: vi.fn(async () => true),
    saveNote: vi.fn(async () => true),
    removeNote: vi.fn(async () => true),
  }),
}));

vi.mock("./hooks/useSessionTimeline", () => ({
  useSessionTimeline: () => {
    timelineHookSpy();
    return {
      timeline: null,
      timelineScope: "pane",
      timelineRange: "1h",
      hasRepoTimeline: true,
      timelineError: null,
      timelineLoading: false,
      timelineExpanded: true,
      setTimelineScope: vi.fn(),
      setTimelineRange: vi.fn(),
      toggleTimelineExpanded: vi.fn(),
      refreshTimeline: vi.fn(),
    };
  },
}));

const DETAIL_SECTION_TAB_STORAGE_KEY = "vde-monitor-session-detail-section-tab";
const CLOSE_DETAIL_TAB_VALUE = "__close__";
const SECTION_TAB_STORAGE_REPO_FALLBACK = "__unknown_repo__";
const SECTION_TAB_STORAGE_BRANCH_FALLBACK = "__no_branch__";

const buildSectionTabStorageKey = (scope: { branch?: null | string; repoRoot?: null | string }) =>
  `${DETAIL_SECTION_TAB_STORAGE_KEY}:${encodeURIComponent(scope.repoRoot ?? SECTION_TAB_STORAGE_REPO_FALLBACK)}:${encodeURIComponent(scope.branch ?? SECTION_TAB_STORAGE_BRANCH_FALLBACK)}`;

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
  return render(
    <RouterContextProvider router={router}>
      <ThemeProvider>{ui}</ThemeProvider>
    </RouterContextProvider>,
  );
};

const buildDefaultLayoutValue = () => {
  return {
    is2xlUp: false,
    isMobile: false,
    sidebarWidth: 240,
    handleSidebarPointerDown: vi.fn(),
    detailSplitRatio: 0.5,
    detailSplitRef: { current: null } as MutableRefObject<HTMLDivElement | null>,
    handleDetailSplitPointerDown: vi.fn(),
  } satisfies ReturnType<typeof useSessionDetailLayoutState>;
};

const buildDefaultContextValue = () => {
  return {
    base: {
      paneId: "pane-1",
      session: null as SessionDetail | null,
      nowMs: 0,
      connected: false,
      hasLoadedInitialSessions: false,
      connectionStatus: "healthy" as const,
      connectionIssue: null as string | null,
      highlightCorrections: { codex: true, claude: true },
      fileNavigatorConfig: { autoExpandMatchLimit: 100 },
      launchConfig: {
        agents: {
          codex: { options: [] },
          claude: { options: [] },
        },
      },
      capabilities: {
        screenImage: true,
        launchAgent: true,
        resumeAgent: true,
      },
      resolvedTheme: "latte" as const,
      sessions: [] as SessionDetail[],
      token: null,
      apiBaseUrl: null,
      requestWorktrees: vi.fn(async () => ({ repoRoot: null, currentPath: null, entries: [] })),
      requestStateTimeline: vi.fn(),
      requestPromptCompletions: vi.fn(async () => ({ items: [] })),
      requestScreen: vi.fn(),
      requestBranches: vi.fn(),
      requestBranchCheckout: vi.fn(),
      requestBranchCreate: vi.fn(),
      requestBranchDelete: vi.fn(),
      requestDiffSummary: vi.fn(),
      requestDiffFile: vi.fn(),
      requestCommitLog: vi.fn(),
      requestCommitDetail: vi.fn(),
      requestCommitFile: vi.fn(),
      requestRepoNotes: vi.fn(),
      requestRepoFileTree: vi.fn(),
      requestRepoFileSearch: vi.fn(),
      requestRepoFileContent: vi.fn(),
      revokeRepoFilePreview: vi.fn(async () => undefined),
      focusPane: vi.fn(),
      killPane: vi.fn(),
      killWindow: vi.fn(),
      refreshSessions: vi.fn(),
      launchAgentInSession: vi.fn(async () => defaultLaunchResponse),
      uploadImageAttachment: vi.fn(),
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(),
      touchSession: vi.fn(),
      moveSessionToTop: vi.fn(),
      acknowledgeSessionView: vi.fn(async () => undefined),
      updateSessionTitle: vi.fn(),
      resetSessionTitle: vi.fn(),
      createRepoNote: vi.fn(),
      updateRepoNote: vi.fn(),
      deleteRepoNote: vi.fn(),
    },
    repoPins: {
      sessionGroups: buildSessionGroups([]),
      getRepoSortAnchorAt: () => null,
      touchRepoSortAnchor: vi.fn(),
    },
    scope: {
      virtualWorktree: {
        selectorEnabled: false,
        loading: false,
        error: null as string | null,
        repoRoot: null as string | null,
        baseBranch: null as string | null,
        entries: [],
        actualWorktreePath: null as string | null,
        virtualWorktreePath: null as string | null,
        effectiveWorktreePath: null as string | null,
        effectiveBranch: null as string | null,
        clearVirtualWorktree: vi.fn(),
        refreshWorktrees: vi.fn(),
      },
      branches: {
        branches: [],
        repoRoot: null as string | null,
        defaultBranch: null as string | null,
        currentBranch: null as string | null,
        branchesLoading: false,
        branchesError: null as string | null,
        mutating: null,
        mutationError: null as string | null,
        clearMutationError: vi.fn(),
        refreshBranches: vi.fn(),
      },
      virtualBranch: {
        virtualBranch: null as string | null,
        clearVirtualBranch: vi.fn(),
      },
      effectiveBranchScope: null as string | null,
      effectiveWorktreeScope: null as string | null,
      selectVirtualBranch: vi.fn(),
      selectVirtualWorktree: vi.fn(),
      checkoutBranch: vi.fn(async () => true),
      createBranch: vi.fn(async () => true),
      deleteBranch: vi.fn(async () => true),
    },
    diffs: {
      diffSummary: null,
      diffError: null,
      diffLoading: false,
      diffFiles: {},
      diffOpen: {},
      diffLoadingFiles: {},
      diffMode: "total" as const,
      setDiffMode: vi.fn(),
      refreshDiff: vi.fn(),
      toggleDiff: vi.fn(),
      ensureDiffFile: vi.fn(),
    },
    files: {
      unavailable: false,
      selectedFilePath: null,
      searchQuery: "",
      searchActiveIndex: 0,
      searchResult: null,
      searchLoading: false,
      searchError: null,
      searchMode: "all-matches",
      treeLoading: false,
      treeError: null,
      treeNodes: [],
      rootTreeHasMore: false,
      searchHasMore: false,
      fileModalOpen: false,
      fileModalPath: null,
      fileModalLoading: false,
      fileModalError: null,
      fileModalFile: null,
      fileModalMarkdownViewMode: "code",
      fileModalShowLineNumbers: false,
      fileModalCopiedPath: false,
      fileModalCopyError: null,
      fileModalHighlightLine: null,
      fileResolveError: null,
      logFileCandidateModalOpen: false,
      logFileCandidateReference: null,
      logFileCandidatePaneId: null,
      logFileCandidateItems: [],
      onRefresh: vi.fn(),
      onSearchQueryChange: vi.fn(),
      onSearchMove: vi.fn(),
      onSearchConfirm: vi.fn(),
      onToggleDirectory: vi.fn(),
      onSelectFile: vi.fn(),
      onOpenFileModal: vi.fn(),
      onCloseFileModal: vi.fn(),
      onSetFileModalMarkdownViewMode: vi.fn(),
      onToggleFileModalLineNumbers: vi.fn(),
      onCopyFileModalPath: vi.fn(),
      onResolveLogFileReference: vi.fn(async () => undefined),
      onResolveLogFileReferenceCandidates: vi.fn(async () => []),
      onSelectLogFileCandidate: vi.fn(),
      onCloseLogFileCandidateModal: vi.fn(),
      onLoadMoreTreeRoot: vi.fn(),
      onLoadMoreSearch: vi.fn(),
    },
    logsActions: {
      logs: {
        quickPanelOpen: false,
        logModalOpen: false,
        selectedPaneId: null,
        selectedSession: null,
        selectedLogLines: [],
        selectedLogLoading: false,
        selectedLogError: null,
        openLogModal: vi.fn(),
        closeLogModal: vi.fn(),
        toggleQuickPanel: vi.fn(),
        closeQuickPanel: vi.fn(),
      },
      actions: {
        handleOpenPaneInNewWindow: vi.fn(),
        handleOpenInNewTab: vi.fn(),
        handleFocusPane: vi.fn(),
        handleOpenPaneHere: vi.fn(),
        handleOpenHere: vi.fn(),
        handleTouchRepoPin: vi.fn(),
        handleLaunchAgentInSession: vi.fn(async () => defaultLaunchResponse),
        handleTouchCurrentSession: vi.fn(),
        handleTouchPaneSortAnchor: vi.fn(),
      },
    },
    terminal: {
      screen: {
        mode: "text",
        wrapMode: "off",
        screenLines: [] as string[],
        imageBase64: null,
        fallbackReason: null,
        error: null as string | null,
        pollingPauseReason: null,
        transport: "polling",
        setScreenError: vi.fn(),
        isScreenLoading: false,
        isAtBottom: true,
        handleAtBottomChange: vi.fn(),
        handleUserScrollStateChange: vi.fn(),
        shouldFollowOutput: true,
        refreshScreen: vi.fn(),
        scrollToBottom: vi.fn(),
        handleModeChange: vi.fn(),
        toggleWrapMode: vi.fn(),
        viewportRef: { current: null } as MutableRefObject<VirtualizedViewportHandle | null>,
        scrollerRef: { current: null } as MutableRefObject<HTMLDivElement | null>,
      },
      controls: {
        textInputRef: { current: null } as MutableRefObject<HTMLTextAreaElement | null>,
        autoEnter: false,
        shiftHeld: false,
        ctrlHeld: false,
        rawMode: false,
        allowDangerKeys: false,
        isSendingText: false,
        sendError: null,
        handleSendKey: vi.fn(),
        handleSendPermissionShortcut: vi.fn(),
        handleKillPane: vi.fn(),
        handleKillWindow: vi.fn(),
        handleSendText: vi.fn(),
        handleUploadImage: vi.fn(),
        handleRawBeforeInput: vi.fn(),
        handleRawInput: vi.fn(),
        handleRawKeyDown: vi.fn(),
        handleRawCompositionStart: vi.fn(),
        handleRawCompositionEnd: vi.fn(),
        toggleAutoEnter: vi.fn(),
        toggleShift: vi.fn(),
        toggleCtrl: vi.fn(),
        toggleRawMode: vi.fn(),
        toggleAllowDangerKeys: vi.fn(),
      },
      handleRefreshScreen: vi.fn(),
    },
    pushNotifications: {
      status: "idle",
      pushEnabled: true,
      isSubscribed: false,
      isPaneEnabled: false,
      errorMessage: null as string | null,
      requestPermissionAndSubscribe: vi.fn(async () => undefined),
      disableNotifications: vi.fn(async () => undefined),
      togglePaneEnabled: vi.fn(async () => undefined),
    },
  } satisfies SessionDetailContextValue;
};

type SessionDetailViewOverrides = {
  meta?: {
    session?: SessionDetail | null;
    connected?: boolean;
    hasLoadedInitialSessions?: boolean;
    connectionIssue?: string | null;
  };
  timeline?: { isMobile?: boolean; detailSplitRatio?: number };
  screen?: { worktreeSelectorEnabled?: boolean };
};

// Rebuilds the mocked SessionDetailContext + layout state consumed by
// SessionDetailView for each test. Kept as a drop-in replacement for the old
// prop-object builder so individual `it()` bodies (which only ever override
// meta/timeline/screen) did not need to change.
const createViewProps = (overrides: SessionDetailViewOverrides = {}) => {
  mockContextValue = buildDefaultContextValue();
  mockLayoutValue = buildDefaultLayoutValue();

  if (overrides.meta) {
    Object.assign(mockContextValue.base, overrides.meta);
  }
  if (overrides.timeline?.isMobile !== undefined) {
    mockLayoutValue.isMobile = overrides.timeline.isMobile;
  }
  if (overrides.timeline?.detailSplitRatio !== undefined) {
    mockLayoutValue.detailSplitRatio = overrides.timeline.detailSplitRatio;
  }
  if (overrides.screen?.worktreeSelectorEnabled !== undefined) {
    mockContextValue.scope.virtualWorktree.selectorEnabled =
      overrides.screen.worktreeSelectorEnabled;
  }

  return {};
};

describe("SessionDetailView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    timelineHookSpy.mockClear();
    sessionSidebarSpy.mockClear();
  });

  it("renders not found state when session remains missing", () => {
    vi.useFakeTimers();
    try {
      const props = createViewProps({
        meta: { session: null, connected: true, hasLoadedInitialSessions: true },
      });
      renderWithRouter(<SessionDetailView {...props} />);

      expect(screen.getByText("Loading session...")).toBeTruthy();
      expect(screen.getByTestId("session-detail-loading-skeleton")).toBeTruthy();
      expect(screen.getByTestId("session-detail-loading-header")).toBeTruthy();
      expect(screen.getByTestId("session-detail-loading-top")).toBeTruthy();
      expect(screen.queryByLabelText("Toggle session quick panel")).toBeNull();
      expect(sessionSidebarSpy).not.toHaveBeenCalled();
      const loadingStatus = screen.getByRole("status");
      const loadingSkeleton = screen.getByTestId("session-detail-loading-skeleton");
      expect(loadingSkeleton.getAttribute("aria-busy")).toBe("true");
      expect(loadingSkeleton.contains(loadingStatus)).toBe(false);
      expect(loadingStatus.querySelector("a, button")).toBeNull();
      expect(screen.getByRole("tablist", { name: "Theme selection" })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(screen.getByText("Session not found.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Back to list" })).toBeTruthy();
      expect(document.title).toBe("VDE Monitor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps showing loading while initial session fetch is in progress", () => {
    const props = createViewProps({
      meta: { session: null, connected: false, connectionIssue: null },
      timeline: { detailSplitRatio: 0.6 },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("Loading session...")).toBeTruthy();
    expect(screen.getByTestId("session-detail-loading-skeleton")).toBeTruthy();
    expect(screen.getByTestId("session-detail-loading-header")).toBeTruthy();
    expect(screen.getByTestId("session-detail-loading-top")).toBeTruthy();
    const loadingStatus = screen.getByRole("status");
    const loadingSkeleton = screen.getByTestId("session-detail-loading-skeleton");
    expect(loadingSkeleton.getAttribute("aria-busy")).toBe("true");
    expect(loadingSkeleton.contains(loadingStatus)).toBe(false);
    expect(screen.getByTestId("session-detail-loading-top").className).toContain("2xl:flex-row");
    expect(
      screen
        .getByTestId("session-detail-loading-primary-column")
        .style.getPropertyValue("--detail-split-basis"),
    ).toBe("60%");
    expect(screen.getByRole("tablist", { name: "Theme selection" })).toBeTruthy();
    expect(screen.queryByText("Session not found.")).toBeNull();
  });

  it("shows authentication error in missing-session state", () => {
    const props = createViewProps({
      meta: { session: null, connectionIssue: API_ERROR_MESSAGES.unauthorized },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("Authentication error.")).toBeTruthy();
    expect(screen.getByText(API_ERROR_MESSAGES.unauthorized)).toBeTruthy();
    expect(screen.queryByText("Session not found.")).toBeNull();
  });

  it("shows configuration error cause in missing-session state", () => {
    const cause =
      "invalid config: /tmp/.config/vde/monitor/config.yml activity.pollIntervalMs Invalid input: expected number, received string";
    const props = createViewProps({
      meta: { session: null, connectionIssue: `Request failed (500)\nError cause: ${cause}` },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("Configuration error on server.")).toBeTruthy();
    expect(screen.getByText("Request failed (500)")).toBeTruthy();
    expect(screen.getByText(`Error cause: ${cause}`)).toBeTruthy();
    expect(screen.queryByText("Session not found.")).toBeNull();
  });

  it("renders the terminal with a single desktop inspector section", () => {
    const props = createViewProps({
      meta: { session: createSessionDetail() },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByRole("button", { name: "Edit session title" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeTruthy();
    const sidebarCall = sessionSidebarSpy.mock.lastCall;
    expect(sidebarCall).toBeDefined();
    if (sidebarCall == null) {
      throw new Error("SessionSidebar was not rendered");
    }
    expect((sidebarCall[0] as { state: { sidebarWidth: number } }).state.sidebarWidth).toBe(240);
    expect(screen.getByRole("tab", { name: "Text" })).toBeTruthy();
    expect(screen.getByText("State Timeline")).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Session inspector sections" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Changes panel" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "File Navigator" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Commit Log" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Branches" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Worktrees" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Notes" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Timeline panel" })).toBeNull();
    expect(screen.getByLabelText("Toggle session quick panel")).toBeTruthy();
    expect(document.title).toBe("Session Title - VDE Monitor");
  });

  it("switches desktop inspector sections without rendering every panel", () => {
    const props = createViewProps({
      meta: { session: createSessionDetail() },
      timeline: { isMobile: false },
      screen: { worktreeSelectorEnabled: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Commits panel" }), { button: 0 });
    expect(screen.getByRole("heading", { name: "Commit Log" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Changes" })).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Worktrees panel" }), { button: 0 });
    expect(screen.getByRole("heading", { name: "Worktrees" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Commit Log" })).toBeNull();
  });

  it("switches section by icon tabs and stores selected tab", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const storageKey = buildSectionTabStorageKey({
      repoRoot: session.repoRoot,
      branch: session.branch,
    });
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(timelineHookSpy).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes panel" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Changes panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(window.localStorage.getItem(storageKey)).toBe("changes");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files panel" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Files panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(window.localStorage.getItem(storageKey)).toBe("file");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Commits panel" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Commits panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(window.localStorage.getItem(storageKey)).toBe("commits");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Worktrees panel" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Worktrees panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(window.localStorage.getItem(storageKey)).toBe("worktrees");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Keys panel" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Keys panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(window.localStorage.getItem(storageKey)).toBe("keys");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notes panel" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Notes panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(window.localStorage.getItem(storageKey)).toBe("notes");
    expect(timelineHookSpy).toHaveBeenCalledTimes(1);
  });

  it("lays out mobile section tabs in two rows with notes on first row", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByRole("tab", { name: "Keys panel" }).className).toContain("row-start-1");
    expect(screen.getByRole("tab", { name: "Keys panel" }).className).toContain("col-start-1");

    expect(screen.getByRole("tab", { name: "Timeline panel" }).className).toContain("row-start-1");
    expect(screen.getByRole("tab", { name: "Timeline panel" }).className).toContain("col-start-2");

    expect(screen.getByRole("tab", { name: "Files panel" }).className).toContain("row-start-1");
    expect(screen.getByRole("tab", { name: "Files panel" }).className).toContain("col-start-3");

    expect(screen.getByRole("tab", { name: "Notes panel" }).className).toContain("row-start-1");
    expect(screen.getByRole("tab", { name: "Notes panel" }).className).toContain("col-start-4");

    expect(screen.getByRole("tab", { name: "Changes panel" }).className).toContain("row-start-2");
    expect(screen.getByRole("tab", { name: "Changes panel" }).className).toContain("col-start-1");

    expect(screen.getByRole("tab", { name: "Commits panel" }).className).toContain("row-start-2");
    expect(screen.getByRole("tab", { name: "Commits panel" }).className).toContain("col-start-2");

    expect(screen.getByRole("tab", { name: "Branches panel" }).className).toContain("row-start-2");
    expect(screen.getByRole("tab", { name: "Branches panel" }).className).toContain("col-start-3");

    expect(screen.getByRole("tab", { name: "Worktrees panel" }).className).toContain("row-start-2");
    expect(screen.getByRole("tab", { name: "Worktrees panel" }).className).toContain("col-start-4");
  });

  it("restores last selected tab from localStorage", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const storageKey = buildSectionTabStorageKey({
      repoRoot: session.repoRoot,
      branch: session.branch,
    });
    window.localStorage.setItem(storageKey, "file");
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("File Navigator")).toBeTruthy();
    expect(screen.queryByText("State Timeline")).toBeNull();
  });

  it("restores worktrees tab from localStorage", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const storageKey = buildSectionTabStorageKey({
      repoRoot: session.repoRoot,
      branch: session.branch,
    });
    window.localStorage.setItem(storageKey, "worktrees");
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByTestId("worktree-section")).toBeTruthy();
    expect(screen.getByText("Worktree selector is not available for this session.")).toBeTruthy();
    expect(screen.queryByText("State Timeline")).toBeNull();
  });

  it("hides section panels when close tab is selected", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const storageKey = buildSectionTabStorageKey({
      repoRoot: session.repoRoot,
      branch: session.branch,
    });
    window.localStorage.setItem(storageKey, "timeline");
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("State Timeline")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Close detail sections" }), {
      button: 0,
    });

    expect(screen.queryByText("State Timeline")).toBeNull();
    expect(screen.queryByText("File Navigator")).toBeNull();
    expect(screen.queryByText("Commit Log")).toBeNull();
    expect(screen.queryByText("No notes yet")).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe(CLOSE_DETAIL_TAB_VALUE);
  });

  it("restores close tab state from localStorage", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const storageKey = buildSectionTabStorageKey({
      repoRoot: session.repoRoot,
      branch: session.branch,
    });
    window.localStorage.setItem(storageKey, CLOSE_DETAIL_TAB_VALUE);
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.queryByText("State Timeline")).toBeNull();
    expect(screen.queryByText("File Navigator")).toBeNull();
    expect(screen.queryByText("Commit Log")).toBeNull();
    expect(screen.queryByText("No notes yet")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Close detail sections" }).getAttribute("data-state"),
    ).toBe("active");
  });

  it("ignores close tab state on non-mobile layouts", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const storageKey = buildSectionTabStorageKey({
      repoRoot: session.repoRoot,
      branch: session.branch,
    });
    window.localStorage.setItem(storageKey, CLOSE_DETAIL_TAB_VALUE);
    const props = createViewProps({
      meta: { session },
      timeline: { isMobile: false },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("State Timeline")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "File Navigator" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Commit Log" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Notes" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Close detail sections" })).toBeNull();
  });

  it("stores mobile tab selection independently per repo branch", () => {
    const mainSession = createSessionDetail({ repoRoot: "/Users/test/repo-a", branch: "main" });
    const featureSession = createSessionDetail({
      repoRoot: "/Users/test/repo-a",
      branch: "feature/mobile-tabs",
    });
    const mainStorageKey = buildSectionTabStorageKey({
      repoRoot: mainSession.repoRoot,
      branch: mainSession.branch,
    });
    const featureStorageKey = buildSectionTabStorageKey({
      repoRoot: featureSession.repoRoot,
      branch: featureSession.branch,
    });

    const mainProps = createViewProps({
      meta: { session: mainSession },
      timeline: { isMobile: true },
    });
    const firstRender = renderWithRouter(<SessionDetailView {...mainProps} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes panel" }), { button: 0 });
    expect(window.localStorage.getItem(mainStorageKey)).toBe("changes");
    firstRender.unmount();

    const featureProps = createViewProps({
      meta: { session: featureSession },
      timeline: { isMobile: true },
    });
    renderWithRouter(<SessionDetailView {...featureProps} />);

    expect(screen.getByRole("tab", { name: "Timeline panel" }).getAttribute("data-state")).toBe(
      "active",
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files panel" }), { button: 0 });
    expect(window.localStorage.getItem(featureStorageKey)).toBe("file");
    expect(window.localStorage.getItem(mainStorageKey)).toBe("changes");
  });
});
