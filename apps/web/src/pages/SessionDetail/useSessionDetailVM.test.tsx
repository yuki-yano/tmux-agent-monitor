// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  connectedAtom,
  connectionIssueAtom,
  highlightCorrectionsAtom,
  paneIdAtom,
  resolvedThemeAtom,
  sessionApiAtom,
  sessionsAtom,
} from "./atoms/sessionDetailAtoms";
import { createSessionDetail } from "./test-helpers";
import { useSessionDetailVM } from "./useSessionDetailVM";

const session = createSessionDetail({ paneId: "pane-1" });
const sessionGroups = [{ repoRoot: null, sessions: [session] }];
const setScreenErrorMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/session-group", () => ({
  buildSessionGroups: vi.fn(() => sessionGroups),
}));

vi.mock("@/lib/use-media-query", () => ({
  useMediaQuery: () => true,
}));

vi.mock("@/lib/use-now-ms", () => ({
  useNowMs: () => 123,
}));

vi.mock("@/lib/use-sidebar-width", () => ({
  useSidebarWidth: () => ({ sidebarWidth: 240, handlePointerDown: vi.fn() }),
}));

vi.mock("@/lib/use-split-ratio", () => ({
  useSplitRatio: () => ({
    ratio: 0.5,
    containerRef: { current: null },
    handlePointerDown: vi.fn(),
  }),
}));

vi.mock("./hooks/useSessionScreen", () => ({
  useSessionScreen: () => ({
    mode: "text",
    screenLines: ["line"],
    imageBase64: null,
    fallbackReason: null,
    error: null,
    setScreenError: setScreenErrorMock,
    isScreenLoading: false,
    isAtBottom: true,
    handleAtBottomChange: vi.fn(),
    handleUserScrollStateChange: vi.fn(),
    forceFollow: false,
    refreshScreen: vi.fn(),
    scrollToBottom: vi.fn(),
    handleModeChange: vi.fn(),
    virtuosoRef: { current: null },
    scrollerRef: { current: null },
  }),
}));

vi.mock("./hooks/useSessionControls", () => ({
  useSessionControls: () => ({
    textInputRef: { current: null },
    autoEnter: true,
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
  }),
}));

vi.mock("./hooks/useSessionDiffs", () => ({
  useSessionDiffs: () => ({
    diffSummary: null,
    diffError: null,
    diffLoading: false,
    diffFiles: {},
    diffOpen: {},
    diffLoadingFiles: {},
    refreshDiff: vi.fn(),
    toggleDiff: vi.fn(),
  }),
}));

vi.mock("./hooks/useSessionCommits", () => ({
  useSessionCommits: () => ({
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
  }),
}));

vi.mock("./hooks/useSessionLogs", () => ({
  useSessionLogs: () => ({
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
  }),
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
    clearTitle: vi.fn(),
  }),
}));

vi.mock("./hooks/useSessionTimeline", () => ({
  useSessionTimeline: () => ({
    timeline: null,
    timelineRange: "1h",
    timelineError: null,
    timelineLoading: false,
    timelineExpanded: true,
    setTimelineRange: vi.fn(),
    toggleTimelineExpanded: vi.fn(),
    refreshTimeline: vi.fn(),
  }),
}));

describe("useSessionDetailVM", () => {
  it("reads base state from atoms", () => {
    const sessionApi = {
      reconnect: vi.fn(),
      requestDiffSummary: vi.fn(),
      requestDiffFile: vi.fn(),
      requestCommitLog: vi.fn(),
      requestCommitDetail: vi.fn(),
      requestCommitFile: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      focusPane: vi.fn(),
      uploadImageAttachment: vi.fn(),
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(),
      touchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    const store = createStore();
    store.set(paneIdAtom, "pane-1");
    store.set(sessionsAtom, [session]);
    store.set(connectedAtom, true);
    store.set(connectionIssueAtom, "issue");
    store.set(highlightCorrectionsAtom, { codex: false, claude: true });
    store.set(resolvedThemeAtom, "mocha");
    store.set(sessionApiAtom, sessionApi);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    const { result } = renderHook(() => useSessionDetailVM("pane-1"), { wrapper });

    expect(result.current.meta.paneId).toBe("pane-1");
    expect(result.current.meta.connected).toBe(true);
    expect(result.current.meta.connectionIssue).toBe("issue");
    expect(result.current.meta.session?.paneId).toBe("pane-1");
    expect(result.current.sidebar.sessionGroups).toBe(sessionGroups);
  });

  it("sets screen error when focus pane command fails", async () => {
    setScreenErrorMock.mockClear();
    const focusPane = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "RATE_LIMIT", message: "rate limited" },
    });
    const sessionApi = {
      reconnect: vi.fn(),
      requestDiffSummary: vi.fn(),
      requestDiffFile: vi.fn(),
      requestCommitLog: vi.fn(),
      requestCommitDetail: vi.fn(),
      requestCommitFile: vi.fn(),
      requestStateTimeline: vi.fn(),
      requestScreen: vi.fn(),
      focusPane,
      uploadImageAttachment: vi.fn(),
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(),
      touchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
    };

    const store = createStore();
    store.set(paneIdAtom, "pane-1");
    store.set(sessionsAtom, [session]);
    store.set(connectedAtom, true);
    store.set(connectionIssueAtom, null);
    store.set(highlightCorrectionsAtom, { codex: false, claude: true });
    store.set(resolvedThemeAtom, "mocha");
    store.set(sessionApiAtom, sessionApi);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    const { result } = renderHook(() => useSessionDetailVM("pane-1"), { wrapper });

    await act(async () => {
      await result.current.actions.handleFocusPane("pane-1");
    });

    expect(focusPane).toHaveBeenCalledWith("pane-1");
    expect(setScreenErrorMock).toHaveBeenCalledWith("rate limited");
  });
});
