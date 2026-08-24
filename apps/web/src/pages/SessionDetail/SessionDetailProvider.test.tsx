import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { type ReactNode, memo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { ConnectedNotesSection } from "./components/NotesSection";
import { ConnectedControlsPanel } from "./components/session-shell/ConnectedControlsPanel";
import { useSessionDetailVMState } from "./hooks/useSessionDetailVMState";
import {
  type SessionContextMockOverrides,
  createSessionBranchesApiMock,
  createSessionConfigDataMock,
  createSessionCoreApiMock,
  createSessionFilesApiMock,
  createSessionLaunchApiMock,
  createSessionNotesApiMock,
  createSessionStreamDataMock,
} from "./session-context-mock";
import { SessionDetailProvider, useSessionDetailContext } from "./SessionDetailProvider";
import { useSessionDetailCommits } from "./SessionDetailCommitsProvider";
import {
  useSessionDetailBase,
  useSessionDetailHeaderActions,
  useSessionDetailLogModal,
  useSessionDetailQuickPanel,
  useSessionDetailRepoPins,
  useSessionDetailScope,
  useSessionDetailSidebarActions,
  useSessionDetailTerminal,
} from "./SessionDetailContexts";
import { SessionDetailNotesProvider } from "./SessionDetailNotesProvider";
import { SessionDetailTitleProvider, useSessionDetailTitle } from "./SessionDetailTitleProvider";
import { sessionDetailQueryKeys } from "./session-detail-query-keys";
import { COMMIT_PAGE_SIZE } from "./sessionDetailUtils";
import { createSessionDetail } from "./test-helpers";

const session = createSessionDetail({ paneId: "pane-1" });
const sessionGroups = [{ repoRoot: null, sessions: [session] }];
const setScreenErrorMock = vi.fn();
const pushNotificationsRenderSpy = vi.fn();
let mockResolvedTheme: "latte" | "mocha" = "mocha";
let mockSessionsContext: Record<string, unknown> = {};
const navigateMock = vi.hoisted(() => vi.fn());

const QueryTestProvider = ({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: ReturnType<typeof createAppQueryClient>;
}) => {
  const [defaultQueryClient] = useState(createAppQueryClient);
  return (
    <QueryClientProvider client={queryClient ?? defaultQueryClient}>{children}</QueryClientProvider>
  );
};

// Mirrors use-session-store.ts's real toSessionDetail cache: the same
// underlying session object reference must resolve to the same "detail" view
// reference across repeated getSessionDetail calls. Without this, `.find()`
// alone happens to already return a stable reference (since it's just an
// array lookup), which would make it impossible for this mock to ever
// exhibit -- or guard against -- the "getSessionDetail returns a fresh
// object on every call" bug that real production has without its own cache.
const sessionDetailViewCache = new WeakMap<typeof session, typeof session>();
const toMockSessionDetail = (source: typeof session) => {
  const cached = sessionDetailViewCache.get(source);
  if (cached) {
    return cached;
  }
  const detail = { ...source };
  sessionDetailViewCache.set(source, detail);
  return detail;
};

// Only the API-domain slices (core/branches/files/notes/launch) are
// caller-configurable here; stream/config are always derived from
// sessions/connected/connectionIssue in buildSessionContext below.
type SessionApiMockOverrides = Pick<
  SessionContextMockOverrides,
  "core" | "branches" | "files" | "notes" | "launch"
>;

// Resolves defaults + overrides into a single flat object *once*. Callers
// that need identical function references across repeated buildSessionContext
// calls within one test (see the T15a re-render-suppression case below) must
// build this once and reuse it, rather than re-resolving per render -- each
// call to the create*Mock factories mints fresh vi.fn() for any field the
// caller didn't override.
const buildSessionApi = (overrides: SessionApiMockOverrides = {}) => ({
  ...createSessionCoreApiMock(overrides.core),
  ...createSessionBranchesApiMock({
    requestDiffSummary: vi.fn(async () => ({
      repoRoot: session.repoRoot,
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      files: [],
    })),
    requestCommitLog: vi.fn(async () => ({
      repoRoot: session.repoRoot,
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
      totalCount: 0,
    })),
    ...overrides.branches,
  }),
  ...createSessionFilesApiMock(overrides.files),
  ...createSessionNotesApiMock(overrides.notes),
  ...createSessionLaunchApiMock(overrides.launch),
});

const buildSessionContext = ({
  sessions,
  sessionApi,
  connected = true,
  connectionIssue = null,
}: {
  sessions: Array<typeof session>;
  sessionApi: ReturnType<typeof buildSessionApi>;
  connected?: boolean;
  connectionIssue?: string | null;
}) => ({
  ...createSessionConfigDataMock(),
  ...createSessionStreamDataMock({
    sessions,
    connected,
    connectionStatus: connected ? "healthy" : "degraded",
    connectionIssue,
    getSessionDetail: (paneId: string) => {
      const found = sessions.find((item) => item.paneId === paneId) ?? null;
      return found ? toMockSessionDetail(found) : null;
    },
  }),
  ...sessionApi,
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/state/session-context", () => ({
  useSessionStreamData: () => mockSessionsContext,
  useSessionConfigData: () => mockSessionsContext,
  useSessionCoreApi: () => mockSessionsContext,
  useSessionBranchesApi: () => mockSessionsContext,
  useSessionFilesApi: () => mockSessionsContext,
  useSessionNotesApi: () => mockSessionsContext,
  useSessionLaunchApi: () => mockSessionsContext,
}));

vi.mock("@/state/theme-context", () => ({
  useTheme: () => ({
    preference: "system",
    resolvedTheme: mockResolvedTheme,
    setPreference: vi.fn(),
  }),
}));

vi.mock("@/features/notifications/use-push-notifications", () => ({
  usePushNotifications: ({ paneId }: { paneId: string }) => {
    pushNotificationsRenderSpy(paneId);
    return {
      status: "idle",
      pushEnabled: true,
      isSubscribed: false,
      isPaneEnabled: false,
      errorMessage: null,
      requestPermissionAndSubscribe: vi.fn(async () => undefined),
      disableNotifications: vi.fn(async () => undefined),
      togglePaneEnabled: vi.fn(async () => undefined),
    };
  },
}));

vi.mock("@/lib/session-group", () => ({
  buildSessionGroups: vi.fn(() => sessionGroups),
}));

vi.mock("./hooks/useSessionScreen", () => ({
  useSessionScreen: () => ({
    mode: "text",
    wrapMode: "off",
    screenLines: ["line"],
    imageBase64: null,
    fallbackReason: null,
    error: null,
    pollingPauseReason: null,
    setScreenError: setScreenErrorMock,
    isScreenLoading: false,
    isAtBottom: true,
    handleAtBottomChange: vi.fn(),
    handleUserScrollStateChange: vi.fn(),
    shouldFollowOutput: true,
    refreshScreen: vi.fn(),
    scrollToBottom: vi.fn(),
    handleModeChange: vi.fn(),
    toggleWrapMode: vi.fn(),
    viewportRef: { current: null },
    scrollerRef: { current: null },
  }),
}));

// Counts how many times NotesSection's own function body actually executes
// (as opposed to how many times its parent re-renders). useNotesPolling is
// called unconditionally at the top of NotesSection, so replacing it with a
// counting stub gives a reliable signal for "did NotesSection's memo bail?"
// without relying on ambiguous Profiler semantics.
let notesPollingCallCount = 0;
vi.mock("./hooks/useNotesPolling", () => ({
  useNotesPolling: () => {
    notesPollingCallCount += 1;
  },
}));

let sessionControlsCallCount = 0;
const sessionControlsMockValue = {
  textInputRef: { current: null },
  autoEnter: true,
  shiftHeld: false,
  ctrlHeld: false,
  rawMode: false,
  allowDangerKeys: false,
  isSendingText: false,
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
};
vi.mock("./hooks/useSessionControls", () => ({
  useSessionControls: () => {
    sessionControlsCallCount += 1;
    return sessionControlsMockValue;
  },
}));

// Renders NotesSection through the dedicated notes controller exactly the way
// SessionDetailView does, so the memo-effectiveness of the connected boundary
// is exercised.
const NotesProbe = () => {
  return (
    <SessionDetailNotesProvider>
      <ConnectedNotesSection />
    </SessionDetailNotesProvider>
  );
};

const PaneLifetimeProbe = ({ paneId }: { paneId: string }) => {
  const [mountedPaneId] = useState(paneId);
  return <div data-testid="pane-lifetime" data-mounted-pane-id={mountedPaneId} />;
};

const shellSliceRenderSpy = vi.fn();
const ShellSliceProbe = memo(() => {
  const terminal = useSessionDetailTerminal();
  const quickPanel = useSessionDetailQuickPanel();
  const logModal = useSessionDetailLogModal();
  const headerActions = useSessionDetailHeaderActions();
  const sidebarActions = useSessionDetailSidebarActions();
  shellSliceRenderSpy({ terminal, quickPanel, logModal, headerActions, sidebarActions });
  return null;
});
ShellSliceProbe.displayName = "ShellSliceProbe";

const scopeSliceRenderSpy = vi.fn();
const ScopeSliceProbe = memo(() => {
  scopeSliceRenderSpy(useSessionDetailScope());
  return null;
});
ScopeSliceProbe.displayName = "ScopeSliceProbe";

const commitsSliceRenderSpy = vi.fn();
const CommitsSliceProbe = memo(() => {
  commitsSliceRenderSpy(useSessionDetailCommits());
  return null;
});
CommitsSliceProbe.displayName = "CommitsSliceProbe";

const FilesTickProbe = () => {
  const { files } = useSessionDetailContext();
  return (
    <button type="button" onClick={() => files.onSearchQueryChange("unrelated-file-tick")}>
      Tick files
    </button>
  );
};

const TitleProbe = () => {
  const title = useSessionDetailTitle();
  return (
    <>
      <div data-testid="title-state">
        {title.titleEditing ? "editing" : "closed"}:{title.titleDraft}
      </div>
      <button type="button" onClick={title.openTitleEditor}>
        Edit title
      </button>
      <button type="button" onClick={() => title.updateTitleDraft("Unsaved draft")}>
        Change draft
      </button>
    </>
  );
};

const renderContext = (
  sessions: Array<typeof session>,
  sessionApi: SessionApiMockOverrides,
  options: { connected?: boolean; connectionIssue?: string | null } = {},
) => {
  const store = createStore();
  const queryClient = createAppQueryClient();
  mockSessionsContext = buildSessionContext({
    sessions,
    sessionApi: buildSessionApi(sessionApi),
    connected: options.connected ?? true,
    connectionIssue: options.connectionIssue ?? null,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryTestProvider queryClient={queryClient}>
      <JotaiProvider store={store}>
        <SessionDetailProvider paneId="pane-1">{children}</SessionDetailProvider>
      </JotaiProvider>
    </QueryTestProvider>
  );
  return { ...renderHook(() => useSessionDetailContext(), { wrapper }), queryClient };
};

describe("SessionDetailProvider", () => {
  it("renders children", () => {
    mockSessionsContext = buildSessionContext({
      sessions: [session],
      sessionApi: buildSessionApi(),
    });
    render(
      <SessionDetailProvider paneId="pane-1">
        <div data-testid="child">child</div>
      </SessionDetailProvider>,
      { wrapper: QueryTestProvider },
    );

    expect(screen.getByTestId("child").textContent).toBe("child");
  });

  it("owns one controls controller for multiple connected controls presentations", () => {
    mockSessionsContext = buildSessionContext({
      sessions: [session],
      sessionApi: buildSessionApi(),
      connected: false,
    });
    sessionControlsCallCount = 0;

    const baseline = render(
      <SessionDetailProvider paneId="pane-1">
        <div />
      </SessionDetailProvider>,
      { wrapper: QueryTestProvider },
    );
    const providerCallCount = sessionControlsCallCount;
    baseline.unmount();
    sessionControlsCallCount = 0;

    render(
      <SessionDetailProvider paneId="pane-1">
        <ConnectedControlsPanel showComposerSection={false} />
        <ConnectedControlsPanel showKeysSection={false} />
      </SessionDetailProvider>,
      { wrapper: QueryTestProvider },
    );

    expect(providerCallCount).toBeGreaterThan(0);
    expect(sessionControlsCallCount).toBe(providerCallCount);
  });

  it("remounts pane-owned children while keeping push notification ownership outside", () => {
    const pane2 = createSessionDetail({ paneId: "pane-2" });
    mockSessionsContext = buildSessionContext({
      sessions: [session, pane2],
      sessionApi: buildSessionApi(),
    });
    pushNotificationsRenderSpy.mockClear();

    const view = render(
      <SessionDetailProvider paneId="pane-1">
        <PaneLifetimeProbe paneId="pane-1" />
      </SessionDetailProvider>,
      { wrapper: QueryTestProvider },
    );
    expect(screen.getByTestId("pane-lifetime").dataset.mountedPaneId).toBe("pane-1");

    view.rerender(
      <SessionDetailProvider paneId="pane-2">
        <PaneLifetimeProbe paneId="pane-2" />
      </SessionDetailProvider>,
    );
    expect(screen.getByTestId("pane-lifetime").dataset.mountedPaneId).toBe("pane-2");

    view.rerender(
      <SessionDetailProvider paneId="pane-1">
        <PaneLifetimeProbe paneId="pane-1" />
      </SessionDetailProvider>,
    );
    expect(screen.getByTestId("pane-lifetime").dataset.mountedPaneId).toBe("pane-1");
    expect(pushNotificationsRenderSpy.mock.calls.map(([paneId]) => paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-1",
    ]);
  });

  it("exposes base state via context", () => {
    mockResolvedTheme = "mocha";
    const { result } = renderContext([session], {}, { connectionIssue: "issue" });

    expect(result.current.base.paneId).toBe("pane-1");
    expect(result.current.base.connected).toBe(true);
    expect(result.current.base.connectionIssue).toBe("issue");
    expect(result.current.base.session?.paneId).toBe("pane-1");
    expect(result.current.repoPins.sessionGroups).toBe(sessionGroups);
  });

  it("preserves direct slice identity and projects shell owners to consumed fields", () => {
    mockSessionsContext = buildSessionContext({
      sessions: [session],
      sessionApi: buildSessionApi(),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryTestProvider>
        <SessionDetailProvider paneId="pane-1">{children}</SessionDetailProvider>
      </QueryTestProvider>
    );
    const { result } = renderHook(
      () => ({
        aggregate: useSessionDetailContext(),
        base: useSessionDetailBase(),
        repoPins: useSessionDetailRepoPins(),
        scope: useSessionDetailScope(),
        terminal: useSessionDetailTerminal(),
        quickPanel: useSessionDetailQuickPanel(),
        logModal: useSessionDetailLogModal(),
        headerActions: useSessionDetailHeaderActions(),
        sidebarActions: useSessionDetailSidebarActions(),
      }),
      { wrapper },
    );

    expect(result.current.base).toBe(result.current.aggregate.base);
    expect(result.current.repoPins).toBe(result.current.aggregate.repoPins);
    expect(result.current.scope).not.toBe(result.current.aggregate.scope);
    expect(result.current.scope.checkoutBranch).toBe(result.current.aggregate.scope.checkoutBranch);
    expect(result.current.scope.createBranch).toBe(result.current.aggregate.scope.createBranch);
    expect(result.current.scope.deleteBranch).toBe(result.current.aggregate.scope.deleteBranch);
    expect(result.current.scope.selectVirtualBranch).toBe(
      result.current.aggregate.scope.selectVirtualBranch,
    );
    expect(result.current.scope.selectVirtualWorktree).toBe(
      result.current.aggregate.scope.selectVirtualWorktree,
    );
    expect(result.current.terminal).not.toBe(result.current.aggregate.terminal);
    expect(result.current.terminal.controls.textInputRef).toBe(
      result.current.aggregate.terminal.controls.textInputRef,
    );
    expect(result.current.quickPanel).not.toBe(result.current.aggregate.logsActions);
    expect(result.current.quickPanel.logs.openLogModal).toBe(
      result.current.aggregate.logsActions.logs.openLogModal,
    );
    expect(result.current.logModal.logs.closeLogModal).toBe(
      result.current.aggregate.logsActions.logs.closeLogModal,
    );
    expect(result.current.headerActions.handleTouchCurrentSession).toBe(
      result.current.aggregate.logsActions.actions.handleTouchCurrentSession,
    );
    expect(result.current.sidebarActions.handleFocusPane).toBe(
      result.current.aggregate.logsActions.actions.handleFocusPane,
    );
  });

  it("does not update shell or scope consumers for an unrelated session tick", async () => {
    const sessionApi = buildSessionApi();
    mockSessionsContext = buildSessionContext({
      sessions: [session],
      sessionApi,
      connected: false,
    });
    shellSliceRenderSpy.mockClear();
    scopeSliceRenderSpy.mockClear();
    const view = render(
      <SessionDetailProvider paneId="pane-1">
        <ShellSliceProbe />
        <ScopeSliceProbe />
      </SessionDetailProvider>,
      { wrapper: QueryTestProvider },
    );
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      const scopeSlices = scopeSliceRenderSpy.mock.lastCall?.[0] as {
        branches: { branchesLoading: boolean };
        virtualWorktree: { loading: boolean };
      };
      expect(scopeSlices.branches.branchesLoading).toBe(false);
      expect(scopeSlices.virtualWorktree.loading).toBe(false);
    });
    expect(shellSliceRenderSpy).toHaveBeenCalled();
    expect(scopeSliceRenderSpy).toHaveBeenCalled();
    const initialShellSlices = shellSliceRenderSpy.mock.lastCall?.[0] as {
      terminal: unknown;
      quickPanel: unknown;
      logModal: unknown;
      headerActions: unknown;
      sidebarActions: unknown;
    };
    shellSliceRenderSpy.mockClear();
    scopeSliceRenderSpy.mockClear();

    const updatedSession = createSessionDetail({
      ...session,
      lastEventAt: "2026-08-24T00:00:00.000Z",
    });
    mockSessionsContext = {
      ...mockSessionsContext,
      sessions: [updatedSession],
      getSessionDetail: (paneId: string) =>
        paneId === updatedSession.paneId ? toMockSessionDetail(updatedSession) : null,
    };
    view.rerender(
      <SessionDetailProvider paneId="pane-1">
        <ShellSliceProbe />
        <ScopeSliceProbe />
      </SessionDetailProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(initialShellSlices.terminal).toBeDefined();
    expect(initialShellSlices.quickPanel).toBeDefined();
    expect(initialShellSlices.logModal).toBeDefined();
    expect(initialShellSlices.headerActions).toBeDefined();
    expect(initialShellSlices.sidebarActions).toBeDefined();
    expect(shellSliceRenderSpy).not.toHaveBeenCalled();
    expect(scopeSliceRenderSpy).not.toHaveBeenCalled();
  });

  it("resets an unsaved title draft across a keyed pane A -> B -> A transition", () => {
    const paneA = createSessionDetail({ paneId: "pane-a", customTitle: "Pane A" });
    const paneB = createSessionDetail({ paneId: "pane-b", customTitle: "Pane B" });
    mockSessionsContext = buildSessionContext({
      sessions: [paneA, paneB],
      sessionApi: buildSessionApi(),
    });
    const renderTree = (paneId: string) => (
      <SessionDetailProvider paneId={paneId}>
        <SessionDetailTitleProvider>
          <TitleProbe />
        </SessionDetailTitleProvider>
      </SessionDetailProvider>
    );
    const view = render(renderTree("pane-a"), { wrapper: QueryTestProvider });

    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.click(screen.getByRole("button", { name: "Change draft" }));
    expect(screen.getByTestId("title-state").textContent).toBe("editing:Unsaved draft");

    view.rerender(renderTree("pane-b"));
    expect(screen.getByTestId("title-state").textContent).toBe("closed:Pane B");

    view.rerender(renderTree("pane-a"));
    expect(screen.getByTestId("title-state").textContent).toBe("closed:Pane A");
  });

  it.each([
    ["useSessionDetailBase", useSessionDetailBase],
    ["useSessionDetailRepoPins", useSessionDetailRepoPins],
    ["useSessionDetailScope", useSessionDetailScope],
    ["useSessionDetailTerminal", useSessionDetailTerminal],
    ["useSessionDetailQuickPanel", useSessionDetailQuickPanel],
    ["useSessionDetailLogModal", useSessionDetailLogModal],
    ["useSessionDetailHeaderActions", useSessionDetailHeaderActions],
    ["useSessionDetailSidebarActions", useSessionDetailSidebarActions],
  ])("requires SessionDetailProvider for %s", (_name, useSlice) => {
    expect(() => renderHook(() => useSlice())).toThrow("within a SessionDetailProvider");
  });

  it("sets screen error when focus pane command fails", async () => {
    setScreenErrorMock.mockClear();
    const focusPane = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "RATE_LIMIT", message: "rate limited" },
    });
    const { result } = renderContext([session], { core: { focusPane } });

    await act(async () => {
      await result.current.logsActions.actions.handleFocusPane("pane-1");
    });

    expect(focusPane).toHaveBeenCalledWith("pane-1");
    expect(setScreenErrorMock).toHaveBeenCalledWith("rate limited");
  });

  it("touches target pane when sidebar pin action is triggered", () => {
    const moveSessionToTop = vi.fn().mockResolvedValue(undefined);
    const { result } = renderContext([session], {
      core: { moveSessionToTop, focusPane: vi.fn().mockResolvedValue({ ok: true }) },
    });

    act(() => {
      result.current.logsActions.actions.handleTouchPaneSortAnchor("pane-2");
    });

    expect(moveSessionToTop).toHaveBeenCalledWith("pane-2");
  });

  it("keeps virtual branch and virtual worktree selection mutually exclusive", async () => {
    window.localStorage.clear();
    const sessionApi: SessionApiMockOverrides = {
      branches: {
        requestWorktrees: vi.fn(async () => ({
          repoRoot: session.repoRoot,
          currentPath: null,
          baseBranch: "main",
          entries: [
            {
              path: "/Users/test/repo-worktrees/wt-a",
              branch: "feature/wt-a",
              dirty: false,
              locked: false,
              lockOwner: null,
              lockReason: null,
              merged: false,
            },
          ],
        })),
        requestBranches: vi.fn(async () => ({
          repoRoot: session.repoRoot,
          defaultBranch: "main",
          currentBranch: "main",
          entries: [
            {
              name: "main",
              current: true,
              isDefault: true,
              ahead: null,
              behind: null,
              fileChanges: null,
              additions: null,
              deletions: null,
              merged: null,
              pr: null,
              worktreePath: null,
              committedAt: null,
            },
            {
              name: "feature/a",
              current: false,
              isDefault: false,
              ahead: null,
              behind: null,
              fileChanges: null,
              additions: null,
              deletions: null,
              merged: null,
              pr: null,
              worktreePath: null,
              committedAt: null,
            },
          ],
        })),
      },
    };
    const { result } = renderContext([session], sessionApi);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.scope.selectVirtualWorktree("/Users/test/repo-worktrees/wt-a");
    });

    expect(result.current.scope.virtualWorktree.virtualWorktreePath).toBe(
      "/Users/test/repo-worktrees/wt-a",
    );
    expect(result.current.scope.virtualBranch.virtualBranch).toBeNull();

    act(() => {
      result.current.scope.selectVirtualBranch("feature/a");
    });

    expect(result.current.scope.virtualBranch.virtualBranch).toBe("feature/a");
    expect(result.current.scope.virtualWorktree.virtualWorktreePath).toBeNull();

    act(() => {
      result.current.scope.selectVirtualWorktree("/Users/test/repo-worktrees/wt-a");
    });

    expect(result.current.scope.virtualWorktree.virtualWorktreePath).toBe(
      "/Users/test/repo-worktrees/wt-a",
    );
    expect(result.current.scope.virtualBranch.virtualBranch).toBeNull();
  });

  it("refreshes diff and commit log after a successful branch checkout", async () => {
    window.localStorage.clear();
    const requestBranchCheckout = vi.fn(async () => undefined);
    const requestWorktrees = vi.fn(async () => ({
      repoRoot: null,
      currentPath: null,
      entries: [],
    }));
    const requestDiffSummary = vi.fn(async () => ({
      repoRoot: "/repo",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      files: [],
    }));
    const requestCommitLog = vi.fn(async () => ({
      repoRoot: "/repo",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
      totalCount: 0,
    }));
    const sessionApi: SessionApiMockOverrides = {
      branches: {
        requestBranchCheckout,
        requestWorktrees,
        requestDiffSummary,
        requestCommitLog,
        requestBranches: vi.fn(async () => ({
          repoRoot: session.repoRoot,
          defaultBranch: "main",
          currentBranch: "main",
          entries: [],
        })),
      },
    };
    const { result, queryClient } = renderContext([session], sessionApi);

    await act(async () => {
      await Promise.resolve();
    });

    const worktreeCallsBeforeCheckout = requestWorktrees.mock.calls.length;
    const diffCallsBeforeCheckout = requestDiffSummary.mock.calls.length;
    const commitCallsBeforeCheckout = requestCommitLog.mock.calls.length;
    const headKey = sessionDetailQueryKeys.commitLogHead("pane-1", {
      repoRoot: session.repoRoot,
      worktreePath: null,
      branch: null,
      limit: COMMIT_PAGE_SIZE,
    });
    await waitFor(() => expect(queryClient.getQueryData(headKey)).toBeDefined());
    const tailKey = queryClient
      .getQueryCache()
      .findAll({ queryKey: sessionDetailQueryKeys.commitLogRoot("pane-1") })
      .find((query) => query.queryKey[4] === "tail")?.queryKey;
    expect(tailKey).toBeDefined();
    const detailKey = sessionDetailQueryKeys.commitDetail("pane-1", {
      repoRoot: session.repoRoot,
      worktreePath: null,
      branch: null,
      hash: "cached-detail",
    });
    const fileKey = sessionDetailQueryKeys.commitFile("pane-1", {
      repoRoot: session.repoRoot,
      worktreePath: null,
      branch: null,
      hash: "cached-detail",
      path: "src/cached.ts",
    });
    const tailData = {
      pages: [
        {
          repoRoot: "/repo",
          rev: "HEAD",
          generatedAt: new Date(0).toISOString(),
          commits: [],
          totalCount: 0,
        },
      ],
      pageParams: [0],
    };
    const detailData = { marker: "detail" };
    const fileData = { marker: "file" };
    queryClient.setQueryData(tailKey!, tailData);
    queryClient.setQueryData(detailKey, detailData);
    queryClient.setQueryData(fileKey, fileData);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const refetchSpy = vi.spyOn(queryClient, "refetchQueries");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scope.checkoutBranch("feature/a");
    });

    expect(ok).toBe(true);
    expect(requestBranchCheckout).toHaveBeenCalledWith("pane-1", "feature/a");
    expect(requestDiffSummary.mock.calls.length).toBeGreaterThan(diffCallsBeforeCheckout);
    expect(requestCommitLog.mock.calls.length).toBeGreaterThan(commitCallsBeforeCheckout);
    expect(requestWorktrees.mock.calls.length).toBeGreaterThan(worktreeCallsBeforeCheckout);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: headKey,
      exact: true,
      refetchType: "none",
    });
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: headKey, exact: true, type: "active" });
    expect(
      invalidateSpy.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === "commits"),
    ).toEqual([[{ queryKey: headKey, exact: true, refetchType: "none" }]]);
    expect(
      refetchSpy.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === "commits"),
    ).toEqual([[{ queryKey: headKey, exact: true, type: "active" }]]);
    expect(queryClient.getQueryData(tailKey!)).toBe(tailData);
    expect(queryClient.getQueryData(detailKey)).toBe(detailData);
    expect(queryClient.getQueryData(fileKey)).toBe(fileData);
  });

  it("only marks the exact commit head stale for offline or disconnected checkout", async () => {
    const cases = [
      { name: "offline", connected: true, online: false },
      { name: "disconnected", connected: false, online: true },
    ] as const;
    for (const testCase of cases) {
      const requestBranchCheckout = vi.fn(async () => undefined);
      const sessionApi: SessionApiMockOverrides = {
        branches: {
          requestBranchCheckout,
          requestWorktrees: vi.fn(async () => ({
            repoRoot: session.repoRoot,
            currentPath: null,
            entries: [],
          })),
          requestBranches: vi.fn(async () => ({
            repoRoot: session.repoRoot,
            defaultBranch: "main",
            currentBranch: "main",
            entries: [],
          })),
        },
      };
      const rendered = renderContext([session], sessionApi, { connected: testCase.connected });
      await act(async () => Promise.resolve());
      onlineManager.setOnline(testCase.online);
      const invalidateSpy = vi.spyOn(rendered.queryClient, "invalidateQueries");
      const refetchSpy = vi.spyOn(rendered.queryClient, "refetchQueries");
      const headKey = sessionDetailQueryKeys.commitLogHead("pane-1", {
        repoRoot: session.repoRoot,
        worktreePath: null,
        branch: null,
        limit: COMMIT_PAGE_SIZE,
      });

      await act(async () => rendered.result.current.scope.checkoutBranch("feature/a"));

      expect(invalidateSpy, testCase.name).toHaveBeenCalledWith({
        queryKey: headKey,
        exact: true,
        refetchType: "none",
      });
      expect(
        invalidateSpy.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === "commits"),
        testCase.name,
      ).toEqual([[{ queryKey: headKey, exact: true, refetchType: "none" }]]);
      expect(
        refetchSpy.mock.calls.filter(
          ([filters]) => filters?.queryKey?.[2] === "commits" && filters.queryKey[4] === "head",
        ),
        testCase.name,
      ).toEqual([]);
      rendered.unmount();
      onlineManager.setOnline(true);
    }
  });

  it("does not explicitly refresh the stale virtual branch scope after checkout", async () => {
    window.localStorage.clear();
    const requestBranchCheckout = vi.fn(async () => undefined);
    const requestWorktrees = vi.fn(async () => ({
      repoRoot: session.repoRoot,
      currentPath: null,
      baseBranch: "main",
      entries: [],
    }));
    const requestDiffSummary = vi.fn<
      ReturnType<typeof createSessionBranchesApiMock>["requestDiffSummary"]
    >(async () => ({
      repoRoot: "/repo",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      files: [],
    }));
    const requestCommitLog = vi.fn<
      ReturnType<typeof createSessionBranchesApiMock>["requestCommitLog"]
    >(async () => ({
      repoRoot: "/repo",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
      totalCount: 0,
    }));
    const requestBranches = vi.fn<
      ReturnType<typeof createSessionBranchesApiMock>["requestBranches"]
    >(async () => ({
      repoRoot: session.repoRoot,
      defaultBranch: "main",
      currentBranch: "main",
      entries: [
        {
          name: "main",
          current: true,
          isDefault: true,
          ahead: null,
          behind: null,
          fileChanges: null,
          additions: null,
          deletions: null,
          merged: null,
          pr: null,
          worktreePath: null,
          committedAt: null,
        },
        {
          name: "feature/a",
          current: false,
          isDefault: false,
          ahead: null,
          behind: null,
          fileChanges: null,
          additions: null,
          deletions: null,
          merged: null,
          pr: null,
          worktreePath: null,
          committedAt: null,
        },
      ],
    }));
    const sessionApi: SessionApiMockOverrides = {
      branches: {
        requestBranchCheckout,
        requestWorktrees,
        requestDiffSummary,
        requestCommitLog,
        requestBranches,
      },
    };
    const { result, queryClient } = renderContext([session], sessionApi);

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.scope.selectVirtualBranch("feature/a");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.scope.virtualBranch.virtualBranch).toBe("feature/a");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const refetchSpy = vi.spyOn(queryClient, "refetchQueries");
    const diffCallCount = requestDiffSummary.mock.calls.length;
    const commitCallCount = requestCommitLog.mock.calls.length;
    const worktreeCallCount = requestWorktrees.mock.calls.length;

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scope.checkoutBranch("feature/a");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ok).toBe(true);
    expect(result.current.scope.virtualBranch.virtualBranch).toBeNull();
    expect(
      requestDiffSummary.mock.calls
        .slice(diffCallCount)
        .filter(([, options]) => options.branch === "feature/a"),
    ).toEqual([]);
    expect(
      requestCommitLog.mock.calls
        .slice(commitCallCount)
        .filter(([, options]) => options.branch === "feature/a"),
    ).toEqual([]);
    expect(
      requestDiffSummary.mock.calls
        .slice(diffCallCount)
        .filter(([, options]) => options.branch == null).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      requestCommitLog.mock.calls
        .slice(commitCallCount)
        .filter(([, options]) => options.branch == null).length,
    ).toBeGreaterThanOrEqual(1);
    expect(requestBranches).toHaveBeenCalledWith(
      "pane-1",
      { force: true },
      expect.any(AbortSignal),
    );
    expect(requestWorktrees.mock.calls.length).toBeGreaterThan(worktreeCallCount);
    expect(
      invalidateSpy.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === "commits"),
    ).toEqual([]);
    expect(
      refetchSpy.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === "commits"),
    ).toEqual([]);
  });

  // Render-suppression regression coverage for T15a. useSessionDetailVMState's
  // return value ("base") used to be a plain object literal (never
  // memoized), so it produced a new reference on every render for any reason
  // at all -- which made SessionDetailProvider's final context-value useMemo
  // (whose deps include `base`) cache-miss unconditionally, forcing every
  // SessionDetailContext consumer (View + 5 props/state hooks) to re-run on
  // every SSE tick. This checks useSessionDetailVMState's own output
  // directly (rather than the Provider's combined context value, which also
  // depends on several other subhooks outside this task's scope and so is
  // not usable as a stability signal for `base` specifically).
  it("keeps the useSessionDetailVMState return reference stable across a re-render where nothing changed (T15a)", () => {
    mockSessionsContext = buildSessionContext({
      sessions: [session],
      sessionApi: buildSessionApi(),
    });
    const { result, rerender } = renderHook(() => useSessionDetailVMState("pane-1"));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("keeps the commits context stable across unrelated session and files ticks", async () => {
    commitsSliceRenderSpy.mockClear();
    const requestCommitLog = vi.fn(async () => ({
      repoRoot: session.repoRoot,
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
      totalCount: 0,
    }));
    const requestDiffSummary = vi.fn(async () => ({
      repoRoot: session.repoRoot,
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      files: [],
    }));
    const sessionApi = buildSessionApi({
      branches: { requestCommitLog, requestDiffSummary },
    });
    mockSessionsContext = buildSessionContext({ sessions: [session], sessionApi });
    const view = (
      <SessionDetailProvider paneId="pane-1">
        <CommitsSliceProbe />
        <FilesTickProbe />
      </SessionDetailProvider>
    );
    const rendered = render(view, { wrapper: QueryTestProvider });
    await waitFor(() =>
      expect(commitsSliceRenderSpy.mock.lastCall?.[0].commitLog?.rev).toBe("HEAD"),
    );
    const settledRenderCount = commitsSliceRenderSpy.mock.calls.length;
    const settledValue = commitsSliceRenderSpy.mock.lastCall?.[0] as Record<string, unknown>;

    fireEvent.click(screen.getByRole("button", { name: "Tick files" }));
    await act(async () => Promise.resolve());
    const filesTickValue = commitsSliceRenderSpy.mock.lastCall?.[0] as Record<string, unknown>;
    expect(
      Object.keys(settledValue).filter((key) => settledValue[key] !== filesTickValue[key]),
    ).toEqual([]);
    expect(commitsSliceRenderSpy).toHaveBeenCalledTimes(settledRenderCount);

    const tickedSession = { ...session, lastEventAt: "2026-01-01T00:00:02.000Z" };
    mockSessionsContext = buildSessionContext({ sessions: [tickedSession], sessionApi });
    rendered.rerender(view);
    await act(async () => Promise.resolve());
    expect(commitsSliceRenderSpy).toHaveBeenCalledTimes(settledRenderCount);
  });

  it("does not re-render the memoized NotesSection when an unrelated sessions tick updates base state (T15a)", async () => {
    notesPollingCallCount = 0;
    // Resolved once and reused across both buildSessionContext calls below so
    // notes-domain function identity (createRepoNote/updateRepoNote/
    // deleteRepoNote) stays stable across the "unrelated tick" re-render --
    // the whole point of this assertion.
    const sessionApi = buildSessionApi({ notes: { requestRepoNotes: vi.fn(async () => []) } });
    mockSessionsContext = buildSessionContext({ sessions: [session], sessionApi });

    let renderResult!: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(
        <SessionDetailProvider paneId="pane-1">
          <NotesProbe />
        </SessionDetailProvider>,
        { wrapper: QueryTestProvider },
      );
    });

    const notesRendersAfterMount = notesPollingCallCount;
    expect(notesRendersAfterMount).toBeGreaterThan(0);

    // Simulate an unrelated SSE tick: a freshly parsed session object for the
    // same pane with an unrelated field changed (lastEventAt), while
    // notes-relevant data (repoRoot) stays the same.
    const tickedSession = { ...session, lastEventAt: "2026-01-01T00:00:01.000Z" };
    mockSessionsContext = buildSessionContext({ sessions: [tickedSession], sessionApi });

    await act(async () => {
      renderResult.rerender(
        <SessionDetailProvider paneId="pane-1">
          <NotesProbe />
        </SessionDetailProvider>,
      );
    });

    expect(notesPollingCallCount).toBe(notesRendersAfterMount);
  });
});
