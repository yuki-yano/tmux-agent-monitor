import type { CommitDetail, CommitFileDiff } from "@vde-monitor/shared";
import { ChevronDown, ChevronUp } from "lucide-react";
import { memo, useRef } from "react";

import { FilePathLabel, TagPill } from "@/components/ui";
import { cn } from "@/lib/cn";

import { diffStatusClass, formatDiffCount, formatDiffStatusLabel } from "../../sessionDetailUtils";
import { CommitFileDetailContent } from "./commit-file-detail-content";

type CommitFileRowProps = {
  commitHash: string;
  file: CommitDetail["files"][number];
  fileOpen: boolean;
  additions: string;
  deletions: string;
  loadingFile: boolean;
  fileDetail?: CommitFileDiff;
  renderedPatch?: string[];
  onToggleCommitFile: (hash: string, path: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

type CommitFileRowsProps = {
  commitHash: string;
  files: CommitDetail["files"];
  commitFileOpen: Record<string, boolean>;
  commitFileDetails: Record<string, CommitFileDiff>;
  commitFileLoading: Record<string, boolean>;
  renderedPatches: Record<string, string[]>;
  onToggleCommitFile: (hash: string, path: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

export const CommitFileRow = memo(
  ({
    commitHash,
    file,
    fileOpen,
    additions,
    deletions,
    loadingFile,
    fileDetail,
    renderedPatch,
    onToggleCommitFile,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: CommitFileRowProps) => {
    const labelContainerRef = useRef<HTMLDivElement | null>(null);
    const statusLabel = formatDiffStatusLabel(file.status);
    const toggleFile = () => {
      onToggleCommitFile(commitHash, file.path);
    };
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={fileOpen}
          aria-label={
            fileOpen ? `Collapse file diff ${file.path}` : `Expand file diff ${file.path}`
          }
          onClick={toggleFile}
          className="focus-visible:ring-latte-lavender/30 grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent p-0 text-left focus-visible:outline-hidden focus-visible:ring-2"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TagPill tone="status" className={cn(diffStatusClass(statusLabel), "shrink-0")}>
              {statusLabel}
            </TagPill>
            <div ref={labelContainerRef} className="min-w-0 flex-1">
              <FilePathLabel
                path={file.path}
                renamedFrom={file.renamedFrom}
                size="xs"
                dirTruncate="segments"
                dirReservePx={12}
                measureRef={labelContainerRef}
                className="w-full font-mono"
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs">
            <span className="text-latte-green-text">+{additions}</span>
            <span className="text-latte-red-text">-{deletions}</span>
            <span className="text-latte-overlay1" aria-hidden="true">
              {fileOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </div>
        </button>
        {fileOpen && (
          <div className="border-latte-surface2/70 bg-latte-base/60 rounded-xl border px-2.5 py-1.5 sm:px-3 sm:py-2">
            <CommitFileDetailContent
              loadingFile={loadingFile}
              fileDetail={fileDetail}
              renderedPatch={renderedPatch}
              onResolveFileReference={onResolveFileReference}
              onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
            />
          </div>
        )}
      </div>
    );
  },
);

CommitFileRow.displayName = "CommitFileRow";

export const CommitFileRows = memo(
  ({
    commitHash,
    files,
    commitFileOpen,
    commitFileDetails,
    commitFileLoading,
    renderedPatches,
    onToggleCommitFile,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: CommitFileRowsProps) => (
    <div className="flex flex-col gap-1.5 text-xs sm:gap-2">
      {files.map((file) => {
        const fileKey = `${commitHash}:${file.path}`;
        return (
          <CommitFileRow
            key={`${file.path}-${file.status}`}
            commitHash={commitHash}
            file={file}
            fileOpen={Boolean(commitFileOpen[fileKey])}
            additions={formatDiffCount(file.additions)}
            deletions={formatDiffCount(file.deletions)}
            loadingFile={Boolean(commitFileLoading[fileKey])}
            fileDetail={commitFileDetails[fileKey]}
            renderedPatch={renderedPatches[fileKey]}
            onToggleCommitFile={onToggleCommitFile}
            onResolveFileReference={onResolveFileReference}
            onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
          />
        );
      })}
    </div>
  ),
);

CommitFileRows.displayName = "CommitFileRows";
