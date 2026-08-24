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
};
