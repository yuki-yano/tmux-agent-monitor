import { act, renderHook, waitFor } from "@testing-library/react";
import type { SessionStateTimeline, SessionSummary } from "@vde-monitor/shared";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Theme } from "@/lib/theme";

import {
  sidebarHoveredPaneIdAtom,
  sidebarPreviewFrameAtom,
} from "@/features/shared-session-ui/atoms/sidebarPreviewAtoms";
import { useSidebarPreview } from "@/features/shared-session-ui/hooks/useSidebarPreview";
import { useSidebarPreviewTimelineCache } from "@/features/shared-session-ui/hooks/useSidebarPreviewTimelineCache";

const prefetchPreview = vi.fn();
const previewCache: Record<
  string,
  {
    screen: string;
    capturedAt: string;
    updatedAt: number;
  }
> = {
  "pane-1": {
    screen: "line1\nline2",
    capturedAt: new Date(0).toISOString(),
    updatedAt: Date.now(),
  },
};

vi.mock("@/features/shared-session-ui/hooks/useScreenCache", () => ({
  useScreenCache: () => ({
    cache: previewCache,
    loading: {},
    error: {},
    fetchScreen: prefetchPreview,
    clearCache: vi.fn(),
  }),
}));

vi.mock("@/lib/ansi", () => ({
  renderAnsiLines: (text: string) => text.split("\n"),
}));

describe("useSidebarPreview", () => {
  const createTimeline = (paneId: string): SessionStateTimeline => ({
    paneId,
    now: new Date(0).toISOString(),
    range: "1h",
    totalsMs: {
      RUNNING: 1000,
      DONE: 0,
      WAITING_INPUT: 0,
      WAITING_PERMISSION: 0,
      SHELL: 0,
      UNKNOWN: 0,
    },
    current: {
      id: "timeline-current",
      paneId,
      state: "RUNNING",
      reason: "running",
      startedAt: new Date(0).toISOString(),
      endedAt: null,
      durationMs: 1000,
      source: "poll",
    },
    items: [
      {
        id: "timeline-current",
        paneId,
        state: "RUNNING",
        reason: "running",
        startedAt: new Date(0).toISOString(),
        endedAt: null,
        durationMs: 1000,
        source: "poll",
      },
    ],
  });

  afterEach(() => {
    prefetchPreview.mockClear();
    previewCache["pane-1"]!.screen = "line1\nline2";
    delete previewCache["pane-2"];
  });

  const createSession = (): SessionSummary => ({
    paneId: "pane-1",
    sessionId: "session-id-1",
    sessionName: "session-1",
    windowId: "window-id-1",
    windowIndex: 1,
    paneIndex: 1,
    paneActive: true,
    currentCommand: null,
    currentPath: null,
    paneTty: null,
    title: "Session Title",
    customTitle: "Custom Title",
    repoRoot: null,
    agent: "codex",
    state: "RUNNING",
    stateReason: "active",
    lastMessage: null,
    lastOutputAt: null,
    lastEventAt: null,
    lastInputAt: null,
    lastRunStartedAt: null,
    manualSortAt: null,
    paneDead: false,
    alternateOn: false,
    pipeAttached: false,
    pipeConflict: false,
    completion: null,
  });

  const setup = (options?: { innerWidth?: number; innerHeight?: number }) => {
    Object.defineProperty(window, "innerWidth", {
      value: options?.innerWidth ?? 1200,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: options?.innerHeight ?? 800,
      configurable: true,
    });
    const session = createSession();
    const sessionIndex = new Map<string, SessionSummary>([[session.paneId, session]]);
    const resolvedTheme = "latte" as Theme;
    const requestScreen = vi.fn();
    const requestStateTimeline = vi.fn((paneId: string) => Promise.resolve(createTimeline(paneId)));
    const store = createStore();
    store.set(sidebarHoveredPaneIdAtom, null);
    store.set(sidebarPreviewFrameAtom, null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    return renderHook(
      () =>
        useSidebarPreview({
          sessionIndex,
          currentPaneId: null,
          connected: true,
          connectionIssue: null,
          requestStateTimeline,
          requestScreen,
          resolvedTheme,
        }),
      { wrapper },
    );
  };

  it("builds preview data on focus", async () => {
    const { result } = setup();

    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      ({
        width: 200,
        height: 40,
        top: 100,
        left: 20,
        right: 220,
        bottom: 140,
        x: 20,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.registerItemRef("pane-1", node);
      result.current.handleFocus("pane-1");
    });

    await waitFor(() => {
      expect(result.current.preview).not.toBeNull();
    });
    await waitFor(() => {
      expect(result.current.preview?.timeline?.paneId).toBe("pane-1");
    });

    expect(result.current.preview?.title).toBe("Custom Title");
    expect(result.current.preview?.sessionName).toBe("session-1");
    expect(result.current.preview?.windowIndex).toBe(1);
    expect(result.current.preview?.paneId).toBe("pane-1");
    expect(result.current.preview?.lines).toEqual(["line1", "line2"]);
    expect(result.current.preview?.timeline?.paneId).toBe("pane-1");
    expect(result.current.preview?.timelineLoading).toBe(false);
    expect(result.current.preview?.timelineError).toBeNull();
    expect(prefetchPreview).toHaveBeenCalledWith("pane-1");
  });

  it("clears preview on select", async () => {
    const { result } = setup();
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      ({
        width: 200,
        height: 40,
        top: 100,
        left: 20,
        right: 220,
        bottom: 140,
        x: 20,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.registerItemRef("pane-1", node);
      result.current.handleFocus("pane-1");
    });

    await waitFor(() => {
      expect(result.current.preview).not.toBeNull();
    });

    act(() => {
      result.current.handleSelect();
    });

    await waitFor(() => {
      expect(result.current.preview).toBeNull();
    });
  });

  it("falls back to default title and no log data text when metadata is missing", async () => {
    previewCache["pane-2"] = {
      screen: "",
      capturedAt: new Date(0).toISOString(),
      updatedAt: Date.now(),
    };

    const { result } = setup();
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      ({
        width: 180,
        height: 36,
        top: 120,
        left: 24,
        right: 204,
        bottom: 156,
        x: 24,
        y: 120,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.registerItemRef("pane-2", node);
      result.current.handleFocus("pane-2");
    });

    await waitFor(() => {
      expect(result.current.preview).not.toBeNull();
    });
    await waitFor(() => {
      expect(result.current.preview?.timeline?.paneId).toBe("pane-2");
    });

    expect(result.current.preview?.title).toBe("Session");
    expect(result.current.preview?.sessionName).toBeNull();
    expect(result.current.preview?.windowIndex).toBeNull();
    expect(result.current.preview?.lines).toEqual(["No log data"]);
    expect(result.current.preview?.timeline?.paneId).toBe("pane-2");
    expect(prefetchPreview).toHaveBeenCalledWith("pane-2");
  });

  it("expands preview height on large displays", async () => {
    const { result } = setup({ innerHeight: 1400 });
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      ({
        width: 200,
        height: 40,
        top: 100,
        left: 20,
        right: 220,
        bottom: 140,
        x: 20,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.registerItemRef("pane-1", node);
      result.current.handleFocus("pane-1");
    });

    await waitFor(() => {
      expect(result.current.preview).not.toBeNull();
    });

    expect(result.current.preview?.frame.height).toBeGreaterThan(760);
  });

  it("deduplicates cached timelines and refetches after the pane is pruned", async () => {
    const session = createSession();
    const requestStateTimeline = vi.fn((paneId: string) => Promise.resolve(createTimeline(paneId)));
    const { result, rerender } = renderHook(
      ({ sessionIndex }: { sessionIndex: Map<string, SessionSummary> }) =>
        useSidebarPreviewTimelineCache({
          hoveredPaneId: session.paneId,
          sessionIndex,
          requestStateTimeline,
        }),
      {
        initialProps: {
          sessionIndex: new Map([[session.paneId, session]]),
        },
      },
    );

    await act(async () => {
      await result.current.fetchTimeline(session.paneId);
      await result.current.fetchTimeline(session.paneId);
    });
    expect(requestStateTimeline).toHaveBeenCalledTimes(1);

    rerender({ sessionIndex: new Map() });
    await waitFor(() => {
      expect(result.current.hoveredTimeline).toBeNull();
    });

    rerender({ sessionIndex: new Map([[session.paneId, session]]) });
    await act(async () => {
      await result.current.fetchTimeline(session.paneId);
    });
    expect(requestStateTimeline).toHaveBeenCalledTimes(2);
  });
});
