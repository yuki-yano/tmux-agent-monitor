import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createSessionDetail } from "../test-helpers";
import { useScreenPanelState } from "./useScreenPanelState";

let mockContextValue: Record<string, unknown> = {};

vi.mock("../SessionDetailProvider", () => ({
  useSessionDetailContext: () => mockContextValue,
}));

const buildContextValue = () => {
  const session = createSessionDetail({
    paneId: "pane-1",
    agent: "codex",
  });
  return {
    base: {
      session,
    },
    terminal: {
      screen: {
        mode: "text",
        wrapMode: "off",
        screenLines: ["line"],
        imageBase64: null,
        fallbackReason: null,
        error: null,
        pollingPauseReason: null,
        isScreenLoading: false,
        isAtBottom: true,
        handleAtBottomChange: vi.fn(),
        handleUserScrollStateChange: vi.fn(),
        shouldFollowOutput: true,
        scrollToBottom: vi.fn(),
        handleModeChange: vi.fn(),
        toggleWrapMode: vi.fn(),
        viewportRef: { current: null },
        scrollerRef: { current: null },
      },
      controls: {
        sendError: null,
      },
      handleRefreshScreen: vi.fn(),
    },
    scope: {
      virtualWorktree: {
        refreshWorktrees: vi.fn(),
        effectiveBranch: null,
        effectiveWorktreePath: null,
        repoRoot: null,
        baseBranch: null,
        selectorEnabled: false,
        loading: false,
        error: null,
        entries: [],
        actualWorktreePath: null,
        virtualWorktreePath: null,
        clearVirtualWorktree: vi.fn(),
      },
      selectVirtualWorktree: vi.fn(),
    },
    pushNotifications: {
      status: "idle",
      pushEnabled: true,
      isSubscribed: false,
      isPaneEnabled: false,
      errorMessage: null,
      requestPermissionAndSubscribe: vi.fn(),
      togglePaneEnabled: vi.fn(),
    },
  };
};

describe("useScreenPanelState", () => {
  it("maps the send-scoped error separately from the screen error", () => {
    mockContextValue = buildContextValue();
    (mockContextValue.terminal as { screen: Record<string, unknown> }).screen.error =
      "Disconnected. Reconnecting...";
    (mockContextValue.terminal as { controls: Record<string, unknown> }).controls.sendError =
      "Failed to send keys.";

    const { result } = renderHook(() => useScreenPanelState());

    expect(result.current.error).toBe("Disconnected. Reconnecting...");
    expect(result.current.sendError).toBe("Failed to send keys.");
  });

  it("maps push notification errors for ScreenPanel", () => {
    mockContextValue = buildContextValue();
    (mockContextValue.pushNotifications as Record<string, unknown>).errorMessage =
      "Failed to update notification scope";

    const { result } = renderHook(() => useScreenPanelState());

    expect(result.current.notificationErrorMessage).toBe("Failed to update notification scope");
  });

  it("maps worktree subhook fields into the disambiguated ScreenPanel shape", () => {
    mockContextValue = buildContextValue();
    (mockContextValue.scope as { virtualWorktree: Record<string, unknown> }).virtualWorktree = {
      ...(mockContextValue.scope as { virtualWorktree: Record<string, unknown> }).virtualWorktree,
      selectorEnabled: true,
      repoRoot: "/repo",
      baseBranch: "main",
    };

    const { result } = renderHook(() => useScreenPanelState());

    expect(result.current.worktreeSelectorEnabled).toBe(true);
    expect(result.current.worktreeRepoRoot).toBe("/repo");
    expect(result.current.worktreeBaseBranch).toBe("main");
  });
});
