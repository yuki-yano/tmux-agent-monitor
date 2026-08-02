import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
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
    diffScope: {
      kind: "workingTree",
      mode: "total",
      baseBranch: "main",
      branch: null,
      path: null,
      selected: false,
    },
    ...overrides,
  });

  const buildActions = (overrides: Partial<DiffSectionActions> = {}): DiffSectionActions => ({
    onRefresh: vi.fn(),
    onToggle: vi.fn(),
    onPreviewFile: vi.fn(),
    onClearScope: vi.fn(),
    onModeChange: vi.fn(),
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
    expect(screen.getByText("1 file")).toBeTruthy();
    expect(screen.getByText("src/index.ts")).toBeTruthy();
    expect(screen.getByText("M 1")).toBeTruthy();
    expect(screen.queryByText("A 0")).toBeNull();
    expect(screen.queryByText("D 0")).toBeNull();
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-0").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("src/index.ts"));
    expect(onToggle).toHaveBeenCalledWith("src/index.ts");
  });

  it("opens a changed file preview without toggling its diff", () => {
    const onToggle = vi.fn();
    const onPreviewFile = vi.fn();
    const state = buildState({ diffSummary: createDiffSummary() });
    const actions = buildActions({ onToggle, onPreviewFile });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Preview src/index.ts" }));

    expect(onPreviewFile).toHaveBeenCalledWith("src/index.ts");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps the diff toggle at the trailing edge after the preview action", () => {
    const onToggle = vi.fn();
    const state = buildState({ diffSummary: createDiffSummary() });
    const actions = buildActions({ onToggle });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const previewButton = screen.getByRole("button", { name: "Preview src/index.ts" });
    const diffButton = screen.getByRole("button", { name: "Show diff for src/index.ts" });

    expect(
      previewButton.compareDocumentPosition(diffButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(diffButton);
    expect(onToggle).toHaveBeenCalledWith("src/index.ts");
  });

  it("does not offer a preview for a deleted file", () => {
    const state = buildState({
      diffSummary: createDiffSummary({
        files: [
          {
            path: "src/removed.ts",
            status: "D",
            staged: false,
            additions: 0,
            deletions: 4,
          },
        ],
      }),
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.queryByRole("button", { name: "Preview src/removed.ts" })).toBeNull();
  });

  it("does not offer a working-tree preview while inspecting a virtual branch", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "branchComparison",
        mode: "committed",
        baseBranch: "main",
        branch: "feature/virtual",
      },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.queryByRole("button", { name: "Preview src/index.ts" })).toBeNull();
  });

  it("shows branch name next to total changes", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "workingTree",
        mode: "uncommitted",
        baseBranch: "main",
        branch: "feature/changes-tab",
        path: null,
        selected: false,
      },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const branch = screen.getByTestId("diff-scope-text");
    expect(branch.textContent).toContain("feature/changes-tab");
    expect(branch.getAttribute("title")).toBe("feature/changes-tab → working tree");
  });

  it("pins refresh button to top-right in header", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "workingTree",
        mode: "total",
        baseBranch: "main",
        branch: "feature/a-very-long-branch-name-to-verify-header-layout",
        path: null,
        selected: false,
      },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const header = screen.getByTestId("changes-header");
    const refresh = screen.getByRole("button", { name: "Refresh changes" });
    expect(header.className).toContain("items-start");
    expect(refresh.className).toContain("self-start");
  });

  it("uses shared truncation component for long branch labels", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "workingTree",
        mode: "total",
        baseBranch: "main",
        branch: "feature/very/long/branch/name/for/start-truncation",
        path: null,
        selected: false,
      },
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const branch = screen.getByTestId("diff-scope-text");
    const summaryLine = screen.getByTestId("diff-summary-line");
    expect(branch.className).toContain("overflow-hidden");
    expect(branch.className).toContain("flex-1");
    expect(branch.className).not.toContain("[direction:rtl]");
    expect(summaryLine.className).toContain("w-full");
  });

  it("shows A/M/D categories to the left of line totals in header summary", () => {
    const state = buildState({
      diffSummary: createDiffSummary({
        files: [
          { path: "a.ts", status: "A", staged: false, additions: 3, deletions: 0 },
          { path: "new.ts", status: "?", staged: false, additions: 2, deletions: 0 },
          { path: "b.ts", status: "D", staged: false, additions: 0, deletions: 2 },
          { path: "c.ts", status: "M", staged: false, additions: 1, deletions: 1 },
          { path: "d.ts", status: "M", staged: false, additions: 4, deletions: 0 },
        ],
      }),
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("A 2")).toBeTruthy();
    expect(screen.getByText("M 2")).toBeTruthy();
    expect(screen.getByText("D 1")).toBeTruthy();
    expect(screen.getByText("+10")).toBeTruthy();
    expect(screen.getByText("-3")).toBeTruthy();
  });

  it("renders clean state and error message", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ files: [] }),
      diffError: "Diff error",
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.getByText("No changes from main through the working tree")).toBeTruthy();
    expect(screen.queryByText("A 0")).toBeNull();
    expect(screen.queryByText("M 0")).toBeNull();
    expect(screen.queryByText("D 0")).toBeNull();
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

  it("resolves file reference links rendered in patch", async () => {
    const onResolveFileReference = vi.fn(async () => undefined);
    const onResolveFileReferenceCandidates = vi.fn(async () => ["src/index.ts:12"]);
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffFiles: { "src/index.ts": createDiffFile({ patch: "+at src/index.ts:12" }) },
      diffOpen: { "src/index.ts": true },
    });
    const actions = buildActions({
      onResolveFileReference,
      onResolveFileReferenceCandidates,
    });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open file src/index.ts:12" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file src/index.ts:12" }));

    expect(onResolveFileReferenceCandidates).toHaveBeenCalledWith(
      expect.arrayContaining(["src/index.ts:12"]),
    );
    expect(onResolveFileReference).toHaveBeenCalledWith("src/index.ts:12");
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

  it("shows the branch comparison range and returns to the working tree", () => {
    const onClearScope = vi.fn();
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "branchComparison",
        mode: "committed",
        baseBranch: "main",
        branch: "feature/virtual",
      },
    });
    const actions = buildActions({ onClearScope });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const notice = screen.getByTestId("diff-scope-notice");
    expect(notice.textContent).toContain("Branch changes");
    expect(notice.textContent).toContain("main...feature/virtual");
    expect(screen.getByTestId("diff-scope-text").textContent).toContain("main...feature/virtual");
    expect(screen.queryByRole("tab", { name: "Total" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Return to current working tree" }));
    expect(onClearScope).toHaveBeenCalled();
  });

  it("shows the selected worktree path and returns to the session worktree", () => {
    const onClearScope = vi.fn();
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "workingTree",
        mode: "total",
        baseBranch: "main",
        branch: "feature/worktree",
        path: "/Users/test/repo-worktrees/feature-worktree",
        selected: true,
      },
    });
    const actions = buildActions({ onClearScope });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const notice = screen.getByTestId("diff-scope-notice");
    expect(notice.textContent).toContain("Total changes");
    expect(notice.textContent).toContain("feature/worktree");
    expect(notice.textContent).toContain("~/repo-worktrees/feature-worktree");

    fireEvent.click(screen.getByRole("button", { name: "Return to session worktree" }));
    expect(onClearScope).toHaveBeenCalled();
  });

  it("describes an empty branch comparison as committed branch state", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ files: [] }),
      diffScope: {
        kind: "branchComparison",
        mode: "committed",
        baseBranch: "main",
        branch: "feature/virtual",
      },
    });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={buildActions()} />, { wrapper });

    expect(
      screen.getByText("No committed changes on feature/virtual since it diverged from main"),
    ).toBeTruthy();
    expect(screen.queryByText("Working tree is clean")).toBeNull();
  });

  it("switches between total, committed, and uncommitted worktree layers", () => {
    const onModeChange = vi.fn();
    const state = buildState({ diffSummary: createDiffSummary() });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={buildActions({ onModeChange })} />, { wrapper });

    expect(screen.getByRole("tab", { name: "Total" }).getAttribute("data-state")).toBe("active");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Committed" }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Uncommitted" }), { button: 0 });

    expect(onModeChange).toHaveBeenNthCalledWith(1, "committed");
    expect(onModeChange).toHaveBeenNthCalledWith(2, "uncommitted");
  });

  it("keeps uncommitted available when the default branch cannot be resolved", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ reason: "default_branch_unavailable", files: [] }),
    });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={buildActions()} />, { wrapper });

    expect(
      screen.getByText(
        "A default branch is required for Total and Committed changes. Uncommitted changes are still available.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Uncommitted" })).toBeTruthy();
    expect(screen.queryByText("No changes from main through the working tree")).toBeNull();
  });

  it("describes an empty uncommitted layer as a clean working tree", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ files: [] }),
      diffScope: {
        kind: "workingTree",
        mode: "uncommitted",
        baseBranch: "main",
        branch: null,
        path: null,
        selected: false,
      },
    });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={buildActions()} />, { wrapper });

    expect(screen.getByText("Working tree is clean")).toBeTruthy();
    expect(screen.getByTestId("diff-scope-text").getAttribute("title")).toBe("HEAD → working tree");
  });

  it("describes the default branch committed layer without self-divergence", () => {
    const state = buildState({
      diffSummary: createDiffSummary({ files: [] }),
      diffScope: {
        kind: "workingTree",
        mode: "committed",
        baseBranch: "main",
        branch: "main",
        path: null,
        selected: false,
      },
    });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={buildActions()} />, { wrapper });

    expect(screen.getByText("No committed changes beyond main")).toBeTruthy();
  });

  it("disables working-tree preview for the committed worktree layer", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffScope: {
        kind: "workingTree",
        mode: "committed",
        baseBranch: "main",
        branch: "feature/worktree",
        path: "/repo/worktree",
        selected: true,
      },
    });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={buildActions()} />, { wrapper });

    expect(screen.queryByRole("button", { name: "Preview src/index.ts" })).toBeNull();
    expect(screen.getByTestId("diff-scope-notice").textContent).toContain("Committed changes");
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
