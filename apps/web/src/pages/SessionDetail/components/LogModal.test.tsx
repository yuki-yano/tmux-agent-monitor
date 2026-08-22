import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logModalSnapRequestAtom } from "@/features/shared-session-ui/atoms/logAtoms";
import { createSessionDetail } from "../test-helpers";
import { LogModal } from "@/features/shared-session-ui/components/LogModal";

let latestOnUserScrollStateChange: ((value: boolean) => void) | null = null;
let latestAtBottomStateChange: ((value: boolean) => void) | null = null;
const scrollToEnd = vi.fn();
let latestFollowOutput: "auto" | "smooth" | boolean | undefined;
let virtualizerAtEnd = true;
const mockScrollerRef = { current: null as HTMLDivElement | null };
const mockUseWorkspaceTabs = vi.hoisted(
  () =>
    ({
      enabled: false as boolean,
      activeTabId: "system:sessions",
      tabs: [],
      openSessionTab: vi.fn<(paneId: string) => void>(),
      activateTab: vi.fn<(tabId: string) => void>(),
      closeTab: vi.fn<(tabId: string) => void>(),
      dismissSessionTab: vi.fn<(paneId: string) => void>(),
      reorderTabs: vi.fn<(activeTabId: string, overTabId: string) => void>(),
      reorderTabsByClosableOrder: vi.fn<(orderedClosableTabIds: string[]) => void>(),
    }) satisfies {
      enabled: boolean;
      activeTabId: string;
      tabs: unknown[];
      openSessionTab: (paneId: string) => void;
      activateTab: (tabId: string) => void;
      closeTab: (tabId: string) => void;
      dismissSessionTab: (paneId: string) => void;
      reorderTabs: (activeTabId: string, overTabId: string) => void;
      reorderTabsByClosableOrder: (orderedClosableTabIds: string[]) => void;
    },
);

vi.mock("@/features/shared-session-ui/hooks/useUserScrollState", () => ({
  useUserScrollState: ({
    onUserScrollStateChange,
  }: {
    onUserScrollStateChange?: (value: boolean) => void;
  }) => {
    latestOnUserScrollStateChange = onUserScrollStateChange ?? null;
    return {
      scrollerRef: mockScrollerRef,
    };
  },
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: {
    count: number;
    followOnAppend?: "auto" | "smooth" | boolean;
    onChange?: (instance: unknown, sync: boolean) => void;
  }) => {
    const instance = {
      range: options.count > 0 ? { startIndex: 0, endIndex: options.count - 1 } : null,
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          index,
          key: `item-${index}`,
          start: index * 16,
        })),
      getTotalSize: () => options.count * 16,
      isAtEnd: () => virtualizerAtEnd,
      measureElement: vi.fn(),
      scrollToEnd,
    };
    latestAtBottomStateChange = (value) => {
      virtualizerAtEnd = value;
      options.onChange?.(instance, false);
    };
    latestFollowOutput = options.followOnAppend;
    return instance;
  },
}));

vi.mock("@/features/pwa-tabs/context/workspace-tabs-context", () => ({
  useWorkspaceTabs: () => mockUseWorkspaceTabs,
}));

describe("LogModal", () => {
  type LogModalState = Parameters<typeof LogModal>[0]["state"];
  type LogModalActions = Parameters<typeof LogModal>[0]["actions"];

  const createWrapper = (store = createStore()) => {
    store.set(logModalSnapRequestAtom, { paneId: "pane-1", version: 1 });
    return ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
  };

  const buildState = (overrides: Partial<LogModalState> = {}): LogModalState => ({
    open: true,
    session: createSessionDetail(),
    logLines: [],
    loading: false,
    error: null,
    ...overrides,
  });

  const buildActions = (overrides: Partial<LogModalActions> = {}): LogModalActions => ({
    onClose: vi.fn(),
    onOpenHere: vi.fn(),
    onOpenNewTab: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    latestOnUserScrollStateChange = null;
    latestAtBottomStateChange = null;
    latestFollowOutput = undefined;
    virtualizerAtEnd = true;
    mockScrollerRef.current = null;
    mockUseWorkspaceTabs.enabled = false;
    mockUseWorkspaceTabs.activeTabId = "system:sessions";
    mockUseWorkspaceTabs.tabs = [];
    mockUseWorkspaceTabs.openSessionTab = vi.fn();
    mockUseWorkspaceTabs.activateTab = vi.fn();
    mockUseWorkspaceTabs.closeTab = vi.fn();
    mockUseWorkspaceTabs.dismissSessionTab = vi.fn();
    mockUseWorkspaceTabs.reorderTabs = vi.fn();
    mockUseWorkspaceTabs.reorderTabsByClosableOrder = vi.fn();
  });

  it("returns null when closed", () => {
    const state = buildState({ open: false });
    const actions = buildActions();
    const wrapper = createWrapper();
    const { container } = render(<LogModal state={state} actions={actions} />, { wrapper });

    expect(container.firstChild).toBeNull();
  });

  it("renders log modal content and handles actions", () => {
    const onClose = vi.fn();
    const onOpenHere = vi.fn();
    const onOpenNewTab = vi.fn();
    const session = createSessionDetail({ customTitle: "Custom" });
    const state = buildState({
      open: true,
      session,
      logLines: ["line1"],
      loading: true,
      error: "Log error",
    });
    const actions = buildActions({ onClose, onOpenHere, onOpenNewTab });
    const wrapper = createWrapper();
    render(<LogModal state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.getByText("Log error")).toBeTruthy();
    expect(screen.getByText("Loading log...")).toBeTruthy();
    expect(screen.getByLabelText("Close log").className).toContain("right-3");
    expect(screen.getByLabelText("Close log").className).toContain("top-3");

    fireEvent.click(screen.getByLabelText("Close log"));
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Open here"));
    expect(onOpenHere).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Open in new tab"));
    expect(onOpenNewTab).toHaveBeenCalled();
  });

  it("closes when clicking outside panel", () => {
    const onClose = vi.fn();
    const state = buildState({ open: true, session: createSessionDetail(), logLines: ["line1"] });
    const actions = buildActions({ onClose });
    const wrapper = createWrapper();
    render(<LogModal state={state} actions={actions} />, { wrapper });

    fireEvent.pointerDown(screen.getByTestId("log-modal-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside panel", () => {
    const onClose = vi.fn();
    const state = buildState({ open: true, session: createSessionDetail(), logLines: ["line1"] });
    const actions = buildActions({ onClose });
    const wrapper = createWrapper();
    render(<LogModal state={state} actions={actions} />, { wrapper });

    fireEvent.pointerDown(screen.getByTestId("log-modal-panel"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("buffers log lines while user is scrolling", () => {
    const session = createSessionDetail();
    const state = buildState({ session, logLines: ["line1"] });
    const actions = buildActions();
    const wrapper = createWrapper();
    const { rerender } = render(<LogModal state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("line1")).toBeTruthy();

    act(() => {
      latestOnUserScrollStateChange?.(true);
    });

    rerender(
      <LogModal
        state={{
          ...state,
          logLines: ["line1", "line2"],
        }}
        actions={actions}
      />,
    );

    expect(screen.queryByText("line2")).toBeNull();

    act(() => {
      latestOnUserScrollStateChange?.(false);
    });

    expect(screen.getByText("line2")).toBeTruthy();
  });

  it("does not show or snap old pane lines before the target pane snapshot arrives", () => {
    const sessionA = createSessionDetail({ paneId: "pane-a", customTitle: "Pane A" });
    const sessionB = createSessionDetail({ paneId: "pane-b", customTitle: "Pane B" });
    const actions = buildActions();
    const store = createStore();
    const wrapper = createWrapper(store);
    store.set(logModalSnapRequestAtom, { paneId: "pane-a", version: 1 });
    const { rerender } = render(
      <LogModal
        state={buildState({ session: sessionA, logLines: ["pane-a-line"] })}
        actions={actions}
      />,
      { wrapper },
    );

    expect(screen.getByText("pane-a-line")).toBeTruthy();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    scrollToEnd.mockClear();

    rerender(
      <LogModal state={buildState({ session: sessionB, logLines: [] })} actions={actions} />,
    );

    expect(screen.queryByText("pane-a-line")).toBeNull();
    expect(scrollToEnd).not.toHaveBeenCalled();

    act(() => {
      store.set(logModalSnapRequestAtom, { paneId: "pane-b", version: 2 });
    });
    rerender(
      <LogModal
        state={buildState({ session: sessionB, logLines: ["pane-b-line"] })}
        actions={actions}
      />,
    );

    expect(screen.getByText("pane-b-line")).toBeTruthy();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: "auto" });

    rerender(
      <LogModal
        state={buildState({ session: sessionB, logLines: ["pane-b-line", "next-line"] })}
        actions={actions}
      />,
    );
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  it("resets paused and buffered state when the modal is reopened", () => {
    const session = createSessionDetail();
    const actions = buildActions();
    const wrapper = createWrapper();
    const initialState = buildState({ session, logLines: ["line1"] });
    const { rerender } = render(<LogModal state={initialState} actions={actions} />, { wrapper });

    act(() => {
      latestOnUserScrollStateChange?.(true);
    });
    rerender(
      <LogModal state={{ ...initialState, logLines: ["line1", "buffered"] }} actions={actions} />,
    );
    expect(screen.queryByText("buffered")).toBeNull();

    rerender(<LogModal state={{ ...initialState, open: false }} actions={actions} />);
    rerender(
      <LogModal state={{ ...initialState, logLines: ["line1", "fresh"] }} actions={actions} />,
    );

    expect(screen.getByText("fresh")).toBeTruthy();
    expect(screen.queryByText("buffered")).toBeNull();
    expect(latestFollowOutput).toBe("auto");
  });

  it("uses the virtualizer as the sole scroll-to-bottom authority", () => {
    const scrollTo = vi.fn();
    mockScrollerRef.current = { scrollTo } as unknown as HTMLDivElement;
    const state = buildState({ logLines: ["line1", "line2"] });
    const wrapper = createWrapper();
    const actions = buildActions();
    const { rerender } = render(<LogModal state={state} actions={actions} />, { wrapper });
    scrollToEnd.mockClear();

    act(() => {
      latestOnUserScrollStateChange?.(true);
      latestAtBottomStateChange?.(false);
    });
    expect(latestFollowOutput).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));

    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(latestFollowOutput).toBe("auto");

    rerender(
      <LogModal state={{ ...state, logLines: ["line1", "line2", "new-line"] }} actions={actions} />,
    );
    expect(latestFollowOutput).toBe("auto");
    expect(screen.queryByText("new-line")).toBeNull();

    act(() => {
      latestOnUserScrollStateChange?.(false);
    });
    expect(screen.getByText("new-line")).toBeTruthy();
    expect(latestFollowOutput).toBe("auto");
  });

  it("uses workspace tab label when pwa tabs are enabled", () => {
    mockUseWorkspaceTabs.enabled = true;
    const state = buildState({ open: true, session: createSessionDetail(), logLines: ["line1"] });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<LogModal state={state} actions={actions} />, { wrapper });

    expect(screen.getByLabelText("Open in workspace tab")).toBeTruthy();
  });
});
