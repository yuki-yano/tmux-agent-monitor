import { type CommitLog, type DiffSummary, type SessionSummary } from "@vde-monitor/shared";

export const AUTO_REFRESH_INTERVAL_MS = 10_000;
export const COMMIT_PAGE_SIZE = 10;
export const MAX_DIFF_LINES = 1200;
export const PREVIEW_DIFF_LINES = 240;
export const DISCONNECTED_MESSAGE = "Disconnected. Reconnecting...";

export const diffLineClass = (line: string) => {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) {
    return "text-latte-subtext0";
  }
  if (line.startsWith("@@")) {
    return "text-latte-lavender-text font-semibold";
  }
  if (line.startsWith("+")) {
    return "text-latte-green-text";
  }
  if (line.startsWith("-")) {
    return "text-latte-red-text";
  }
  return "text-latte-text";
};

export const diffStatusClass = (status: string) => {
  switch (status) {
    case "A":
      return "text-latte-green-text";
    case "M":
      return "text-latte-yellow-text";
    case "D":
      return "text-latte-red-text";
    case "R":
    case "C":
      return "text-latte-lavender-text";
    case "U":
      return "text-latte-peach-text";
    default:
      return "text-latte-subtext0";
  }
};

export const formatDiffStatusLabel = (status: string) => (status === "?" ? "A" : status);

export const formatDiffCount = (value: number | null | undefined) =>
  value == null || typeof value === "undefined" ? "—" : String(value);

export const sumFileStats = (
  files: Array<{ additions?: number | null; deletions?: number | null }> | null | undefined,
) => {
  if (!files) return null;
  if (files.length === 0) {
    return { additions: 0, deletions: 0 };
  }
  let additions = 0;
  let deletions = 0;
  let hasTotals = false;
  files.forEach((file) => {
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
};

export const formatTimestamp = (value: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export const buildDiffSummarySnapshot = (summary: DiffSummary) => {
  const files = summary.files
    .map((file) => ({
      path: file.path,
      status: file.status,
      staged: file.staged,
      renamedFrom: file.renamedFrom ?? null,
      additions: file.additions ?? null,
      deletions: file.deletions ?? null,
    }))
    .sort((a, b) => {
      const pathCompare = a.path.localeCompare(b.path);
      if (pathCompare !== 0) return pathCompare;
      const statusCompare = a.status.localeCompare(b.status);
      if (statusCompare !== 0) return statusCompare;
      if (a.staged !== b.staged) return a.staged ? 1 : -1;
      return (a.renamedFrom ?? "").localeCompare(b.renamedFrom ?? "");
    });
  return JSON.stringify({
    repoRoot: summary.repoRoot ?? null,
    rev: summary.rev ?? null,
    truncated: summary.truncated ?? false,
    reason: summary.reason ?? null,
    files,
  });
};

export const buildCommitLogSnapshot = (log: CommitLog) =>
  JSON.stringify({
    repoRoot: log.repoRoot ?? null,
    rev: log.rev ?? null,
    reason: log.reason ?? null,
    totalCount: log.totalCount ?? null,
    commits: log.commits.map((commit) => commit.hash),
  });

export const resolveSessionFileRoot = (
  session: Pick<SessionSummary, "repoRoot" | "worktreePath"> | null,
  virtualWorktreePath: string | null,
) => virtualWorktreePath ?? session?.worktreePath ?? session?.repoRoot ?? null;

export const buildDefaultSessionTitle = (
  session: Pick<SessionSummary, "currentPath" | "paneId" | "sessionName" | "windowIndex">,
) => {
  if (!session.currentPath) {
    return `${session.sessionName}:w${session.windowIndex}:${session.paneId}`;
  }
  const normalized = session.currentPath.replace(/\/+$/, "");
  const name = normalized.split("/").pop() || "unknown";
  return `${name}:w${session.windowIndex}:${session.paneId}`;
};
