import {
  type CommitLog,
  defaultDangerCommandPatterns,
  type DiffSummary,
} from "@vde-monitor/shared";

import { stripAnsi } from "@/lib/ansi-text-utils";

export type { LastInputTone } from "@/lib/session-format";
export {
  agentLabelFor,
  agentToneFor,
  formatPath,
  formatRelativeTime,
  formatStateLabel,
  getLastInputTone,
  isEditorCommand,
  isKnownAgent,
  stateTone,
} from "@/lib/session-format";

const compilePatterns = () =>
  defaultDangerCommandPatterns.map((pattern) => new RegExp(pattern, "i"));

const normalizeScreenTextForSearch = (screenText: string) =>
  stripAnsi(screenText).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export const AUTO_REFRESH_INTERVAL_MS = 10_000;
export const MAX_DIFF_LINES = 1200;
export const PREVIEW_DIFF_LINES = 240;
export const DISCONNECTED_MESSAGE = "Disconnected. Reconnecting...";
export const backLinkClass =
  "inline-flex items-center justify-center gap-2 rounded-full border border-latte-surface2 bg-transparent px-3 py-1.5 text-xs font-semibold text-latte-subtext0 transition hover:bg-latte-crust hover:text-latte-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-latte-lavender";

export const isDangerousText = (text: string) => {
  const patterns = compilePatterns();
  const normalized = text.replace(/\r\n/g, "\n").split("\n");
  return normalized.some((line) =>
    patterns.some((pattern) => pattern.test(line.toLowerCase().replace(/\s+/g, " ").trim())),
  );
};

export const extractCodexContextLeft = (screenText: string): string | null => {
  if (!screenText) {
    return null;
  }
  const normalized = normalizeScreenTextForSearch(screenText);
  const pattern = /(\d{1,3}(?:\.\d+)?)%\s+context left\b/gi;
  let match: RegExpExecArray | null = null;
  let lastValue: string | null = null;
  while (true) {
    match = pattern.exec(normalized);
    if (!match) {
      break;
    }
    const value = match[1];
    if (value) {
      lastValue = value;
    }
  }
  return lastValue ? `${lastValue}% context left` : null;
};

export const diffLineClass = (line: string) => {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) {
    return "text-latte-subtext0";
  }
  if (line.startsWith("@@")) {
    return "text-latte-lavender font-semibold";
  }
  if (line.startsWith("+")) {
    return "text-latte-green";
  }
  if (line.startsWith("-")) {
    return "text-latte-red";
  }
  return "text-latte-text";
};

export const diffStatusClass = (status: string) => {
  switch (status) {
    case "A":
      return "text-latte-green";
    case "M":
      return "text-latte-yellow";
    case "D":
      return "text-latte-red";
    case "R":
    case "C":
      return "text-latte-lavender";
    case "U":
      return "text-latte-peach";
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

export const buildDiffSummarySignature = (summary: DiffSummary) => {
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

export const buildCommitLogSignature = (log: CommitLog) =>
  JSON.stringify({
    repoRoot: log.repoRoot ?? null,
    rev: log.rev ?? null,
    reason: log.reason ?? null,
    totalCount: log.totalCount ?? null,
    commits: log.commits.map((commit) => commit.hash),
  });
