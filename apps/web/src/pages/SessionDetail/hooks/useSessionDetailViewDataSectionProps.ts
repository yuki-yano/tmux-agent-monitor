import { useCallback, useMemo } from "react";

import type { DiffScope } from "../components/DiffSection";
import { useSessionDetailContext } from "../SessionDetailProvider";
import { resolveSessionFileRoot } from "../sessionDetailUtils";

export const useSessionDetailViewDataSectionProps = () => {
  const { base, scope, diffs, files } = useSessionDetailContext();
  const { paneId, session } = base;
  // Mirrors the old VM's `screen.effectiveBranch` / `screen.effectiveWorktreePath`:
  // these are the worktree selector's effective values, independent from the
  // virtual-branch/virtual-worktree exclusivity scope used to parameterize the
  // diffs/commits requests themselves.
  const screenEffectiveBranch = scope.virtualWorktree.effectiveBranch;
  const sourceRepoRoot = resolveSessionFileRoot(
    session,
    scope.virtualWorktree.effectiveWorktreePath,
  );
  const {
    diffSummary,
    diffError,
    diffLoading,
    diffFiles,
    diffOpen,
    diffLoadingFiles,
    diffMode,
    setDiffMode,
    refreshDiff,
    toggleDiff,
  } = diffs;
  const { onOpenFileModal, onResolveLogFileReference, onResolveLogFileReferenceCandidates } = files;
  const sessionBranch = screenEffectiveBranch ?? session?.branch ?? null;
  const virtualBranch = scope.virtualBranch.virtualBranch;
  const onClearVirtualBranch = scope.virtualBranch.clearVirtualBranch;
  const diffScope = useMemo<DiffScope>(
    () =>
      virtualBranch == null
        ? {
            kind: "workingTree",
            mode: diffMode,
            baseBranch: scope.branches.defaultBranch,
            branch: sessionBranch,
            path: scope.virtualWorktree.effectiveWorktreePath,
            selected: scope.virtualWorktree.virtualWorktreePath != null,
          }
        : {
            kind: "branchComparison",
            mode: "committed",
            baseBranch: scope.branches.defaultBranch,
            branch: virtualBranch,
          },
    [
      scope.branches.defaultBranch,
      diffMode,
      scope.virtualWorktree.effectiveWorktreePath,
      scope.virtualWorktree.virtualWorktreePath,
      sessionBranch,
      virtualBranch,
    ],
  );
  const onClearDiffScope =
    diffScope.kind === "branchComparison"
      ? onClearVirtualBranch
      : scope.virtualWorktree.clearVirtualWorktree;

  const handleResolveFileReference = useCallback(
    (rawToken: string) =>
      onResolveLogFileReference({
        rawToken,
        sourcePaneId: paneId,
        sourceRepoRoot,
      }),
    [onResolveLogFileReference, paneId, sourceRepoRoot],
  );

  const handleResolveFileReferenceCandidates = useCallback(
    (rawTokens: string[]) =>
      onResolveLogFileReferenceCandidates({
        rawTokens,
        sourcePaneId: paneId,
        sourceRepoRoot,
      }),
    [onResolveLogFileReferenceCandidates, paneId, sourceRepoRoot],
  );

  const diffSectionProps = useMemo(
    () => ({
      state: {
        diffSummary,
        diffError,
        diffLoading,
        diffFiles,
        diffOpen,
        diffLoadingFiles,
        diffScope,
      },
      actions: {
        onRefresh: refreshDiff,
        onToggle: toggleDiff,
        onPreviewFile: onOpenFileModal,
        onClearScope: onClearDiffScope,
        onModeChange: setDiffMode,
        onResolveFileReference: handleResolveFileReference,
        onResolveFileReferenceCandidates: handleResolveFileReferenceCandidates,
      },
    }),
    [
      diffSummary,
      diffScope,
      diffError,
      diffLoading,
      diffFiles,
      diffOpen,
      diffLoadingFiles,
      refreshDiff,
      toggleDiff,
      onOpenFileModal,
      onClearDiffScope,
      setDiffMode,
      handleResolveFileReference,
      handleResolveFileReferenceCandidates,
    ],
  );

  return {
    diffSectionProps,
  };
};
