// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { MutableRefObject, ReactNode } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";

import { buildSessionGroups } from "@/lib/session-group";
import { ThemeProvider } from "@/state/theme-context";

import { SessionDetailView, type SessionDetailViewProps } from "./SessionDetailView";
import { createSessionDetail } from "./test-helpers";

vi.mock("./components/SessionSidebar", () => ({
  SessionSidebar: () => <div data-testid="session-sidebar" />,
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
  return render(
    <RouterContextProvider router={router}>
      <ThemeProvider>{ui}</ThemeProvider>
    </RouterContextProvider>,
  );
};

type SessionDetailViewOverrides = {
  meta?: Partial<SessionDetailViewProps["meta"]>;
  sidebar?: Partial<SessionDetailViewProps["sidebar"]>;
  layout?: Partial<SessionDetailViewProps["layout"]>;
  timeline?: Partial<SessionDetailViewProps["timeline"]>;
  screen?: Partial<SessionDetailViewProps["screen"]>;
  controls?: Partial<SessionDetailViewProps["controls"]>;
  diffs?: Partial<SessionDetailViewProps["diffs"]>;
  commits?: Partial<SessionDetailViewProps["commits"]>;
  logs?: Partial<SessionDetailViewProps["logs"]>;
  title?: Partial<SessionDetailViewProps["title"]>;
  actions?: Partial<SessionDetailViewProps["actions"]>;
};

const createViewProps = (overrides: SessionDetailViewOverrides = {}): SessionDetailViewProps => {
  const base: SessionDetailViewProps = {
    meta: {
      paneId: "pane-1",
      session: null,
      nowMs: 0,
      connected: false,
      connectionIssue: null,
    },
    sidebar: {
      sessionGroups: buildSessionGroups([]),
    },
    layout: {
      is2xlUp: false,
      sidebarWidth: 240,
      handleSidebarPointerDown: vi.fn(),
      detailSplitRatio: 0.5,
      detailSplitRef: { current: null } as MutableRefObject<HTMLDivElement | null>,
      handleDetailSplitPointerDown: vi.fn(),
    },
    timeline: {
      timeline: null,
      timelineRange: "1h",
      timelineError: null,
      timelineLoading: false,
      timelineExpanded: true,
      isMobile: false,
      setTimelineRange: vi.fn(),
      toggleTimelineExpanded: vi.fn(),
      refreshTimeline: vi.fn(),
    },
    screen: {
      mode: "text",
      screenLines: [],
      imageBase64: null,
      fallbackReason: null,
      error: null,
      isScreenLoading: false,
      isAtBottom: true,
      handleAtBottomChange: vi.fn(),
      handleUserScrollStateChange: vi.fn(),
      forceFollow: false,
      scrollToBottom: vi.fn(),
      handleModeChange: vi.fn(),
      virtuosoRef: { current: null } as MutableRefObject<VirtuosoHandle | null>,
      scrollerRef: { current: null } as MutableRefObject<HTMLDivElement | null>,
      handleRefreshScreen: vi.fn(),
    },
    controls: {
      interactive: true,
      textInputRef: { current: null } as MutableRefObject<HTMLTextAreaElement | null>,
      autoEnter: false,
      shiftHeld: false,
      ctrlHeld: false,
      controlsOpen: false,
      rawMode: false,
      allowDangerKeys: false,
      handleSendKey: vi.fn(),
      handleSendText: vi.fn(),
      handleUploadImage: vi.fn(),
      handleRawBeforeInput: vi.fn(),
      handleRawInput: vi.fn(),
      handleRawKeyDown: vi.fn(),
      handleRawCompositionStart: vi.fn(),
      handleRawCompositionEnd: vi.fn(),
      toggleAutoEnter: vi.fn(),
      toggleControls: vi.fn(),
      toggleShift: vi.fn(),
      toggleCtrl: vi.fn(),
      toggleRawMode: vi.fn(),
      toggleAllowDangerKeys: vi.fn(),
      handleTouchSession: vi.fn(),
    },
    diffs: {
      diffSummary: null,
      diffError: null,
      diffLoading: false,
      diffFiles: {},
      diffOpen: {},
      diffLoadingFiles: {},
      refreshDiff: vi.fn(),
      toggleDiff: vi.fn(),
    },
    commits: {
      commitLog: null,
      commitError: null,
      commitLoading: false,
      commitLoadingMore: false,
      commitHasMore: false,
      commitDetails: {},
      commitFileDetails: {},
      commitFileOpen: {},
      commitFileLoading: {},
      commitOpen: {},
      commitLoadingDetails: {},
      copiedHash: null,
      refreshCommitLog: vi.fn(),
      loadMoreCommits: vi.fn(),
      toggleCommit: vi.fn(),
      toggleCommitFile: vi.fn(),
      copyHash: vi.fn(),
    },
    logs: {
      quickPanelOpen: false,
      logModalOpen: false,
      selectedSession: null,
      selectedLogLines: [],
      selectedLogLoading: false,
      selectedLogError: null,
      openLogModal: vi.fn(),
      closeLogModal: vi.fn(),
      toggleQuickPanel: vi.fn(),
      closeQuickPanel: vi.fn(),
    },
    title: {
      titleDraft: "",
      titleEditing: false,
      titleSaving: false,
      titleError: null,
      openTitleEditor: vi.fn(),
      closeTitleEditor: vi.fn(),
      updateTitleDraft: vi.fn(),
      saveTitle: vi.fn(),
      clearTitle: vi.fn(),
    },
    actions: {
      handleFocusPane: vi.fn(),
      handleOpenPaneHere: vi.fn(),
      handleOpenHere: vi.fn(),
      handleOpenInNewTab: vi.fn(),
    },
  };

  return {
    ...base,
    meta: { ...base.meta, ...overrides.meta },
    sidebar: { ...base.sidebar, ...overrides.sidebar },
    layout: { ...base.layout, ...overrides.layout },
    timeline: { ...base.timeline, ...overrides.timeline },
    screen: { ...base.screen, ...overrides.screen },
    controls: { ...base.controls, ...overrides.controls },
    diffs: { ...base.diffs, ...overrides.diffs },
    commits: { ...base.commits, ...overrides.commits },
    logs: { ...base.logs, ...overrides.logs },
    title: { ...base.title, ...overrides.title },
    actions: { ...base.actions, ...overrides.actions },
  };
};

describe("SessionDetailView", () => {
  it("renders not found state when session is missing", () => {
    const props = createViewProps({ meta: { session: null } });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("Session not found.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to list" })).toBeTruthy();
  });

  it("renders main sections when session exists", () => {
    const props = createViewProps({
      meta: { session: createSessionDetail() },
    });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByRole("button", { name: "Edit session title" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize panels" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Text" })).toBeTruthy();
    expect(screen.getByLabelText("Toggle session quick panel")).toBeTruthy();
  });
});
