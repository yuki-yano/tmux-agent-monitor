import { type ReactNode, createContext, use, useCallback, useMemo } from "react";

import { CommitSection } from "./components/CommitSection";
import { type UseSessionCommitsParams, useSessionCommits } from "./hooks/useSessionCommits";

type SessionDetailCommitsContextValue = ReturnType<typeof useSessionCommits> & {
  commitBranch: string | null;
  virtualBranch: string | null;
  onClearVirtualBranch: () => void;
  onResolveFileReference: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates: (rawTokens: string[]) => Promise<string[]>;
};

const SessionDetailCommitsContext = createContext<SessionDetailCommitsContextValue | null>(null);

type SessionDetailCommitsProviderProps = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  worktreePath: string | null;
  branch: string | null;
  commitBranch: string | null;
  virtualBranch: string | null;
  sourceRepoRoot: string | null;
  requestCommitLog: UseSessionCommitsParams["requestCommitLog"];
  requestCommitDetail: UseSessionCommitsParams["requestCommitDetail"];
  requestCommitFile: UseSessionCommitsParams["requestCommitFile"];
  onClearVirtualBranch: () => void;
  onResolveLogFileReference: (args: {
    rawToken: string;
    sourcePaneId: string;
    sourceRepoRoot: string | null;
  }) => Promise<void>;
  onResolveLogFileReferenceCandidates: (args: {
    rawTokens: string[];
    sourcePaneId: string;
    sourceRepoRoot: string | null;
  }) => Promise<string[]>;
  children: ReactNode;
};

export const SessionDetailCommitsProvider = ({
  paneId,
  repoRoot,
  connected,
  worktreePath,
  branch,
  commitBranch,
  virtualBranch,
  sourceRepoRoot,
  requestCommitLog,
  requestCommitDetail,
  requestCommitFile,
  onClearVirtualBranch,
  onResolveLogFileReference,
  onResolveLogFileReferenceCandidates,
  children,
}: SessionDetailCommitsProviderProps) => {
  const commits = useSessionCommits({
    paneId,
    repoRoot,
    connected,
    worktreePath,
    branch,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
  });
  const onResolveFileReference = useCallback(
    (rawToken: string) =>
      onResolveLogFileReference({ rawToken, sourcePaneId: paneId, sourceRepoRoot }),
    [onResolveLogFileReference, paneId, sourceRepoRoot],
  );
  const onResolveFileReferenceCandidates = useCallback(
    (rawTokens: string[]) =>
      onResolveLogFileReferenceCandidates({
        rawTokens,
        sourcePaneId: paneId,
        sourceRepoRoot,
      }),
    [onResolveLogFileReferenceCandidates, paneId, sourceRepoRoot],
  );
  const value = useMemo(
    () => ({
      commitLog: commits.commitLog,
      commitError: commits.commitError,
      commitLoading: commits.commitLoading,
      commitLoadingMore: commits.commitLoadingMore,
      commitHasMore: commits.commitHasMore,
      commitDetails: commits.commitDetails,
      commitFileDetails: commits.commitFileDetails,
      commitFileOpen: commits.commitFileOpen,
      commitFileLoading: commits.commitFileLoading,
      commitOpen: commits.commitOpen,
      commitLoadingDetails: commits.commitLoadingDetails,
      copiedHash: commits.copiedHash,
      refreshCommitLog: commits.refreshCommitLog,
      loadMoreCommits: commits.loadMoreCommits,
      toggleCommit: commits.toggleCommit,
      toggleCommitFile: commits.toggleCommitFile,
      copyHash: commits.copyHash,
      commitBranch,
      virtualBranch,
      onClearVirtualBranch,
      onResolveFileReference,
      onResolveFileReferenceCandidates,
    }),
    [
      commitBranch,
      commits.commitDetails,
      commits.commitError,
      commits.commitFileDetails,
      commits.commitFileLoading,
      commits.commitFileOpen,
      commits.commitHasMore,
      commits.commitLoading,
      commits.commitLoadingDetails,
      commits.commitLoadingMore,
      commits.commitLog,
      commits.commitOpen,
      commits.copiedHash,
      commits.copyHash,
      commits.loadMoreCommits,
      commits.refreshCommitLog,
      commits.toggleCommit,
      commits.toggleCommitFile,
      onClearVirtualBranch,
      onResolveFileReference,
      onResolveFileReferenceCandidates,
      virtualBranch,
    ],
  );

  return (
    <SessionDetailCommitsContext.Provider value={value}>
      {children}
    </SessionDetailCommitsContext.Provider>
  );
};

export const useSessionDetailCommits = () => {
  const value = use(SessionDetailCommitsContext);
  if (value == null) {
    throw new Error("useSessionDetailCommits must be used within SessionDetailCommitsProvider");
  }
  return value;
};

export const ConnectedCommitSection = () => {
  const commits = useSessionDetailCommits();
  return (
    <CommitSection
      state={{
        commitLog: commits.commitLog,
        commitBranch: commits.commitBranch,
        commitError: commits.commitError,
        commitLoading: commits.commitLoading,
        commitLoadingMore: commits.commitLoadingMore,
        commitHasMore: commits.commitHasMore,
        commitDetails: commits.commitDetails,
        commitFileDetails: commits.commitFileDetails,
        commitFileOpen: commits.commitFileOpen,
        commitFileLoading: commits.commitFileLoading,
        commitOpen: commits.commitOpen,
        commitLoadingDetails: commits.commitLoadingDetails,
        copiedHash: commits.copiedHash,
        virtualBranch: commits.virtualBranch,
      }}
      actions={{
        onRefresh: commits.refreshCommitLog,
        onLoadMore: commits.loadMoreCommits,
        onToggleCommit: commits.toggleCommit,
        onToggleCommitFile: commits.toggleCommitFile,
        onCopyHash: commits.copyHash,
        onClearVirtualBranch: commits.onClearVirtualBranch,
        onResolveFileReference: commits.onResolveFileReference,
        onResolveFileReferenceCandidates: commits.onResolveFileReferenceCandidates,
      }}
    />
  );
};
