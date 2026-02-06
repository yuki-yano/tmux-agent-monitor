// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { diffExpandedAtom } from "../atoms/diffAtoms";
import { createDiffFile, createDiffSummary } from "../test-helpers";
import { DiffSection } from "./DiffSection";

describe("DiffSection", () => {
  type DiffSectionState = Parameters<typeof DiffSection>[0]["state"];
  type DiffSectionActions = Parameters<typeof DiffSection>[0]["actions"];

  const createWrapper = () => {
    const store = createStore();
    store.set(diffExpandedAtom, {});
    return ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
  };

  const buildState = (overrides: Partial<DiffSectionState> = {}): DiffSectionState => ({
    diffSummary: null,
    diffError: null,
    diffLoading: false,
    diffFiles: {},
    diffOpen: {},
    diffLoadingFiles: {},
    ...overrides,
  });

  const buildActions = (overrides: Partial<DiffSectionActions> = {}): DiffSectionActions => ({
    onRefresh: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  });

  it("renders diff summary and handles toggle", () => {
    const diffSummary = createDiffSummary();
    const onToggle = vi.fn();
    const state = buildState({ diffSummary });
    const actions = buildActions({ onToggle });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByText("src/index.ts")).toBeTruthy();
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-0").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("src/index.ts"));
    expect(onToggle).toHaveBeenCalledWith("src/index.ts");
  });

  it("renders clean state and error message", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ files: [] }),
      diffError: "Diff error",
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("Working directory is clean")).toBeTruthy();
    expect(screen.getByText("+0")).toBeTruthy();
    expect(screen.getByText("-0")).toBeTruthy();
    expect(screen.getByText("Diff error")).toBeTruthy();
  });

  it("shows patch content when open", () => {
    const diffSummary = createDiffSummary();
    const diffFile = createDiffFile({ patch: "+hello\n-world" });
    const state = buildState({
      diffSummary,
      diffFiles: { "src/index.ts": diffFile },
      diffOpen: { "src/index.ts": true },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("+hello")).toBeTruthy();
    expect(screen.getByText("-world")).toBeTruthy();
  });

  it("expands large diff when requested", () => {
    const diffSummary = createDiffSummary();
    const longPatch = Array.from({ length: 1201 }, (_, index) => `+line-${index + 1}`).join("\n");
    const diffFile = createDiffFile({ patch: longPatch });
    const state = buildState({
      diffSummary,
      diffFiles: { "src/index.ts": diffFile },
      diffOpen: { "src/index.ts": true },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("Render full diff")).toBeTruthy();
    expect(screen.queryByText("+line-300")).toBeNull();

    fireEvent.click(screen.getByText("Render full diff"));

    expect(screen.getByText("+line-300")).toBeTruthy();
  });

  it("renders repository reason callout", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ reason: "not_git" }),
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("Current directory is not a git repository.")).toBeTruthy();
  });

  it("shows no diff message when file patch is unavailable", () => {
    const diffSummary = createDiffSummary();
    const state = buildState({
      diffSummary,
      diffFiles: { "src/index.ts": createDiffFile({ patch: null, binary: false }) },
      diffOpen: { "src/index.ts": true },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("No diff available.")).toBeTruthy();
  });
});
