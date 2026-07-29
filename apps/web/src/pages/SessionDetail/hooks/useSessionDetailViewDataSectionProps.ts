import { useCallback, useMemo } from "react";

import { useSessionDetailContext } from "../SessionDetailProvider";
import { resolveSessionFileRoot } from "../sessionDetailUtils";
import { useSessionRepoNotes } from "./useSessionRepoNotes";

type UseSessionDetailViewDataSectionPropsArgs = {
  isMobile: boolean;
};

export const useSessionDetailViewDataSectionProps = ({
  isMobile,
}: UseSessionDetailViewDataSectionPropsArgs) => {
  const { base, scope, diffs, files, commits, timelineLogsActions } = useSessionDetailContext();
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
    timeline: stateTimeline,
    timelineScope,
    timelineRange,
    hasRepoTimeline,
    timelineError,
    timelineLoading,
    timelineExpanded,
    setTimelineScope,
    setTimelineRange,
    toggleTimelineExpanded,
    refreshTimeline,
  } = timelineLogsActions.timeline;
  const {
    diffSummary,
    diffError,
    diffLoading,
    diffFiles,
    diffOpen,
    diffLoadingFiles,
    refreshDiff,
    toggleDiff,
  } = diffs;
  const { onOpenFileModal, onResolveLogFileReference, onResolveLogFileReferenceCandidates } = files;
  const {
    commitLog,
    commitError,
    commitLoading,
    commitLoadingMore,
    commitHasMore,
    commitDetails,
    commitFileDetails,
    commitFileOpen,
    commitFileLoading,
    commitOpen,
    commitLoadingDetails,
    copiedHash,
    refreshCommitLog,
    loadMoreCommits,
    toggleCommit,
    toggleCommitFile,
    copyHash,
  } = commits;
  const {
    notes: repoNotes,
    notesLoading,
    notesError,
    creatingNote,
    savingNoteId,
    deletingNoteId,
    refreshNotes,
    createNote,
    saveNote,
    removeNote,
  } = useSessionRepoNotes({
    paneId,
    repoRoot: session?.repoRoot ?? null,
    connected: base.connected,
    requestRepoNotes: base.requestRepoNotes,
    createRepoNote: base.createRepoNote,
    updateRepoNote: base.updateRepoNote,
    deleteRepoNote: base.deleteRepoNote,
  });
  const sessionBranch = screenEffectiveBranch ?? session?.branch ?? null;
  const virtualBranch = scope.virtualBranch.virtualBranch;
  const onClearVirtualBranch = scope.virtualBranch.clearVirtualBranch;

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
        diffBranch: sessionBranch,
        virtualBranch,
      },
      actions: {
        onRefresh: refreshDiff,
        onToggle: toggleDiff,
        onPreviewFile: onOpenFileModal,
        onClearVirtualBranch,
        onResolveFileReference: handleResolveFileReference,
        onResolveFileReferenceCandidates: handleResolveFileReferenceCandidates,
      },
    }),
    [
      diffSummary,
      sessionBranch,
      virtualBranch,
      diffError,
      diffLoading,
      diffFiles,
      diffOpen,
      diffLoadingFiles,
      refreshDiff,
      toggleDiff,
      onOpenFileModal,
      onClearVirtualBranch,
      handleResolveFileReference,
      handleResolveFileReferenceCandidates,
    ],
  );

  const stateTimelineSectionProps = useMemo(
    () => ({
      state: {
        timeline: stateTimeline,
        timelineScope,
        timelineRange,
        hasRepoTimeline,
        timelineError,
        timelineLoading,
        timelineExpanded,
        isMobile,
      },
      actions: {
        onTimelineScopeChange: setTimelineScope,
        onTimelineRangeChange: setTimelineRange,
        onTimelineRefresh: refreshTimeline,
        onToggleTimelineExpanded: toggleTimelineExpanded,
      },
    }),
    [
      stateTimeline,
      timelineScope,
      timelineRange,
      hasRepoTimeline,
      timelineError,
      timelineLoading,
      timelineExpanded,
      isMobile,
      setTimelineScope,
      setTimelineRange,
      refreshTimeline,
      toggleTimelineExpanded,
    ],
  );

  const commitSectionProps = useMemo(
    () => ({
      state: {
        commitLog,
        commitError,
        commitLoading,
        commitLoadingMore,
        commitHasMore,
        commitDetails,
        commitFileDetails,
        commitFileOpen,
        commitFileLoading,
        commitOpen,
        commitLoadingDetails,
        copiedHash,
        commitBranch: sessionBranch,
        virtualBranch,
      },
      actions: {
        onRefresh: refreshCommitLog,
        onLoadMore: loadMoreCommits,
        onToggleCommit: toggleCommit,
        onToggleCommitFile: toggleCommitFile,
        onCopyHash: copyHash,
        onClearVirtualBranch,
        onResolveFileReference: handleResolveFileReference,
        onResolveFileReferenceCandidates: handleResolveFileReferenceCandidates,
      },
    }),
    [
      commitLog,
      sessionBranch,
      virtualBranch,
      commitError,
      commitLoading,
      commitLoadingMore,
      commitHasMore,
      commitDetails,
      commitFileDetails,
      commitFileOpen,
      commitFileLoading,
      commitOpen,
      commitLoadingDetails,
      copiedHash,
      refreshCommitLog,
      loadMoreCommits,
      toggleCommit,
      toggleCommitFile,
      copyHash,
      onClearVirtualBranch,
      handleResolveFileReference,
      handleResolveFileReferenceCandidates,
    ],
  );

  const notesSectionProps = useMemo(
    () => ({
      state: {
        repoRoot: session?.repoRoot ?? null,
        notes: repoNotes,
        notesLoading,
        notesError,
        creatingNote,
        savingNoteId,
        deletingNoteId,
      },
      actions: {
        onRefresh: refreshNotes,
        onCreate: createNote,
        onSave: saveNote,
        onDelete: removeNote,
      },
    }),
    [
      createNote,
      creatingNote,
      deletingNoteId,
      notesError,
      notesLoading,
      refreshNotes,
      removeNote,
      repoNotes,
      session?.repoRoot,
      saveNote,
      savingNoteId,
    ],
  );

  return {
    diffSectionProps,
    stateTimelineSectionProps,
    commitSectionProps,
    notesSectionProps,
  };
};
