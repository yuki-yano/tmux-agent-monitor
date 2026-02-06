import { type DiffFile, type DiffSummary } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { ChevronDown, ChevronUp, FileCheck, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";

import {
  Button,
  Callout,
  Card,
  EmptyState,
  FilePathLabel,
  InsetPanel,
  LoadingOverlay,
  PanelSection,
  RowButton,
  SectionHeader,
  TagPill,
} from "@/components/ui";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import { diffExpandedAtom } from "../atoms/diffAtoms";
import {
  diffStatusClass,
  formatDiffCount,
  formatDiffStatusLabel,
  formatPath,
  MAX_DIFF_LINES,
  PREVIEW_DIFF_LINES,
  sumFileStats,
} from "../sessionDetailUtils";
import { DiffPatch } from "./DiffPatch";

type DiffSectionState = {
  diffSummary: DiffSummary | null;
  diffError: string | null;
  diffLoading: boolean;
  diffFiles: Record<string, DiffFile>;
  diffOpen: Record<string, boolean>;
  diffLoadingFiles: Record<string, boolean>;
};

type DiffSectionActions = {
  onRefresh: () => void;
  onToggle: (path: string) => void;
};

type DiffSectionProps = {
  state: DiffSectionState;
  actions: DiffSectionActions;
};

type RenderedPatch = {
  lines: string[];
  truncated: boolean;
  totalLines: number;
  previewLines: number;
};

type DiffFilePatchContentProps = {
  filePath: string;
  loadingFile: boolean;
  fileData?: DiffFile;
  renderedPatch?: RenderedPatch;
  onExpandDiff: (path: string) => void;
};

type DiffFileItemProps = {
  file: DiffSummary["files"][number];
  isOpen: boolean;
  loadingFile: boolean;
  fileData?: DiffFile;
  renderedPatch?: RenderedPatch;
  onToggle: (path: string) => void;
  onExpandDiff: (path: string) => void;
};

type DiffFileListProps = {
  files: DiffSummary["files"];
  diffOpen: Record<string, boolean>;
  diffLoadingFiles: Record<string, boolean>;
  diffFiles: Record<string, DiffFile>;
  renderedPatches: Record<string, RenderedPatch>;
  onToggle: (path: string) => void;
  onExpandDiff: (path: string) => void;
};

const toFileCountLabel = (fileCount: number) => `${fileCount} file${fileCount === 1 ? "" : "s"}`;

const shouldShowCleanState = (diffSummary: DiffSummary | null) =>
  Boolean(diffSummary && diffSummary.files.length === 0 && !diffSummary.reason);

const filterExpandedDiffs = (
  expandedDiffs: Record<string, boolean>,
  files: DiffSummary["files"],
) => {
  const fileSet = new Set(files.map((file) => file.path));
  const next: Record<string, boolean> = {};
  Object.entries(expandedDiffs).forEach(([path, isExpanded]) => {
    if (fileSet.has(path)) {
      next[path] = isExpanded;
    }
  });
  return next;
};

const syncExpandedDiffs = (
  diffSummary: DiffSummary | null,
  setExpandedDiffs: (
    next: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void,
) => {
  if (!diffSummary?.files.length) {
    setExpandedDiffs({});
    return;
  }
  setExpandedDiffs((prev) => filterExpandedDiffs(prev, diffSummary.files));
};

const buildRenderedPatch = (patch: string, isExpanded: boolean): RenderedPatch => {
  const lines = patch.split("\n");
  const totalLines = lines.length;
  const truncated = totalLines > MAX_DIFF_LINES && !isExpanded;
  const visibleLines = truncated ? lines.slice(0, PREVIEW_DIFF_LINES) : lines;
  return {
    lines: visibleLines,
    truncated,
    totalLines,
    previewLines: visibleLines.length,
  };
};

const buildRenderedPatches = (
  diffOpen: Record<string, boolean>,
  diffFiles: Record<string, DiffFile>,
  expandedDiffs: Record<string, boolean>,
) => {
  const rendered: Record<string, RenderedPatch> = {};
  Object.entries(diffOpen).forEach(([path, isOpen]) => {
    if (!isOpen) {
      return;
    }
    const patch = diffFiles[path]?.patch;
    if (!patch) {
      return;
    }
    rendered[path] = buildRenderedPatch(patch, Boolean(expandedDiffs[path]));
  });
  return rendered;
};

const DiffSummaryReasonCallout = memo(
  ({ reason }: { reason: DiffSummary["reason"] | undefined }) => {
    if (reason === "cwd_unknown") {
      return (
        <Callout tone="warning" size="xs">
          Working directory is unknown for this session.
        </Callout>
      );
    }
    if (reason === "not_git") {
      return (
        <Callout tone="warning" size="xs">
          Current directory is not a git repository.
        </Callout>
      );
    }
    if (reason === "error") {
      return (
        <Callout tone="error" size="xs">
          {API_ERROR_MESSAGES.diffSummary}.
        </Callout>
      );
    }
    return null;
  },
);

DiffSummaryReasonCallout.displayName = "DiffSummaryReasonCallout";

const DiffErrorCallout = memo(({ diffError }: { diffError: string | null }) => {
  if (!diffError) {
    return null;
  }
  return (
    <Callout tone="error" size="xs">
      {diffError}
    </Callout>
  );
});

DiffErrorCallout.displayName = "DiffErrorCallout";

const DiffSummaryDescription = memo(
  ({
    fileCount,
    showTotals,
    totals,
  }: {
    fileCount: number;
    showTotals: boolean;
    totals: ReturnType<typeof sumFileStats>;
  }) => (
    <>
      {toFileCountLabel(fileCount)}
      {showTotals ? (
        <span className="ml-2 inline-flex items-center gap-2 text-xs">
          <span className="text-latte-green">+{totals?.additions ?? "—"}</span>
          <span className="text-latte-red">-{totals?.deletions ?? "—"}</span>
        </span>
      ) : null}
    </>
  ),
);

DiffSummaryDescription.displayName = "DiffSummaryDescription";

const DiffFilePatchContent = memo(
  ({ filePath, loadingFile, fileData, renderedPatch, onExpandDiff }: DiffFilePatchContentProps) => {
    if (loadingFile) {
      return <p className="text-latte-subtext0 text-xs">Loading diff…</p>;
    }
    if (fileData?.binary) {
      return <p className="text-latte-subtext0 text-xs">Binary file (no diff).</p>;
    }
    if (!fileData?.patch) {
      return <p className="text-latte-subtext0 text-xs">No diff available.</p>;
    }
    return (
      <div className="custom-scrollbar max-h-[360px] overflow-auto">
        {renderedPatch ? <DiffPatch lines={renderedPatch.lines} /> : null}
        {renderedPatch?.truncated ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-latte-subtext0">
              Showing first {renderedPatch.previewLines} of {renderedPatch.totalLines} lines.
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
        {fileData.truncated ? (
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
    onToggle,
    onExpandDiff,
  }: DiffFileItemProps) => {
    const statusLabel = formatDiffStatusLabel(file.status);
    const additionsLabel = formatDiffCount(file.additions);
    const deletionsLabel = formatDiffCount(file.deletions);
    return (
      <InsetPanel key={`${file.path}-${file.status}`}>
        <RowButton type="button" onClick={() => onToggle(file.path)}>
          <div className="flex min-w-0 items-center gap-3">
            <TagPill tone="status" className={`${diffStatusClass(statusLabel)} shrink-0`}>
              {statusLabel}
            </TagPill>
            <FilePathLabel path={file.path} size="sm" tailSegments={3} className="font-mono" />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-latte-green">+{additionsLabel}</span>
            <span className="text-latte-red">-{deletionsLabel}</span>
            {isOpen ? (
              <ChevronUp className="text-latte-subtext0 h-4 w-4" />
            ) : (
              <ChevronDown className="text-latte-subtext0 h-4 w-4" />
            )}
            <span className="sr-only">{isOpen ? "Hide" : "Show"}</span>
          </div>
        </RowButton>
        {isOpen ? (
          <PanelSection>
            <DiffFilePatchContent
              filePath={file.path}
              loadingFile={loadingFile}
              fileData={fileData}
              renderedPatch={renderedPatch}
              onExpandDiff={onExpandDiff}
            />
          </PanelSection>
        ) : null}
      </InsetPanel>
    );
  },
);

DiffFileItem.displayName = "DiffFileItem";

const DiffFileList = memo(
  ({
    files,
    diffOpen,
    diffLoadingFiles,
    diffFiles,
    renderedPatches,
    onToggle,
    onExpandDiff,
  }: DiffFileListProps) => (
    <div className="flex flex-col gap-2">
      {files.map((file) => (
        <DiffFileItem
          key={`${file.path}-${file.status}`}
          file={file}
          isOpen={Boolean(diffOpen[file.path])}
          loadingFile={Boolean(diffLoadingFiles[file.path])}
          fileData={diffFiles[file.path]}
          renderedPatch={renderedPatches[file.path]}
          onToggle={onToggle}
          onExpandDiff={onExpandDiff}
        />
      ))}
    </div>
  ),
);

DiffFileList.displayName = "DiffFileList";

export const DiffSection = memo(({ state, actions }: DiffSectionProps) => {
  const { diffSummary, diffError, diffLoading, diffFiles, diffOpen, diffLoadingFiles } = state;
  const { onRefresh, onToggle } = actions;
  const [expandedDiffs, setExpandedDiffs] = useAtom(diffExpandedAtom);
  const totals = useMemo(() => sumFileStats(diffSummary?.files), [diffSummary]);
  const files = diffSummary?.files ?? [];
  const fileCount = files.length;
  const showCleanState = shouldShowCleanState(diffSummary);

  useEffect(() => {
    syncExpandedDiffs(diffSummary, setExpandedDiffs);
  }, [diffSummary, setExpandedDiffs]);

  const handleExpandDiff = useCallback(
    (path: string) => {
      setExpandedDiffs((prev) => (prev[path] ? prev : { ...prev, [path]: true }));
    },
    [setExpandedDiffs],
  );

  const renderedPatches = useMemo(
    () => buildRenderedPatches(diffOpen, diffFiles, expandedDiffs),
    [diffOpen, diffFiles, expandedDiffs],
  );

  return (
    <Card className="flex flex-col gap-3">
      <SectionHeader
        title="Changes"
        description={
          <DiffSummaryDescription
            fileCount={fileCount}
            showTotals={Boolean(diffSummary)}
            totals={totals}
          />
        }
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={diffLoading}
            aria-label="Refresh changes"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>
        }
      />
      {diffSummary?.repoRoot ? (
        <p className="text-latte-subtext0 text-xs">Repo: {formatPath(diffSummary.repoRoot)}</p>
      ) : null}
      <DiffSummaryReasonCallout reason={diffSummary?.reason} />
      <DiffErrorCallout diffError={diffError} />
      <div className={`relative ${diffLoading ? "min-h-[120px]" : ""}`}>
        {diffLoading ? <LoadingOverlay label="Loading changes..." blocking={false} /> : null}
        {showCleanState ? (
          <EmptyState
            icon={<FileCheck className="text-latte-green h-6 w-6" />}
            message="Working directory is clean"
            iconWrapperClassName="bg-latte-green/10"
          />
        ) : null}
        <DiffFileList
          files={files}
          diffOpen={diffOpen}
          diffLoadingFiles={diffLoadingFiles}
          diffFiles={diffFiles}
          renderedPatches={renderedPatches}
          onToggle={onToggle}
          onExpandDiff={handleExpandDiff}
        />
      </div>
    </Card>
  );
});

DiffSection.displayName = "DiffSection";
