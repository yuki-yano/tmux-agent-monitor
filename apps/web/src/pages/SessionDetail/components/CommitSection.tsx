import type { CommitDetail, CommitFileDiff, CommitLog } from "@tmux-agent-monitor/shared";
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react";
import { memo, type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-latte-text text-base font-semibold tracking-tight">
              Commit Log
            </h2>
            <p className="text-latte-text text-sm">
              {(() => {
                const currentCount = commitLog?.commits.length ?? 0;
                const totalCount = commitLog?.totalCount ?? currentCount;
                const suffix = totalCount === 1 ? "" : "s";
                return `${currentCount}/${totalCount} commit${suffix}`;
              })()}
            </p>
          </div>
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
        </div>
        {commitLog?.repoRoot && (
          <p className="text-latte-subtext0 text-xs">Repo: {formatPath(commitLog.repoRoot)}</p>
        )}
        {commitLog?.reason === "cwd_unknown" && (
          <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
            Working directory is unknown for this session.
          </div>
        )}
        {commitLog?.reason === "not_git" && (
          <div className="border-latte-peach/40 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-xs">
            Current directory is not a git repository.
          </div>
        )}
        {commitLog?.reason === "error" && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
            Failed to load commit log.
          </div>
        )}
        {commitError && (
          <div className="border-latte-red/40 bg-latte-red/10 text-latte-red rounded-2xl border px-4 py-2 text-xs">
            {commitError}
          </div>
        )}
        <div className={`relative ${commitLoading ? "min-h-[120px]" : ""}`}>
          {commitLoading && (
            <div className="bg-latte-base/70 pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="border-latte-lavender/20 h-10 w-10 rounded-full border-2" />
                  <div className="border-latte-lavender absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-t-transparent" />
                </div>
                <span className="text-latte-subtext0 text-xs font-medium">Loading commits...</span>
              </div>
            </div>
          )}
          {commitLog && commitLog.commits.length === 0 && !commitLog.reason && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="bg-latte-surface1/50 flex h-12 w-12 items-center justify-center rounded-full">
                <GitCommitHorizontal className="text-latte-overlay1 h-6 w-6" />
              </div>
              <p className="text-latte-subtext0 text-sm">No commits in this repository yet</p>
            </div>
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
                <div
                  key={commit.hash}
                  className="border-latte-surface2/70 bg-latte-base/70 rounded-2xl border"
                >
                  <div className="flex w-full flex-wrap items-start gap-3 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onCopyHash(commit.hash)}
                      className="border-latte-surface2/70 text-latte-subtext0 hover:text-latte-text flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.2em] transition"
                      aria-label={`Copy commit hash ${commit.shortHash}`}
                    >
                      <span className="font-mono">{commit.shortHash}</span>
                      {copiedHash === commit.hash ? (
                        <Check className="text-latte-green h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-latte-text text-sm">{commit.subject}</p>
                        <p className="text-latte-subtext0 text-xs">
                          {commit.authorName} · {formatTimestamp(commit.authoredAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleCommit(commit.hash)}
                        className="ml-auto flex items-center border-0 px-2 text-xs"
                      >
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        <span className="sr-only">{isOpen ? "Hide" : "Show"}</span>
                      </Button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-latte-surface2/70 border-t px-3 py-2">
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
                            const statusLabel = file.status === "?" ? "U" : file.status;
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
                            const pathLabel = file.renamedFrom
                              ? `${file.renamedFrom} → ${file.path}`
                              : file.path;
                            const renderedPatch = renderedPatches[fileKey];
                            return (
                              <div
                                key={`${file.path}-${file.status}`}
                                className="flex flex-col gap-2"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span
                                      className={`${diffStatusClass(
                                        statusLabel,
                                      )} text-[10px] font-semibold uppercase tracking-[0.25em]`}
                                    >
                                      {statusLabel}
                                    </span>
                                    <span className="text-latte-text truncate">{pathLabel}</span>
                                  </div>
                                  <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
                                    <span className="text-latte-green">+{additions}</span>
                                    <span className="text-latte-red">-{deletions}</span>
                                    <button
                                      type="button"
                                      onClick={() => onToggleCommitFile(commit.hash, file.path)}
                                      className="text-latte-subtext0 hover:text-latte-text inline-flex items-center gap-1"
                                    >
                                      {fileOpen ? (
                                        <ChevronUp className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      )}
                                      <span className="sr-only">{fileOpen ? "Hide" : "Show"}</span>
                                    </button>
                                  </div>
                                </div>
                                {fileOpen && (
                                  <div className="border-latte-surface2/70 bg-latte-base/60 rounded-xl border px-3 py-2">
                                    {loadingFile && (
                                      <p className="text-latte-subtext0 text-xs">Loading diff…</p>
                                    )}
                                    {!loadingFile && fileDetail?.binary && (
                                      <p className="text-latte-subtext0 text-xs">
                                        Binary file (no diff).
                                      </p>
                                    )}
                                    {!loadingFile && !fileDetail?.binary && fileDetail?.patch && (
                                      <div className="custom-scrollbar max-h-[240px] overflow-auto">
                                        <div className="text-latte-text w-max min-w-full whitespace-pre pl-4 font-mono text-xs">
                                          {renderedPatch}
                                        </div>
                                        {fileDetail.truncated && (
                                          <p className="text-latte-subtext0 mt-2 text-xs">
                                            Diff truncated.
                                          </p>
                                        )}
                                      </div>
                                    )}
                                    {!loadingFile && !fileDetail?.binary && !fileDetail?.patch && (
                                      <p className="text-latte-subtext0 text-xs">
                                        No diff available.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
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
                    </div>
                  )}
                </div>
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
