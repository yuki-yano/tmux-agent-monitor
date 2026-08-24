import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/state/theme-context";

import { createSessionDetail } from "../test-helpers";
import { SessionHeader } from "./SessionHeader";

describe("SessionHeader", () => {
  afterEach(() => {
    cleanup();
  });

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
    const renderResult = render(
      <RouterContextProvider router={router}>
        <ThemeProvider>{ui}</ThemeProvider>
      </RouterContextProvider>,
    );
    return {
      ...renderResult,
      rerenderWithRouter: (nextUi: ReactNode) =>
        renderResult.rerender(
          <RouterContextProvider router={router}>
            <ThemeProvider>{nextUi}</ThemeProvider>
          </RouterContextProvider>,
        ),
    };
  };

  type SessionHeaderState = Parameters<typeof SessionHeader>[0]["state"];
  type SessionHeaderActions = Parameters<typeof SessionHeader>[0]["actions"];

  const buildState = (overrides: Partial<SessionHeaderState> = {}): SessionHeaderState => ({
    session: createSessionDetail(),
    connectionIssue: null,
    nowMs: Date.now(),
    titleDraft: "",
    titleEditing: false,
    titleSaving: false,
    titleError: null,
    ...overrides,
  });

  const buildActions = (overrides: Partial<SessionHeaderActions> = {}): SessionHeaderActions => ({
    onTitleDraftChange: vi.fn(),
    onTitleSave: vi.fn(),
    onTitleReset: vi.fn(),
    onOpenTitleEditor: vi.fn(),
    onCloseTitleEditor: vi.fn(),
    onTouchSession: vi.fn(),
    ...overrides,
  });

  it("renders session title and metadata", () => {
    const session = createSessionDetail({
      customTitle: "Custom Title",
      branch: "feature/vw-pill",
    });
    const state = buildState({
      session,
      titleDraft: "Custom Title",
    });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    const titleButton = screen.getByRole("button", { name: "Edit session title" });
    expect(titleButton.textContent).toContain("Custom Title");
    expect(screen.getByText("RUNNING")).toBeTruthy();
    expect(screen.queryByText("feature/vw-pill")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));

    expect(screen.getByText("feature/vw-pill")).toBeTruthy();
    expect(screen.getByText("Session session-1")).toBeTruthy();
    expect(screen.getByText("Window 1")).toBeTruthy();
    expect(screen.getByText("Pane pane-1")).toBeTruthy();
  });

  it("uses full remaining width for title button", () => {
    const session = createSessionDetail({
      customTitle: "Implemented summary in monitor and notification pipeline",
    });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    const titleButton = screen.getByRole("button", { name: "Edit session title" });
    expect(titleButton.className).toContain("flex-1");
    expect(titleButton.className).toContain("truncate");
    expect(titleButton.className).toContain("font-ident");
    expect(titleButton.className).toContain("tracking-normal");
  });

  it("renders current path with shared truncated-path component style", () => {
    const session = createSessionDetail({
      currentPath: "/tmp/vde-monitor/.worktree/feature/very/long/session/header/path",
    });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    const pathElement = screen.getByTestId("session-header-current-path");
    expect(pathElement.className).toContain("overflow-hidden");
    expect(pathElement.className).toContain("basis-full");
    expect(pathElement.className).toContain("font-mono");
    expect(pathElement.className).toContain("tracking-tight");
    expect(pathElement.textContent).toContain(".worktree/feature/very/long");
    expect(pathElement.getAttribute("title")).toContain(".worktree/feature/very/long");
  });

  it("does not render worktree flags in header details", () => {
    const session = createSessionDetail({
      worktreePath: "/Users/test/repo/.worktree/feature/awesome",
      worktreeDirty: true,
      worktreeLocked: false,
      worktreeMerged: false,
    });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));

    expect(screen.queryByText("Dirty:Y")).toBeNull();
    expect(screen.queryByText("Lock:N")).toBeNull();
    expect(screen.queryByText("PR:Y")).toBeNull();
    expect(screen.queryByText("Merged:N")).toBeNull();
  });

  it("handles title editing interactions", () => {
    const session = createSessionDetail({ customTitle: "Custom Title" });
    const onTitleDraftChange = vi.fn();
    const onTitleSave = vi.fn();
    const onCloseTitleEditor = vi.fn();
    const state = buildState({
      session,
      titleDraft: "Custom Title",
      titleEditing: true,
    });
    const actions = buildActions({
      onTitleDraftChange,
      onTitleSave,
      onCloseTitleEditor,
    });

    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    const input = screen.getByLabelText("Custom session title") as HTMLInputElement;
    expect(input.className).toContain("font-ident");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    fireEvent.change(input, { target: { value: "Updated Title" } });
    expect(onTitleDraftChange).toHaveBeenCalledWith("Updated Title");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTitleSave).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCloseTitleEditor).toHaveBeenCalled();
  });

  it("does not select the title again during an unrelated rerender", () => {
    const session = createSessionDetail({ customTitle: "Custom Title" });
    const state = buildState({ session, titleDraft: "Custom Title", titleEditing: true });
    const actions = buildActions();
    const { rerenderWithRouter } = renderWithRouter(
      <SessionHeader state={state} actions={actions} />,
    );
    const input = screen.getByLabelText("Custom session title") as HTMLInputElement;
    input.setSelectionRange(3, 3);

    rerenderWithRouter(
      <SessionHeader state={{ ...state, nowMs: state.nowMs + 1000 }} actions={actions} />,
    );

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
  });

  it("calls touch handler when pin button is pressed", () => {
    const onTouchSession = vi.fn();
    const state = buildState({ session: createSessionDetail() });
    const actions = buildActions({ onTouchSession });
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));
    fireEvent.click(screen.getByLabelText("Move pane to top"));
    expect(onTouchSession).toHaveBeenCalled();
  });

  it("shows GitHub button when repo URL is resolvable", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const session = createSessionDetail({ repoRoot: "/Users/test/repos/github.com/acme/project" });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));
    fireEvent.click(screen.getByLabelText("Open repository on GitHub"));

    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/acme/project",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("hides GitHub button when repo URL cannot be resolved", () => {
    const session = createSessionDetail({ repoRoot: "/Users/test/local-repo" });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));
    expect(screen.queryByLabelText("Open repository on GitHub")).toBeNull();
  });

  it("renders alerts when pipe conflict or connection issue exists", () => {
    const session = createSessionDetail({ pipeConflict: true });
    const state = buildState({
      session,
      connectionIssue: "Connection lost",
      titleDraft: "Custom Title",
      titleError: "Title error",
    });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));
    expect(screen.getByText("Another pipe-pane is attached. Screen is capture-only.")).toBeTruthy();
    expect(screen.getByText("Connection lost")).toBeTruthy();
    expect(screen.getByText("Title error")).toBeTruthy();
  });

  it("toggles header details", () => {
    const state = buildState({ session: createSessionDetail({ branch: "feature/toggle" }) });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    expect(screen.queryByText("feature/toggle")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show header details" }));
    expect(screen.getByText("feature/toggle")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide header details" }));
    expect(screen.queryByText("feature/toggle")).toBeNull();
  });

  it("shows EDITOR badge for unknown state with vim command", () => {
    const session = createSessionDetail({
      state: "UNKNOWN",
      currentCommand: "vim",
      agent: "unknown",
    });
    const state = buildState({
      session,
      titleDraft: "Session Title",
    });
    const actions = buildActions();

    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    const editorBadge = screen.getByText("EDITOR");
    expect(editorBadge.className).toContain("text-latte-maroon");
    expect(screen.queryByText("UNKNOWN")).toBeNull();
  });

  it("shows reset button when custom title is set", () => {
    const session = createSessionDetail({ customTitle: "Custom" });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    expect(screen.getByLabelText("Reset session title")).toBeTruthy();
  });

  it("shows reset button when title is set without custom title", () => {
    const session = createSessionDetail({
      customTitle: null,
      title: "✳ Initial Greeting",
      currentPath: "/Users/test/repo",
    });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    expect(screen.getByLabelText("Reset session title")).toBeTruthy();
  });

  it("hides reset button when both custom title and title are unset", () => {
    const session = createSessionDetail({
      customTitle: null,
      title: null,
      currentPath: "/Users/test/repo",
    });
    const state = buildState({ session });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    expect(screen.queryByLabelText("Reset session title")).toBeNull();
  });
});
