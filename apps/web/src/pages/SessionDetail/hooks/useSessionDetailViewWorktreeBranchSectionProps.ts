import { useCallback, useMemo } from "react";

import { useSessionDetailContext } from "../SessionDetailProvider";

// Builds WorktreeSection/BranchSection props straight from the shared branch/
// worktree scope in SessionDetailContext. Kept separate from useScreenPanelState
// (which is ScreenPanel's own dedicated hook) since worktree/branch sections are
// siblings of ScreenPanel, not something ScreenPanel itself renders.
export const useSessionDetailViewWorktreeBranchSectionProps = () => {
  const { base, scope } = useSessionDetailContext();
  const { virtualWorktree, branches, virtualBranch } = scope;

  const onRefreshWorktrees = useCallback(() => {
    void virtualWorktree.refreshWorktrees();
  }, [virtualWorktree]);

  const worktreeSectionProps = useMemo(
    () => ({
      state: {
        worktreeSelectorEnabled: virtualWorktree.selectorEnabled,
        worktreeSelectorLoading: virtualWorktree.loading,
        worktreeSelectorError: virtualWorktree.error,
        worktreeEntries: virtualWorktree.entries,
        worktreeRepoRoot: virtualWorktree.repoRoot,
        worktreeBaseBranch: virtualWorktree.baseBranch,
        actualWorktreePath: virtualWorktree.actualWorktreePath,
        virtualWorktreePath: virtualWorktree.virtualWorktreePath,
      },
      actions: {
        onRefreshWorktrees,
        onSelectVirtualWorktree: scope.selectVirtualWorktree,
        onClearVirtualWorktree: virtualWorktree.clearVirtualWorktree,
      },
    }),
    [virtualWorktree, onRefreshWorktrees, scope.selectVirtualWorktree],
  );

  const onRefreshBranches = useCallback(() => {
    void branches.refreshBranches();
  }, [branches]);

  const branchSectionProps = useMemo(
    () => ({
      state: {
        branches: branches.branches,
        repoRoot: branches.repoRoot,
        currentBranch: branches.currentBranch,
        virtualBranch: virtualBranch.virtualBranch,
        branchesLoading: branches.branchesLoading,
        branchesError: branches.branchesError,
        mutating: branches.mutating,
        mutationError: branches.mutationError,
        nowMs: base.nowMs,
      },
      actions: {
        onRefreshBranches,
        onSelectVirtualBranch: scope.selectVirtualBranch,
        onClearVirtualBranch: virtualBranch.clearVirtualBranch,
        onCheckoutBranch: scope.checkoutBranch,
        onCreateBranch: scope.createBranch,
        onDeleteBranch: scope.deleteBranch,
        onClearMutationError: branches.clearMutationError,
      },
    }),
    [
      branches,
      base.nowMs,
      virtualBranch,
      onRefreshBranches,
      scope.selectVirtualBranch,
      scope.checkoutBranch,
      scope.createBranch,
      scope.deleteBranch,
    ],
  );

  return { worktreeSectionProps, branchSectionProps };
};
