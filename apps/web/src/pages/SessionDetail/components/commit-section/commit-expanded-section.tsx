import type { CommitDetail, CommitFileDiff } from "@vde-monitor/shared";
import { memo } from "react";

import { sumFileStats } from "../../sessionDetailUtils";
import { CommitFileRows } from "./commit-file-row";

type CommitExpandedSectionProps = {
  commitHash: string;
  detail?: CommitDetail;
  loadingDetail: boolean;
  commitBody: string | null;
  commitFileOpen: Record<string, boolean>;
  commitFileDetails: Record<string, CommitFileDiff>;
  commitFileLoading: Record<string, boolean>;
  renderedPatches: Record<string, string[]>;
  onToggleCommitFile: (hash: string, path: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

const buildCommitFilesSection = ({
  commitHash,
  detail,
  commitFileOpen,
  commitFileDetails,
  commitFileLoading,
  renderedPatches,
  onToggleCommitFile,
  onResolveFileReference,
  onResolveFileReferenceCandidates,
}: Pick<
  CommitExpandedSectionProps,
  | "commitHash"
  | "detail"
  | "commitFileOpen"
  | "commitFileDetails"
  | "commitFileLoading"
  | "renderedPatches"
  | "onToggleCommitFile"
  | "onResolveFileReference"
  | "onResolveFileReferenceCandidates"
>) => {
  if (!detail) {
    return <p className="text-latte-subtext0 text-xs">No commit details.</p>;
  }
  if (!detail.files) {
    return null;
  }
  if (detail.files.length === 0) {
    return <p className="text-latte-subtext0 text-xs">No files changed.</p>;
  }
  return (
    <CommitFileRows
      commitHash={commitHash}
      files={detail.files}
      commitFileOpen={commitFileOpen}
      commitFileDetails={commitFileDetails}
      commitFileLoading={commitFileLoading}
      renderedPatches={renderedPatches}
      onToggleCommitFile={onToggleCommitFile}
      onResolveFileReference={onResolveFileReference}
      onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
    />
  );
};

export const CommitExpandedSection = memo(
  ({
    commitHash,
    detail,
    loadingDetail,
    commitBody,
    commitFileOpen,
    commitFileDetails,
    commitFileLoading,
    renderedPatches,
    onToggleCommitFile,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: CommitExpandedSectionProps) => {
    if (loadingDetail) {
      return <p className="text-latte-subtext0 text-xs">Loading commit…</p>;
    }
    const totals = sumFileStats(detail?.files);
    const commitFilesSection = buildCommitFilesSection({
      commitHash,
      detail,
      commitFileOpen,
      commitFileDetails,
      commitFileLoading,
      renderedPatches,
      onToggleCommitFile,
      onResolveFileReference,
      onResolveFileReferenceCandidates,
    });

    return (
      <>
        {commitBody && (
          <pre className="text-latte-subtext0 mb-3 whitespace-pre-wrap text-xs">{commitBody}</pre>
        )}
        {totals && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="text-latte-subtext0">Total changes</span>
            <span className="text-latte-green-text">+{totals.additions}</span>
            <span className="text-latte-red-text">-{totals.deletions}</span>
          </div>
        )}
        {commitFilesSection}
      </>
    );
  },
);

CommitExpandedSection.displayName = "CommitExpandedSection";
