// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { SessionSummary } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Theme } from "@/lib/theme";

import { useSidebarPreview } from "./useSidebarPreview";

const prefetchPreview = vi.fn();
const previewCache = {
  "pane-1": {
    screen: "line1\nline2",
    capturedAt: new Date(0).toISOString(),
    updatedAt: Date.now(),
  },
};

vi.mock("./useSessionPreview", () => ({
  useSessionPreview: () => ({
    previewCache,
    previewLoading: {},
    previewError: {},
    prefetchPreview,
  }),
}));

vi.mock("@/lib/ansi", () => ({
  renderAnsiLines: (text: string) => text.split("\n"),
}));

describe("useSidebarPreview", () => {
  afterEach(() => {
    prefetchPreview.mockClear();
  });

  const createSession = (): SessionSummary => ({
    paneId: "pane-1",
    sessionName: "session-1",
    windowIndex: 1,
    paneIndex: 1,
    windowActivity: null,
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
    paneDead: false,
    alternateOn: false,
    pipeAttached: false,
    pipeConflict: false,
  });

  const setup = () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const session = createSession();
    const sessionIndex = new Map<string, SessionSummary>([[session.paneId, session]]);
    const resolvedTheme = "latte" as Theme;
    const requestScreen = vi.fn();

    return renderHook(() =>
      useSidebarPreview({
        sessionIndex,
        currentPaneId: null,
        connected: true,
        connectionIssue: null,
        requestScreen,
        resolvedTheme,
      }),
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

    expect(result.current.preview?.title).toBe("Custom Title");
    expect(result.current.preview?.lines).toEqual(["line1", "line2"]);
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
});
