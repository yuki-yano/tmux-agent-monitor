import { type DiffFile, type DiffSummary } from "@vde-monitor/shared";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { memo } from "react";

import {
  Button,
  FilePathLabel,
  IconButton,
  InsetPanel,
  PanelSection,
  RowButton,
  TagPill,
} from "@/components/ui";
import { cn } from "@/lib/cn";

import { diffStatusClass, formatDiffCount, formatDiffStatusLabel } from "../sessionDetailUtils";
import { DiffPatch } from "./DiffPatch";
import type { RenderedPatch } from "./diff-section-file-list-utils";

type DiffFilePatchContentProps = {
  filePath: string;
  loadingFile: boolean;
  fileData?: DiffFile;
  renderedPatch?: RenderedPatch;
  onExpandDiff: (path: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

type DiffFileItemProps = {
  file: DiffSummary["files"][number];
  isOpen: boolean;
  loadingFile: boolean;
  fileData?: DiffFile;
  renderedPatch?: RenderedPatch;
  previewEnabled: boolean;
  onToggle: (path: string) => void;
  onPreviewFile: (path: string) => void;
  onExpandDiff: (path: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

type DiffFileListProps = {
  files: DiffSummary["files"];
  diffOpen: Record<string, boolean>;
  diffLoadingFiles: Record<string, boolean>;
  diffFiles: Record<string, DiffFile>;
  renderedPatches: Record<string, RenderedPatch>;
  previewEnabled: boolean;
  onToggle: (path: string) => void;
  onPreviewFile: (path: string) => void;
  onExpandDiff: (path: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

const resolveDiffPatchMessage = ({
  loadingFile,
  fileData,
}: {
  loadingFile: boolean;
  fileData?: DiffFile;
}) => {
  if (loadingFile) {
    return "Loading diff…";
  }
  if (fileData?.binary) {
    return "Binary file (no diff).";
  }
  if (!fileData?.patch) {
    return "No diff available.";
  }
  return null;
};

const DiffFilePatchContent = memo(
  ({
    filePath,
    loadingFile,
    fileData,
    renderedPatch,
    onExpandDiff,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: DiffFilePatchContentProps) => {
    const message = resolveDiffPatchMessage({ loadingFile, fileData });
    if (message) {
      return <p className="text-latte-subtext0 text-xs">{message}</p>;
    }
    const truncatedPreview = renderedPatch?.truncated ? renderedPatch : null;
    const showServerTruncated = Boolean(fileData?.truncated);
    return (
      <div className="custom-scrollbar max-h-[360px] overflow-auto">
        {renderedPatch ? (
          <DiffPatch
            lines={renderedPatch.lines}
            onResolveFileReference={onResolveFileReference}
            onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
          />
        ) : null}
        {truncatedPreview ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-latte-subtext0">
              Showing first {truncatedPreview.previewLines} of {truncatedPreview.totalLines} lines.
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onExpandDiff(filePath)}
              className="h-7 px-2 text-[11px]"
            >
              Render full diff
            </Button>
          </div>
        ) : null}
        {showServerTruncated ? (
          <p className="text-latte-subtext0 mt-2 text-xs">Diff truncated.</p>
        ) : null}
      </div>
    );
  },
);

DiffFilePatchContent.displayName = "DiffFilePatchContent";

const DiffFileItem = memo(
  ({
    file,
    isOpen,
    loadingFile,
    fileData,
    renderedPatch,
    previewEnabled,
    onToggle,
    onPreviewFile,
    onExpandDiff,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: DiffFileItemProps) => {
    const statusLabel = formatDiffStatusLabel(file.status);
    const additionsLabel = formatDiffCount(file.additions);
    const deletionsLabel = formatDiffCount(file.deletions);
    return (
      <InsetPanel key={`${file.path}-${file.status}`}>
        <div className="flex min-w-0 items-center gap-2 pr-1.5 sm:pr-2">
          <RowButton
            type="button"
            onClick={() => onToggle(file.path)}
            className="min-h-10 min-w-0 flex-1 rounded-l-2xl"
          >
            <div className="flex min-w-0 items-center gap-3">
              <TagPill tone="status" className={cn(diffStatusClass(statusLabel), "shrink-0")}>
                {statusLabel}
              </TagPill>
              <FilePathLabel path={file.path} size="sm" tailSegments={3} className="font-mono" />
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-latte-green-text tabular-nums">+{additionsLabel}</span>
              <span className="text-latte-red-text tabular-nums">-{deletionsLabel}</span>
              {isOpen ? (
                <ChevronUp className="text-latte-subtext0 h-4 w-4" />
              ) : (
                <ChevronDown className="text-latte-subtext0 h-4 w-4" />
              )}
              <span className="sr-only">{isOpen ? "Hide" : "Show"} diff</span>
            </div>
          </RowButton>
          {previewEnabled && file.status !== "D" ? (
            <IconButton
              type="button"
              size="sm"
              className="text-latte-subtext0/65 hover:bg-latte-surface0/55 hover:text-latte-text shrink-0 border-transparent bg-transparent shadow-none backdrop-blur-none after:-inset-1 hover:border-transparent hover:shadow-none"
              onClick={() => onPreviewFile(file.path)}
              aria-label={`Preview ${file.path}`}
              title="Preview file"
            >
              <Eye className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>
        {isOpen ? (
          <PanelSection>
            <DiffFilePatchContent
              filePath={file.path}
              loadingFile={loadingFile}
              fileData={fileData}
              renderedPatch={renderedPatch}
              onExpandDiff={onExpandDiff}
              onResolveFileReference={onResolveFileReference}
              onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
            />
          </PanelSection>
        ) : null}
      </InsetPanel>
    );
  },
);

DiffFileItem.displayName = "DiffFileItem";

export const DiffFileList = memo(
  ({
    files,
    diffOpen,
    diffLoadingFiles,
    diffFiles,
    renderedPatches,
    previewEnabled,
    onToggle,
    onPreviewFile,
    onExpandDiff,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: DiffFileListProps) => (
    <div className="flex flex-col gap-1.5 sm:gap-2">
      {files.map((file) => (
        <DiffFileItem
          key={`${file.path}-${file.status}`}
          file={file}
          isOpen={Boolean(diffOpen[file.path])}
          loadingFile={Boolean(diffLoadingFiles[file.path])}
          fileData={diffFiles[file.path]}
          renderedPatch={renderedPatches[file.path]}
          previewEnabled={previewEnabled}
          onToggle={onToggle}
          onPreviewFile={onPreviewFile}
          onExpandDiff={onExpandDiff}
          onResolveFileReference={onResolveFileReference}
          onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
        />
      ))}
    </div>
  ),
);

DiffFileList.displayName = "DiffFileList";
