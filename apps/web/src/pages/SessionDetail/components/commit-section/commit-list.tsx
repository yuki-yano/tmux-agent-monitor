import type { CommitDetail, CommitFileDiff, CommitLog } from "@vde-monitor/shared";
import { memo } from "react";

import { CommitItem } from "./commit-item";

type CommitListProps = {
  commits: CommitLog["commits"];
  commitDetails: Record<string, CommitDetail>;
  commitLoadingDetails: Record<string, boolean>;
  commitOpen: Record<string, boolean>;
  copiedHash: string | null;
  commitFileOpen: Record<string, boolean>;
  commitFileDetails: Record<string, CommitFileDiff>;
  commitFileLoading: Record<string, boolean>;
  renderedPatches: Record<string, string[]>;
  onToggleCommit: (hash: string) => void;
  onToggleCommitFile: (hash: string, path: string) => void;
  onCopyHash: (hash: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

export const CommitList = memo(
  ({
    commits,
    commitDetails,
    commitLoadingDetails,
    commitOpen,
    copiedHash,
    commitFileOpen,
    commitFileDetails,
    commitFileLoading,
    renderedPatches,
    onToggleCommit,
    onToggleCommitFile,
    onCopyHash,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: CommitListProps) => (
    <div className="flex flex-col gap-1.5 sm:gap-2">
      {commits.map((commit) => (
        <CommitItem
          key={commit.hash}
          commit={commit}
          detail={commitDetails[commit.hash]}
          loadingDetail={Boolean(commitLoadingDetails[commit.hash])}
          isOpen={Boolean(commitOpen[commit.hash])}
          copiedHash={copiedHash}
          commitFileOpen={commitFileOpen}
          commitFileDetails={commitFileDetails}
          commitFileLoading={commitFileLoading}
          renderedPatches={renderedPatches}
          onToggleCommit={onToggleCommit}
          onToggleCommitFile={onToggleCommitFile}
          onCopyHash={onCopyHash}
          onResolveFileReference={onResolveFileReference}
          onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
        />
      ))}
    </div>
  ),
);

CommitList.displayName = "CommitList";
