import type { BranchListEntry } from "@vde-monitor/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  SessionDetailBaseContextValue,
  SessionDetailScopeContextValue,
} from "../SessionDetailContexts";
import { BranchSection, ConnectedBranchSection } from "./BranchSection";

let mockBase: SessionDetailBaseContextValue;
let mockScope: SessionDetailScopeContextValue;

vi.mock("../SessionDetailContexts", () => ({
  useSessionDetailBase: () => mockBase,
  useSessionDetailScope: () => mockScope,
}));

describe("BranchSection", () => {
  type BranchSectionState = Parameters<typeof BranchSection>[0]["state"];
  type BranchSectionActions = Parameters<typeof BranchSection>[0]["actions"];

  const currentDefaultEntry: BranchListEntry = {
    name: "main",
    current: true,
    isDefault: true,
    ahead: null,
    behind: null,
    fileChanges: null,
    additions: null,
    deletions: null,
    merged: null,
    pr: null,
    worktreePath: null,
    committedAt: null,
  };

  const worktreeEntry: BranchListEntry = {
    name: "feature/worktree-branch",
    current: false,
    isDefault: false,
    ahead: null,
    behind: null,
    fileChanges: null,
    additions: null,
    deletions: null,
    merged: null,
    pr: null,
    worktreePath: "/repo/.vde/worktree/feature-worktree-branch",
    committedAt: null,
  };

  const plainEntry: BranchListEntry = {
    name: "feature/plain-branch",
    current: false,
    isDefault: false,
    ahead: null,
    behind: null,
    fileChanges: null,
    additions: null,
    deletions: null,
    merged: null,
    pr: null,
    worktreePath: null,
    committedAt: null,
  };

  const buildState = (overrides: Partial<BranchSectionState> = {}): BranchSectionState => ({
    branches: [currentDefaultEntry, worktreeEntry, plainEntry],
    repoRoot: "/repo",
    currentBranch: "main",
    virtualBranch: null,
    branchesLoading: false,
    branchesError: null,
    mutating: null,
    mutationError: null,
    nowMs: Date.parse("2026-02-17T00:10:00.000Z"),
    ...overrides,
  });

  const buildActions = (overrides: Partial<BranchSectionActions> = {}): BranchSectionActions => ({
    onRefreshBranches: vi.fn(),
    onSelectVirtualBranch: vi.fn(),
    onClearVirtualBranch: vi.fn(),
    onCheckoutBranch: vi.fn().mockResolvedValue(true),
    onCreateBranch: vi.fn().mockResolvedValue(true),
    onDeleteBranch: vi.fn().mockResolvedValue(true),
    onClearMutationError: vi.fn(),
    ...overrides,
  });

  const findRow = (entryName: string) => {
    const textNode = screen.getAllByText(entryName)[0];
    const row = textNode?.closest("button")?.parentElement;
    if (!row) {
      throw new Error(`row not found for ${entryName}`);
    }
    return row;
  };

  it("renders Default, Current, and Worktree badges according to entry conditions", () => {
    const state = buildState();
    const actions = buildActions();
    render(<BranchSection state={state} actions={actions} />);

    const mainRow = findRow("main");
    expect(within(mainRow).queryByText("Default")).not.toBeNull();
    expect(within(mainRow).queryByText("Current")).not.toBeNull();
    expect(within(mainRow).queryByText("Worktree")).toBeNull();

    const worktreeRow = findRow("feature/worktree-branch");
    expect(within(worktreeRow).queryByText("Worktree")).not.toBeNull();
    expect(within(worktreeRow).queryByText("Default")).toBeNull();
    expect(within(worktreeRow).queryByText("Current")).toBeNull();

    const plainRow = findRow("feature/plain-branch");
    expect(within(plainRow).queryByText("Default")).toBeNull();
    expect(within(plainRow).queryByText("Current")).toBeNull();
    expect(within(plainRow).queryByText("Worktree")).toBeNull();
  });

  it("updates relative commit times when nowMs changes", () => {
    const committedEntry = {
      ...plainEntry,
      committedAt: "2026-02-17T00:09:00.000Z",
    };
    const actions = buildActions();
    const { rerender } = render(
      <BranchSection state={buildState({ branches: [committedEntry] })} actions={actions} />,
    );

    expect(screen.getByText("1m ago")).toBeTruthy();

    rerender(
      <BranchSection
        state={buildState({
          branches: [committedEntry],
          nowMs: Date.parse("2026-02-17T00:12:00.000Z"),
        })}
        actions={actions}
      />,
    );

    expect(screen.getByText("3m ago")).toBeTruthy();
  });

  it("shows a branch load error instead of stale entries", () => {
    render(
      <BranchSection
        state={buildState({ branchesError: "Branches unavailable" })}
        actions={buildActions()}
      />,
    );

    expect(screen.getByText("Branches unavailable")).toBeTruthy();
    expect(screen.queryByText("feature/plain-branch")).toBeNull();
  });

  it("hides diff metrics on the default branch entry only", () => {
    const state = buildState();
    const actions = buildActions();
    render(<BranchSection state={state} actions={actions} />);

    const isAdditionsMetric = (_content: string, element: Element | null) =>
      element?.textContent === "+—";
    const mainRow = findRow("main");
    expect(within(mainRow).queryByText(isAdditionsMetric)).toBeNull();

    const plainRow = findRow("feature/plain-branch");
    expect(within(plainRow).queryByText(isAdditionsMetric)).not.toBeNull();
  });

  it("disables the Checkout button for the current entry but not for others", () => {
    const state = buildState();
    const actions = buildActions();
    render(<BranchSection state={state} actions={actions} />);

    const mainRow = findRow("main");
    const mainCheckoutButton = within(mainRow).getByRole("button", {
      name: "Checkout",
    }) as HTMLButtonElement;
    expect(mainCheckoutButton.disabled).toBe(true);

    const plainRow = findRow("feature/plain-branch");
    const plainCheckoutButton = within(plainRow).getByRole("button", {
      name: "Checkout",
    }) as HTMLButtonElement;
    expect(plainCheckoutButton.disabled).toBe(false);
  });

  it("calls onSelectVirtualBranch when an entry is clicked", () => {
    const state = buildState();
    const actions = buildActions();
    render(<BranchSection state={state} actions={actions} />);

    const plainRow = findRow("feature/plain-branch");
    const [selectButton] = within(plainRow).getAllByRole("button");
    if (!selectButton) {
      throw new Error("select button not found");
    }
    fireEvent.click(selectButton);

    expect(actions.onSelectVirtualBranch).toHaveBeenCalledWith("feature/plain-branch");
  });

  it("opens the checkout dialog and checks out only after confirmation", () => {
    const state = buildState();
    const actions = buildActions();
    render(<BranchSection state={state} actions={actions} />);

    const plainRow = findRow("feature/plain-branch");
    const checkoutButton = within(plainRow).getByRole("button", { name: "Checkout" });
    fireEvent.click(checkoutButton);

    expect(actions.onCheckoutBranch).not.toHaveBeenCalled();
    expect(screen.getByText("Checkout branch")).not.toBeNull();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.textContent === "Switch the session working directory to feature/plain-branch?",
      ),
    ).not.toBeNull();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Checkout" }));

    expect(actions.onCheckoutBranch).toHaveBeenCalledWith("feature/plain-branch");
  });

  it("opens the delete dialog when the delete icon is clicked", () => {
    const state = buildState();
    const actions = buildActions();
    render(<BranchSection state={state} actions={actions} />);

    const deleteButton = screen.getByRole("button", {
      name: "Delete branch feature/plain-branch",
    });
    fireEvent.click(deleteButton);

    expect(screen.getByText("Delete branch")).not.toBeNull();
    expect(
      screen.getByText(
        (_content, element) => element?.textContent === "Delete local branch feature/plain-branch?",
      ),
    ).not.toBeNull();
  });

  it("maps wrapped branch actions through the connected entry", () => {
    const state = buildState({ virtualBranch: "feature/plain-branch" });
    const refreshBranches = vi.fn(async () => undefined);
    const selectVirtualBranch = vi.fn();
    const clearVirtualBranch = vi.fn();
    const checkoutBranch = vi.fn().mockResolvedValue(false);
    const createBranch = vi.fn().mockResolvedValue(false);
    const deleteBranch = vi.fn().mockResolvedValue(false);
    const clearMutationError = vi.fn();
    mockBase = { nowMs: state.nowMs } as SessionDetailBaseContextValue;
    mockScope = {
      branches: {
        branches: state.branches,
        repoRoot: state.repoRoot,
        defaultBranch: "main",
        currentBranch: state.currentBranch,
        branchesLoading: state.branchesLoading,
        branchesError: state.branchesError,
        mutating: state.mutating,
        mutationError: state.mutationError,
        refreshBranches,
        clearMutationError,
      },
      virtualBranch: { virtualBranch: state.virtualBranch, clearVirtualBranch },
      selectVirtualBranch,
      checkoutBranch,
      createBranch,
      deleteBranch,
    } as unknown as SessionDetailScopeContextValue;

    render(<ConnectedBranchSection />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh branches" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear virtual branch" }));
    const plainRow = findRow("feature/plain-branch");
    const [selectButton] = within(plainRow).getAllByRole("button");
    if (!selectButton) throw new Error("select button not found");
    fireEvent.click(selectButton);

    fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
    fireEvent.change(screen.getByLabelText("Branch name"), {
      target: { value: "feature/created" },
    });
    fireEvent.change(screen.getByLabelText("Base branch"), { target: { value: "main" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(plainRow).getByRole("button", { name: "Checkout" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Checkout" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete branch feature/plain-branch" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    expect(refreshBranches).toHaveBeenCalledTimes(1);
    expect(clearVirtualBranch).toHaveBeenCalledTimes(1);
    expect(selectVirtualBranch).toHaveBeenCalledWith("feature/plain-branch");
    expect(createBranch).toHaveBeenCalledWith("feature/created", "main");
    expect(checkoutBranch).toHaveBeenCalledWith("feature/plain-branch");
    expect(deleteBranch).toHaveBeenCalledWith("feature/plain-branch", { force: false });
    expect(clearMutationError).toHaveBeenCalled();
  });
});
