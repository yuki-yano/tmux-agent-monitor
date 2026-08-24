import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionDetailScopeContextValue } from "../SessionDetailContexts";
import { ConnectedWorktreeSection, WorktreeSection } from "./WorktreeSection";

let mockScope: SessionDetailScopeContextValue;

vi.mock("../SessionDetailContexts", () => ({
  useSessionDetailScope: () => mockScope,
}));

describe("WorktreeSection", () => {
  type WorktreeSectionState = Parameters<typeof WorktreeSection>[0]["state"];
  type WorktreeSectionActions = Parameters<typeof WorktreeSection>[0]["actions"];

  const buildState = (overrides: Partial<WorktreeSectionState> = {}): WorktreeSectionState => ({
    worktreeSelectorEnabled: true,
    worktreeSelectorLoading: false,
    worktreeSelectorError: null,
    worktreeEntries: [
      {
        path: "/Users/test/repos/github.com/acme/repo/.worktree/feature-a",
        branch: "feature/a",
        dirty: false,
        locked: false,
        lockOwner: null,
        lockReason: null,
        merged: false,
        prStatus: "open",
        prUrl: "https://github.com/acme/repo/pull/123",
        ahead: 1,
        behind: 0,
        fileChanges: { add: 1, m: 2, d: 0 },
        additions: 10,
        deletions: 2,
      },
    ],
    worktreeRepoRoot: "/Users/test/repos/github.com/acme/repo",
    worktreeBaseBranch: "main",
    actualWorktreePath: "/Users/test/repos/github.com/acme/repo",
    virtualWorktreePath: "/Users/test/repos/github.com/acme/repo/.worktree/feature-a",
    ...overrides,
  });

  const buildActions = (
    overrides: Partial<WorktreeSectionActions> = {},
  ): WorktreeSectionActions => ({
    onRefreshWorktrees: vi.fn(),
    onSelectVirtualWorktree: vi.fn(),
    onClearVirtualWorktree: vi.fn(),
    ...overrides,
  });

  it("renders refresh button in header with same size as other section headers", () => {
    const state = buildState();
    const actions = buildActions();
    render(<WorktreeSection state={state} actions={actions} />);

    const refreshButton = screen.getByRole("button", { name: "Refresh worktrees" });
    expect(refreshButton.className).toContain("h-[30px]");
    expect(refreshButton.className).toContain("w-[30px]");
    fireEvent.click(refreshButton);
    expect(actions.onRefreshWorktrees).toHaveBeenCalledTimes(1);
  });

  it("renders worktree list without internal scroll container", () => {
    const state = buildState();
    const actions = buildActions();
    render(<WorktreeSection state={state} actions={actions} />);

    const section = screen.getByTestId("worktree-section");
    expect(section.querySelector('[class*="overflow-y-auto"]')).toBeNull();
    expect(section.querySelector('[class*="max-h-"]')).toBeNull();
  });

  it("renders PR link button next to branch when prUrl is available", () => {
    const state = buildState();
    const actions = buildActions();
    render(<WorktreeSection state={state} actions={actions} />);

    const prLink = screen.getByRole("link", { name: "Open pull request for feature/a" });
    const fileChangeBadge = screen.getByText("A 1");
    expect(prLink.getAttribute("href")).toBe("https://github.com/acme/repo/pull/123");
    expect(prLink.getAttribute("target")).toBe("_blank");
    expect(prLink.getAttribute("rel")).toContain("noopener");
    expect(
      prLink.compareDocumentPosition(fileChangeBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("does not render PR link button when prUrl is missing", () => {
    const state = buildState({
      worktreeEntries: [
        {
          path: "/Users/test/repos/github.com/acme/repo/.worktree/feature-a",
          branch: "feature/a",
          dirty: false,
          locked: false,
          lockOwner: null,
          lockReason: null,
          merged: false,
          prStatus: "merged",
          prUrl: null,
          ahead: 0,
          behind: 0,
          fileChanges: { add: 0, m: 0, d: 0 },
          additions: 0,
          deletions: 0,
        },
      ],
    });
    const actions = buildActions();
    render(<WorktreeSection state={state} actions={actions} />);

    expect(screen.queryByRole("link", { name: /Open pull request for/ })).toBeNull();
  });

  it("does not render PR link button when PR is not available", () => {
    const state = buildState({
      worktreeEntries: [
        {
          path: "/Users/test/repos/github.com/acme/repo/.worktree/feature-a",
          branch: "feature/a",
          dirty: false,
          locked: false,
          lockOwner: null,
          lockReason: null,
          merged: false,
          prStatus: "none",
          prUrl: null,
          ahead: 0,
          behind: 0,
          fileChanges: { add: 0, m: 0, d: 0 },
          additions: 0,
          deletions: 0,
        },
      ],
    });
    const actions = buildActions();
    render(<WorktreeSection state={state} actions={actions} />);

    expect(screen.queryByRole("link", { name: /Open pull request for/ })).toBeNull();
  });

  it("shows repo root badge on the next line after branch label", () => {
    const state = buildState({
      worktreeEntries: [
        {
          path: "/Users/test/repos/github.com/acme/repo",
          branch: "main",
          dirty: false,
          locked: false,
          lockOwner: null,
          lockReason: null,
          merged: false,
          prStatus: "open",
          prUrl: "https://github.com/acme/repo/pull/999",
          ahead: 0,
          behind: 0,
          fileChanges: { add: 0, m: 0, d: 0 },
          additions: 0,
          deletions: 0,
        },
      ],
      actualWorktreePath: "/Users/test/repos/github.com/acme/repo",
      virtualWorktreePath: "/Users/test/repos/github.com/acme/repo",
    });
    const actions = buildActions();
    render(<WorktreeSection state={state} actions={actions} />);

    const repoRootBadge = screen.getByText("Repo Root");
    const prLink = screen.getByRole("link", { name: "Open pull request for main" });
    expect(repoRootBadge.parentElement?.className).toContain("mt-1");
    expect(
      prLink.compareDocumentPosition(repoRootBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("maps scope refresh, select, and clear actions through the connected entry", () => {
    const state = buildState();
    const refreshWorktrees = vi.fn(async () => undefined);
    const selectVirtualWorktree = vi.fn();
    const clearVirtualWorktree = vi.fn();
    mockScope = {
      virtualWorktree: {
        selectorEnabled: state.worktreeSelectorEnabled,
        loading: state.worktreeSelectorLoading,
        error: state.worktreeSelectorError,
        entries: state.worktreeEntries,
        repoRoot: state.worktreeRepoRoot,
        baseBranch: state.worktreeBaseBranch,
        actualWorktreePath: state.actualWorktreePath,
        virtualWorktreePath: state.virtualWorktreePath,
        effectiveWorktreePath: state.virtualWorktreePath,
        effectiveBranch: null,
        refreshWorktrees,
        clearVirtualWorktree,
      },
      selectVirtualWorktree,
    } as unknown as SessionDetailScopeContextValue;

    render(<ConnectedWorktreeSection />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh worktrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear virtual worktree" }));
    fireEvent.click(screen.getByRole("button", { name: /feature\/a/ }));

    expect(refreshWorktrees).toHaveBeenCalledTimes(1);
    expect(clearVirtualWorktree).toHaveBeenCalledTimes(1);
    expect(selectVirtualWorktree).toHaveBeenCalledWith(state.worktreeEntries[0]?.path);
  });
});
