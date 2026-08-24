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
};
