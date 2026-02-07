// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/state/theme-context";

import { createSessionDetail } from "../test-helpers";
import { SessionHeader } from "./SessionHeader";

describe("SessionHeader", () => {
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
    onTitleClear: vi.fn(),
    onOpenTitleEditor: vi.fn(),
    onCloseTitleEditor: vi.fn(),
    onTouchSession: vi.fn(),
    ...overrides,
  });

  it("renders session title and metadata", () => {
    const session = createSessionDetail({ customTitle: "Custom Title" });
    const state = buildState({
      session,
      titleDraft: "Custom Title",
    });
    const actions = buildActions();
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    const titleButton = screen.getByRole("button", { name: "Edit session title" });
    expect(titleButton.textContent).toContain("Custom Title");
    expect(screen.getByText("Session session-1")).toBeTruthy();
    expect(screen.getByText("Window 1")).toBeTruthy();
    expect(screen.getByText("Pane pane-1")).toBeTruthy();
    expect(screen.getByText("RUNNING")).toBeTruthy();
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

    const input = screen.getByLabelText("Custom session title");
    fireEvent.change(input, { target: { value: "Updated Title" } });
    expect(onTitleDraftChange).toHaveBeenCalledWith("Updated Title");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTitleSave).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCloseTitleEditor).toHaveBeenCalled();
  });

  it("calls touch handler when pin button is pressed", () => {
    const onTouchSession = vi.fn();
    const state = buildState({ session: createSessionDetail() });
    const actions = buildActions({ onTouchSession });
    renderWithRouter(<SessionHeader state={state} actions={actions} />);

    fireEvent.click(screen.getByLabelText("Pin session to top"));
    expect(onTouchSession).toHaveBeenCalled();
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

    expect(screen.getByText("Another pipe-pane is attached. Screen is capture-only.")).toBeTruthy();
    expect(screen.getByText("Connection lost")).toBeTruthy();
    expect(screen.getByText("Title error")).toBeTruthy();
  });
});
