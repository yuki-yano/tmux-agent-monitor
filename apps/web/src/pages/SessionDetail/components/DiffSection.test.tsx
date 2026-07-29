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
    diffBranch: null,
    diffError: null,
    diffLoading: false,
    diffFiles: {},
    diffOpen: {},
    diffLoadingFiles: {},
    virtualBranch: null,
    ...overrides,
  });

  const buildActions = (overrides: Partial<DiffSectionActions> = {}): DiffSectionActions => ({
    onRefresh: vi.fn(),
    onToggle: vi.fn(),
    onPreviewFile: vi.fn(),
    onClearVirtualBranch: vi.fn(),
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
      virtualBranch: "feature/virtual",
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    expect(screen.queryByRole("button", { name: "Preview src/index.ts" })).toBeNull();
  });

  it("shows branch name next to total changes", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffBranch: "feature/changes-tab",
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const branch = screen.getByTestId("diff-branch-text");
    expect(branch.textContent).toContain("feature/changes-tab");
    expect(branch.getAttribute("title")).toBe("feature/changes-tab");
  });

  it("pins refresh button to top-right in header", () => {
    const state = buildState({
      diffSummary: createDiffSummary(),
      diffBranch: "feature/a-very-long-branch-name-to-verify-header-layout",
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
      diffBranch: "feature/very/long/branch/name/for/start-truncation",
    });
    const actions = buildActions();
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const branch = screen.getByTestId("diff-branch-text");
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

    expect(screen.getByText("Working directory is clean")).toBeTruthy();
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

  it("shows virtual branch badge with clear button when a virtual branch is active", () => {
    const onClearVirtualBranch = vi.fn();
    const state = buildState({
      diffSummary: createDiffSummary(),
      virtualBranch: "feature/virtual",
    });
    const actions = buildActions({ onClearVirtualBranch });
    const wrapper = createWrapper();
    render(<DiffSection state={state} actions={actions} />, { wrapper });

    const notice = screen.getByTestId("diff-virtual-branch-notice");
    expect(notice.textContent).toContain("feature/virtual");

    fireEvent.click(screen.getByRole("button", { name: "Clear virtual branch" }));
    expect(onClearVirtualBranch).toHaveBeenCalled();
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
