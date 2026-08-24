import type {
  DiffMode,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "@vde-monitor/shared";

type TimelineKeyParams = {
  repoRoot: string | null;
  scope: SessionStateTimelineScope;
  range: SessionStateTimelineRange;
  limit?: number;
};

type DiffSummaryKeyParams = {
  repoRoot: string | null;
  mode: DiffMode;
  worktreePath: string | null;
  branch: string | null;
};

type DiffFileKeyParams = DiffSummaryKeyParams & {
  revision: string | null;
  summarySnapshot: string | null;
  path: string;
};

type CommitScopeKeyParams = {
  repoRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
};

type CommitLogHeadKeyParams = CommitScopeKeyParams & {
  limit: number;
};

type CommitLogTailKeyParams = CommitLogHeadKeyParams & {
  expectedRev: string | null;
  headSnapshot: string | null;
};

type FilesScopeKeyParams = {
  resolvedRoot: string | null;
  worktreePath: string | null;
};

type FilesTreeKeyParams = FilesScopeKeyParams & {
  path: string;
  cursor: string | null;
  limit: number;
};

type FilesSearchKeyParams = FilesScopeKeyParams & {
  query: string;
  cursor: string | null;
  limit: number;
};

type FilesLookupKeyParams = {
  targetPaneId: string;
  targetRoot: string;
  query: string;
  cursor: string | null;
  limit: number;
  exactReference: boolean;
};

type FilesContentKeyParams = {
  targetPaneId: string;
  targetRoot: string;
  targetWorktreePath: string | null;
  path: string;
  maxBytes: number;
};

export const sessionDetailQueryKeys = {
  all: ["session-detail"] as const,
  pane: (paneId: string) => [...sessionDetailQueryKeys.all, paneId] as const,
  resource: (paneId: string, resource: string) =>
    [...sessionDetailQueryKeys.pane(paneId), resource] as const,
  branchesRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "branches"),
  branches: (paneId: string, repoRoot: string | null) =>
    [...sessionDetailQueryKeys.branchesRoot(paneId), { repoRoot }] as const,
  worktreesRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "worktrees"),
  worktrees: (paneId: string, repoRoot: string | null) =>
    [...sessionDetailQueryKeys.worktreesRoot(paneId), { repoRoot }] as const,
  timelineRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "timeline"),
  timeline: (paneId: string, params: TimelineKeyParams) =>
    [...sessionDetailQueryKeys.timelineRoot(paneId), params] as const,
  notesRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "notes"),
  notes: (paneId: string, repoRoot: string | null) =>
    [...sessionDetailQueryKeys.notesRoot(paneId), { repoRoot }] as const,
  diffSummaryRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "diff-summary"),
  diffSummary: (paneId: string, params: DiffSummaryKeyParams) =>
    [...sessionDetailQueryKeys.diffSummaryRoot(paneId), params] as const,
  diffFileRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "diff-file"),
  diffFile: (paneId: string, params: DiffFileKeyParams) =>
    [...sessionDetailQueryKeys.diffFileRoot(paneId), params] as const,
  commitsRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "commits"),
  commitLogRoot: (paneId: string) =>
    [...sessionDetailQueryKeys.commitsRoot(paneId), "log"] as const,
  commitLogHead: (paneId: string, params: CommitLogHeadKeyParams) =>
    [...sessionDetailQueryKeys.commitLogRoot(paneId), "head", params] as const,
  commitLogTail: (paneId: string, params: CommitLogTailKeyParams) =>
    [...sessionDetailQueryKeys.commitLogRoot(paneId), "tail", params] as const,
  commitDetail: (paneId: string, params: CommitScopeKeyParams & { hash: string }) =>
    [...sessionDetailQueryKeys.commitsRoot(paneId), "detail", params] as const,
  commitFile: (paneId: string, params: CommitScopeKeyParams & { hash: string; path: string }) =>
    [...sessionDetailQueryKeys.commitsRoot(paneId), "file", params] as const,
  filesRoot: (paneId: string) => sessionDetailQueryKeys.resource(paneId, "files"),
  filesScope: (paneId: string, params: FilesScopeKeyParams) =>
    [...sessionDetailQueryKeys.filesRoot(paneId), "scope", params] as const,
  filesTreeRoot: (paneId: string, params: FilesScopeKeyParams) =>
    [...sessionDetailQueryKeys.filesScope(paneId, params), "tree"] as const,
  filesTree: (paneId: string, params: FilesTreeKeyParams) =>
    [
      ...sessionDetailQueryKeys.filesTreeRoot(paneId, {
        resolvedRoot: params.resolvedRoot,
        worktreePath: params.worktreePath,
      }),
      {
        path: params.path,
        cursor: params.cursor,
        limit: params.limit,
      },
    ] as const,
  filesSearchRoot: (paneId: string, params: FilesScopeKeyParams) =>
    [...sessionDetailQueryKeys.filesScope(paneId, params), "search"] as const,
  filesSearch: (paneId: string, params: FilesSearchKeyParams) =>
    [
      ...sessionDetailQueryKeys.filesSearchRoot(paneId, {
        resolvedRoot: params.resolvedRoot,
        worktreePath: params.worktreePath,
      }),
      {
        query: params.query,
        cursor: params.cursor,
        limit: params.limit,
      },
    ] as const,
  filesLookupRoot: (paneId: string, params: FilesScopeKeyParams) =>
    [...sessionDetailQueryKeys.filesScope(paneId, params), "lookup"] as const,
  filesLookup: (paneId: string, scope: FilesScopeKeyParams, params: FilesLookupKeyParams) =>
    [...sessionDetailQueryKeys.filesLookupRoot(paneId, scope), params] as const,
  filesContentRoot: (paneId: string, params: FilesScopeKeyParams) =>
    [...sessionDetailQueryKeys.filesScope(paneId, params), "content"] as const,
  filesContent: (paneId: string, scope: FilesScopeKeyParams, params: FilesContentKeyParams) =>
    [...sessionDetailQueryKeys.filesContentRoot(paneId, scope), params] as const,
};
