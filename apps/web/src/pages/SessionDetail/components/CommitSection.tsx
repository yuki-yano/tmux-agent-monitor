import type { CommitDetail, CommitFileDiff, CommitLog } from "@vde-monitor/shared";
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react";
import { memo, type ReactNode, useMemo, useRef } from "react";

import {
  Button,
  Callout,
  Card,
  ChipButton,
  EmptyState,
  FilePathLabel,
  InsetPanel,
  LoadingOverlay,
  MonoBlock,
  PanelSection,
  SectionHeader,
  TagPill,
} from "@/components/ui";

import { diffLineClass, diffStatusClass, formatPath, formatTimestamp } from "../sessionDetailUtils";

type CommitSectionProps = {
  commitLog: CommitLog | null;
  commitError: string | null;
  commitLoading: boolean;
  commitLoadingMore: boolean;
  commitHasMore: boolean;
  commitDetails: Record<string, CommitDetail>;
  commitFileDetails: Record<string, CommitFileDiff>;
  commitFileOpen: Record<string, boolean>;
  commitFileLoading: Record<string, boolean>;
  commitOpen: Record<string, boolean>;
  commitLoadingDetails: Record<string, boolean>;
  copiedHash: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onToggleCommit: (hash: string) => void;
  onToggleCommitFile: (hash: string, path: string) => void;
  onCopyHash: (hash: string) => void;
};

type CommitFileRowProps = {
  commitHash: string;
  file: CommitDetail["files"][number];
  fileOpen: boolean;
  additions: string;
  deletions: string;
  loadingFile: boolean;
  fileDetail?: CommitFileDiff;
  renderedPatch?: ReactNode;
  onToggleCommitFile: (hash: string, path: string) => void;
};

const CommitFileRow = memo(
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
  }: CommitFileRowProps) => {
    const labelContainerRef = useRef<HTMLDivElement | null>(null);
    const statusLabel = file.status === "?" ? "A" : file.status;

    return (
      <div key={`${file.path}-${file.status}`} className="flex flex-col gap-2">
        <div
          onClick={() => onToggleCommitFile(commitHash, file.path)}
          className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TagPill tone="status" className={`${diffStatusClass(statusLabel)} shrink-0`}>
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
            <span className="text-latte-green">+{additions}</span>
            <span className="text-latte-red">-{deletions}</span>
            <span className="text-latte-overlay1">
              {fileOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </div>
        </div>
        {fileOpen && (
          <div className="border-latte-surface2/70 bg-latte-base/60 rounded-xl border px-3 py-2">
            {loadingFile && <p className="text-latte-subtext0 text-xs">Loading diff…</p>}
            {!loadingFile && fileDetail?.binary && (
              <p className="text-latte-subtext0 text-xs">Binary file (no diff).</p>
            )}
            {!loadingFile && !fileDetail?.binary && fileDetail?.patch && (
              <div className="custom-scrollbar max-h-[240px] overflow-auto">
                <MonoBlock>{renderedPatch}</MonoBlock>
                {fileDetail.truncated && (
                  <p className="text-latte-subtext0 mt-2 text-xs">Diff truncated.</p>
                )}
              </div>
            )}
            {!loadingFile && !fileDetail?.binary && !fileDetail?.patch && (
              <p className="text-latte-subtext0 text-xs">No diff available.</p>
            )}
          </div>
        )}
      </div>
    );
  },
);

CommitFileRow.displayName = "CommitFileRow";

export const CommitSection = memo(
  ({
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
    onRefresh,
    onLoadMore,
    onToggleCommit,
    onToggleCommitFile,
    onCopyHash,
  }: CommitSectionProps) => {
    const renderedPatches = useMemo<Record<string, ReactNode>>(() => {
      const entries = Object.entries(commitFileOpen);
      if (entries.length === 0) {
        return {};
      }
      const next: Record<string, ReactNode> = {};
      entries.forEach(([key, isOpen]) => {
        if (!isOpen) return;
        const file = commitFileDetails[key];
        if (!file?.patch) return;
        next[key] = file.patch.split("\n").map((line, index) => (
          <div
            key={`${index}-${line.slice(0, 12)}`}
            className={`${diffLineClass(line)} -mx-2 block w-full rounded-sm px-2`}
          >
            {line || " "}
          </div>
        ));
      });
      return next;
    }, [commitFileDetails, commitFileOpen]);

    return (
      <Card className="flex flex-col gap-3">
        <SectionHeader
          title="Commit Log"
          description={(() => {
            const currentCount = commitLog?.commits.length ?? 0;
            const totalCount = commitLog?.totalCount ?? currentCount;
            const suffix = totalCount === 1 ? "" : "s";
            return `${currentCount}/${totalCount} commit${suffix}`;
          })()}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={commitLoading}
              aria-label="Refresh commit log"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">Refresh</span>
            </Button>
          }
        />
        {commitLog?.repoRoot && (
          <p className="text-latte-subtext0 text-xs">Repo: {formatPath(commitLog.repoRoot)}</p>
        )}
        {commitLog?.reason === "cwd_unknown" && (
          <Callout tone="warning" size="xs">
            Working directory is unknown for this session.
          </Callout>
        )}
        {commitLog?.reason === "not_git" && (
          <Callout tone="warning" size="xs">
            Current directory is not a git repository.
          </Callout>
        )}
        {commitLog?.reason === "error" && (
          <Callout tone="error" size="xs">
            Failed to load commit log.
          </Callout>
        )}
        {commitError && (
          <Callout tone="error" size="xs">
            {commitError}
          </Callout>
        )}
        <div className={`relative ${commitLoading ? "min-h-[120px]" : ""}`}>
          {commitLoading && <LoadingOverlay label="Loading commits..." blocking={false} />}
          {commitLog && commitLog.commits.length === 0 && !commitLog.reason && (
            <EmptyState
              icon={<GitCommitHorizontal className="text-latte-overlay1 h-6 w-6" />}
              message="No commits in this repository yet"
              iconWrapperClassName="bg-latte-surface1/50"
            />
          )}
          <div className="flex flex-col gap-2">
            {commitLog?.commits.map((commit) => {
              const isOpen = Boolean(commitOpen[commit.hash]);
              const detail = commitDetails[commit.hash];
              const loadingDetail = Boolean(commitLoadingDetails[commit.hash]);
              const commitBody = detail?.body ?? commit.body;
              const totals = (() => {
                if (!detail?.files) return null;
                if (detail.files.length === 0) {
                  return { additions: 0, deletions: 0 };
                }
                let additions = 0;
                let deletions = 0;
                let hasTotals = false;
                detail.files.forEach((file) => {
                  if (typeof file.additions === "number") {
                    additions += file.additions;
                    hasTotals = true;
                  }
                  if (typeof file.deletions === "number") {
                    deletions += file.deletions;
                    hasTotals = true;
                  }
                });
                if (!hasTotals) return null;
                return { additions, deletions };
              })();
              return (
                <InsetPanel key={commit.hash}>
                  <div
                    className="flex w-full cursor-pointer flex-wrap items-start gap-3 px-3 py-2"
                    onClick={() => onToggleCommit(commit.hash)}
                  >
                    <ChipButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopyHash(commit.hash);
                      }}
                      aria-label={`Copy commit hash ${commit.shortHash}`}
                    >
                      <span className="font-mono">{commit.shortHash}</span>
                      {copiedHash === commit.hash ? (
                        <Check className="text-latte-green h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </ChipButton>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-latte-text text-sm">{commit.subject}</p>
                        <p className="text-latte-subtext0 text-xs">
                          {commit.authorName} · {formatTimestamp(commit.authoredAt)}
                        </p>
                      </div>
                      <span
                        className="text-latte-overlay1 ml-auto flex items-center self-center px-2"
                        aria-label={isOpen ? "Collapse commit" : "Expand commit"}
                      >
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </div>
                  </div>
                  {isOpen && (
                    <PanelSection>
                      {loadingDetail && (
                        <p className="text-latte-subtext0 text-xs">Loading commit…</p>
                      )}
                      {!loadingDetail && commitBody && (
                        <pre className="text-latte-subtext0 mb-3 whitespace-pre-wrap text-xs">
                          {commitBody}
                        </pre>
                      )}
                      {!loadingDetail && totals && (
                        <div className="mb-2 flex items-center gap-2 text-xs">
                          <span className="text-latte-subtext0">Total changes</span>
                          <span className="text-latte-green">+{totals.additions}</span>
                          <span className="text-latte-red">-{totals.deletions}</span>
                        </div>
                      )}
                      {!loadingDetail && detail?.files && detail.files.length > 0 && (
                        <div className="flex flex-col gap-2 text-xs">
                          {detail.files.map((file) => {
                            const fileKey = `${commit.hash}:${file.path}`;
                            const fileOpen = Boolean(commitFileOpen[fileKey]);
                            const fileDetail = commitFileDetails[fileKey];
                            const loadingFile = Boolean(commitFileLoading[fileKey]);
                            const additions =
                              file.additions === null || typeof file.additions === "undefined"
                                ? "—"
                                : String(file.additions);
                            const deletions =
                              file.deletions === null || typeof file.deletions === "undefined"
                                ? "—"
                                : String(file.deletions);
                            const renderedPatch = renderedPatches[fileKey];
                            return (
                              <CommitFileRow
                                key={`${file.path}-${file.status}`}
                                commitHash={commit.hash}
                                file={file}
                                fileOpen={fileOpen}
                                additions={additions}
                                deletions={deletions}
                                loadingFile={loadingFile}
                                fileDetail={fileDetail}
                                renderedPatch={renderedPatch}
                                onToggleCommitFile={onToggleCommitFile}
                              />
                            );
                          })}
                        </div>
                      )}
                      {!loadingDetail && detail?.files && detail.files.length === 0 && (
                        <p className="text-latte-subtext0 text-xs">No files changed.</p>
                      )}
                      {!loadingDetail && !detail && (
                        <p className="text-latte-subtext0 text-xs">No commit details.</p>
                      )}
                    </PanelSection>
                  )}
                </InsetPanel>
              );
            })}
          </div>
        </div>
        {commitLog && commitHasMore && !commitLog.reason && (
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={commitLoadingMore}>
            <ArrowDown className="h-4 w-4" />
            {commitLoadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </Card>
    );
  },
);

CommitSection.displayName = "CommitSection";
