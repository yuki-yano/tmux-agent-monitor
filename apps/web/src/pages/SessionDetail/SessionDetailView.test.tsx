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

import type { SessionDetailViewProps } from "./SessionDetailView";
import { SessionDetailView } from "./SessionDetailView";

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

const createViewProps = (
  overrides: Partial<SessionDetailViewProps> = {},
): SessionDetailViewProps => ({
  paneId: "pane-1",
  session: null,
  sessionGroups: buildSessionGroups([]),
  nowMs: 0,
  connected: false,
  connectionIssue: null,
  readOnly: false,
  is2xlUp: false,
  sidebarWidth: 240,
  handleSidebarPointerDown: vi.fn(),
  detailSplitRatio: 0.5,
  detailSplitRef: { current: null } as MutableRefObject<HTMLDivElement | null>,
  handleDetailSplitPointerDown: vi.fn(),
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
  textInputRef: { current: null } as MutableRefObject<HTMLTextAreaElement | null>,
  autoEnter: false,
  shiftHeld: false,
  ctrlHeld: false,
  controlsOpen: false,
  handleSendKey: vi.fn(),
  handleSendText: vi.fn(),
  toggleAutoEnter: vi.fn(),
  toggleControls: vi.fn(),
  toggleShift: vi.fn(),
  toggleCtrl: vi.fn(),
  handleTouchSession: vi.fn(),
  diffSummary: null,
  diffError: null,
  diffLoading: false,
  diffFiles: {},
  diffOpen: {},
  diffLoadingFiles: {},
  refreshDiff: vi.fn(),
  toggleDiff: vi.fn(),
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
  titleDraft: "",
  titleEditing: false,
  titleSaving: false,
  titleError: null,
  openTitleEditor: vi.fn(),
  closeTitleEditor: vi.fn(),
  updateTitleDraft: vi.fn(),
  saveTitle: vi.fn(),
  clearTitle: vi.fn(),
  handleOpenHere: vi.fn(),
  handleOpenInNewTab: vi.fn(),
  ...overrides,
});

describe("SessionDetailView", () => {
  it("renders not found state when session is missing", () => {
    const props = createViewProps({ session: null });
    renderWithRouter(<SessionDetailView {...props} />);

    expect(screen.getByText("Session not found.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to list" })).toBeTruthy();
  });
});
