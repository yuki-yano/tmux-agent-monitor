import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CommandResponse, SessionSummary } from "@vde-monitor/shared";
import { type ReactNode, type RefObject, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatGridTile } from "./ChatGridTile";

vi.mock("@/features/shared-session-ui/components/AnsiVirtualizedViewport", () => ({
  AnsiVirtualizedViewport: ({
    lines,
    scrollerRef,
  }: {
    lines: string[];
    scrollerRef?: RefObject<HTMLDivElement | null>;
  }) => {
    const lineCounts = new Map<string, number>();

    return (
      <div ref={scrollerRef} data-testid="ansi-viewport">
        {lines.map((line) => {
          const count = lineCounts.get(line) ?? 0;
          lineCounts.set(line, count + 1);
          const lineKey = `${line}-${count}`;
          return (
            <div key={lineKey} data-line-html={line}>
              {line}
            </div>
          );
        })}
      </div>
    );
  },
}));

vi.mock("@/features/shared-session-ui/hooks/useRawInputHandlers", () => ({
  useRawInputHandlers: () => ({
    handleRawBeforeInput: vi.fn(),
    handleRawInput: vi.fn(),
    handleRawKeyDown: vi.fn(),
    handleRawCompositionStart: vi.fn(),
    handleRawCompositionEnd: vi.fn(),
  }),
}));

// Stable mock for useSessionApi — individual methods can be replaced per test via vi.mocked
const mockSessionApi = {
  sendText: vi.fn(async (): Promise<CommandResponse> => ({ ok: true })),
  sendKeys: vi.fn(async (): Promise<CommandResponse> => ({ ok: true })),
  sendRaw: vi.fn(async (): Promise<CommandResponse> => ({ ok: true })),
  updateSessionTitle: vi.fn(async () => undefined),
  resetSessionTitle: vi.fn(async () => undefined),
  uploadImageAttachment: vi.fn(async () => ({ path: "/tmp/img.png" })),
  requestPromptCompletions: vi.fn(async () => ({ items: [] })),
  requestRepoFileSearch: vi.fn(async () => ({
    query: "",
    items: [],
    truncated: false,
    totalMatchedCount: 0,
  })),
};

vi.mock("@/state/session-context", () => ({
  useSessionCoreApi: () => mockSessionApi,
  useSessionFilesApi: () => mockSessionApi,
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
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sessions/$paneId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterContextProvider router={router}>{ui}</RouterContextProvider>);
};

const buildSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  paneId: "pane-1",
  sessionId: "session-id-1",
  sessionName: "session-1",
  windowId: "window-id-1",
  windowIndex: 1,
  paneIndex: 0,
  paneActive: true,
  currentCommand: null,
  currentPath: "/Users/test/repo",
  paneTty: null,
  title: "Session Title",
  customTitle: null,
  branch: "feature/chat-grid",
  worktreePath: "/Users/test/repo",
  worktreeDirty: false,
  worktreeLocked: false,
  worktreeLockOwner: null,
  worktreeLockReason: null,
  worktreeMerged: false,
  repoRoot: "/Users/test/repo",
  agent: "codex",
  state: "RUNNING",
  stateReason: "ok",
  lastMessage: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: "2026-02-17T00:00:00.000Z",
  lastRunStartedAt: null,
  manualSortAt: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
  completion: null,
  ...overrides,
});

describe("ChatGridTile", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("buffers incoming screen lines until an active scroll gesture ends", () => {
    vi.useFakeTimers();
    const props = {
      session: buildSession(),
      nowMs: Date.parse("2026-02-17T00:10:00.000Z"),
      connected: true,
      screenLoading: false,
      screenError: null,
      onTouchSession: vi.fn(async () => undefined),
    };
    const Harness = () => {
      const [lines, setLines] = useState(["line 1"]);
      return (
        <>
          <button type="button" onClick={() => setLines(["line 1", "line 2"])}>
            Update lines
          </button>
          <ChatGridTile {...props} screenLines={lines} />
        </>
      );
    };
    renderWithRouter(<Harness />);

    fireEvent.wheel(screen.getByTestId("ansi-viewport"), { deltaY: -20 });
    fireEvent.click(screen.getByRole("button", { name: "Update lines" }));

    expect(screen.queryByText("line 2")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByText("line 2")).toBeTruthy();
  });

  it("renders header and current branch label", () => {
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Session Title")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit session title" })).toBeTruthy();
    expect(screen.getByText("session-1")).toBeTruthy();
    expect(screen.getByText("feature/chat-grid")).toBeTruthy();
    expect(screen.getByText("Window 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open detail" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from Chat Grid" })).toBeTruthy();
    expect(screen.queryByLabelText("Refresh pane pane-1")).toBeNull();
  });

  it("renders DONE through the shared blue CheckCircle badge path", () => {
    renderWithRouter(
      <ChatGridTile
        session={buildSession({ state: "DONE" })}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    const doneBadge = screen.getByText("DONE").closest("span");
    expect(doneBadge?.className).toContain("text-latte-blue");
    expect(doneBadge?.querySelector("svg")).toBeTruthy();
  });

  it("removes pane from chat grid when remove button is clicked", () => {
    const onRemoveFromGrid = vi.fn();
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onRemoveFromGrid={onRemoveFromGrid}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove from Chat Grid" }));
    expect(onRemoveFromGrid).toHaveBeenCalledWith("pane-1");
  });

  it("edits and saves session title with Enter", async () => {
    mockSessionApi.updateSessionTitle.mockResolvedValueOnce(undefined);
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit session title" }));
    const input = screen.getByRole("textbox", { name: "Custom session title" });
    fireEvent.change(input, { target: { value: "Updated Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockSessionApi.updateSessionTitle).toHaveBeenCalledWith("pane-1", "Updated Title");
      expect(screen.queryByRole("textbox", { name: "Custom session title" })).toBeNull();
    });
  });

  it("closes title editor without mutation when title is unchanged", async () => {
    mockSessionApi.updateSessionTitle.mockClear();
    renderWithRouter(
      <ChatGridTile
        session={buildSession({ customTitle: "Pinned Title" })}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit session title" }));
    const input = screen.getByRole("textbox", { name: "Custom session title" });
    fireEvent.change(input, { target: { value: "Pinned Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockSessionApi.updateSessionTitle).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: "Custom session title" })).toBeNull();
    });
  });

  it("resets custom title", async () => {
    mockSessionApi.resetSessionTitle.mockClear();
    mockSessionApi.updateSessionTitle.mockClear();
    renderWithRouter(
      <ChatGridTile
        session={buildSession({ customTitle: "Pinned Title" })}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset session title" }));

    await waitFor(() => {
      expect(mockSessionApi.resetSessionTitle).toHaveBeenCalledWith("pane-1");
      expect(mockSessionApi.updateSessionTitle).not.toHaveBeenCalled();
    });
  });

  it("sends text through sendText when send is clicked", async () => {
    mockSessionApi.sendText.mockClear();
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hello from tile" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockSessionApi.sendText).toHaveBeenCalledWith(
        "pane-1",
        "hello from tile",
        true,
        expect.any(String),
      );
    });
  });

  it("sends text without Enter when auto-enter is unchecked", async () => {
    mockSessionApi.sendText.mockClear();
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Enter after send" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "draft from tile" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockSessionApi.sendText).toHaveBeenCalledWith(
        "pane-1",
        "draft from tile",
        false,
        expect.any(String),
      );
    });
  });

  it("sends key input from expanded keys panel", async () => {
    mockSessionApi.sendKeys.mockClear();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show key options" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));

    await waitFor(() => {
      expect(mockSessionApi.sendKeys).toHaveBeenCalledWith("pane-1", ["Enter"]);
    });
  });

  it("shows permission shortcuts and sends selected number or Esc", async () => {
    mockSessionApi.sendRaw.mockClear();
    const onTouchSession = vi.fn(async () => undefined);
    renderWithRouter(
      <ChatGridTile
        session={buildSession({ state: "WAITING_PERMISSION" })}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={onTouchSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));

    await waitFor(() => {
      expect(mockSessionApi.sendRaw).toHaveBeenNthCalledWith(
        1,
        "pane-1",
        [{ kind: "text", value: "1" }],
        false,
      );
      expect(mockSessionApi.sendRaw).toHaveBeenNthCalledWith(
        2,
        "pane-1",
        [{ kind: "key", value: "Escape" }],
        false,
      );
    });

    // Locks in ChatGridTile-specific behavior: onTouchSession fires after every
    // successful permission shortcut send (SessionDetail has no equivalent callback).
    await waitFor(() => {
      expect(onTouchSession).toHaveBeenCalledTimes(2);
      expect(onTouchSession).toHaveBeenNthCalledWith(1, "pane-1");
      expect(onTouchSession).toHaveBeenNthCalledWith(2, "pane-1");
    });
  });

  it("does not call onTouchSession when a permission shortcut send fails", async () => {
    mockSessionApi.sendRaw.mockClear();
    mockSessionApi.sendRaw.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL", message: "raw failed" },
    });
    const onTouchSession = vi.fn(async () => undefined);
    renderWithRouter(
      <ChatGridTile
        session={buildSession({ state: "WAITING_PERMISSION" })}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={onTouchSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1" }));

    await waitFor(() => {
      expect(screen.getByText("raw failed")).toBeTruthy();
    });
    expect(onTouchSession).not.toHaveBeenCalled();
  });

  it("clears the composer error banner after a send succeeds following a failure", async () => {
    mockSessionApi.sendKeys.mockClear();
    mockSessionApi.sendKeys.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL", message: "boom" },
    });
    mockSessionApi.sendKeys.mockResolvedValueOnce({ ok: true });
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show key options" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enter" }));

    await waitFor(() => {
      expect(screen.queryByText("boom")).toBeNull();
    });
  });

  it("clears a stale composer error from an unrelated key-send failure after a text send succeeds", async () => {
    mockSessionApi.sendKeys.mockClear();
    mockSessionApi.sendText.mockClear();
    mockSessionApi.sendKeys.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL", message: "boom" },
    });
    mockSessionApi.sendText.mockResolvedValueOnce({ ok: true });
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["line 1"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show key options" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeTruthy();
    });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hello from tile" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockSessionApi.sendText).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText("boom")).toBeNull();
    });
  });

  it("does not show empty fallback while screen is loading", () => {
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={[]}
        screenLoading
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.queryByText("No screen data yet.")).toBeNull();
  });

  it("shows empty fallback when screen is idle with no lines", () => {
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={[]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("No screen data yet.")).toBeTruthy();
  });

  it("linkifies file paths and http/https urls in screen lines", () => {
    renderWithRouter(
      <ChatGridTile
        session={buildSession()}
        nowMs={Date.parse("2026-02-17T00:10:00.000Z")}
        connected
        screenLines={["error at src/main.ts:12 see https://example.com/docs"]}
        screenLoading={false}
        screenError={null}
        onTouchSession={vi.fn(async () => undefined)}
      />,
    );

    const viewport = screen.getByTestId("ansi-viewport");
    const renderedHtml = viewport.querySelector<HTMLElement>("[data-line-html]")?.dataset.lineHtml;

    expect(renderedHtml).toContain("data-vde-file-ref=");
    expect(renderedHtml).toContain("src/main.ts:12");
    expect(renderedHtml).toContain("data-vde-log-url=");
    expect(renderedHtml).toContain("https://example.com/docs");
    expect(renderedHtml).toContain('target="_blank"');
    expect(renderedHtml).toContain('rel="noreferrer noopener"');
  });
});
