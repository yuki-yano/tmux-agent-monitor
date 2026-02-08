import type { SessionSummary } from "@vde-monitor/shared";

export type SessionGroup = {
  repoRoot: string | null;
  sessions: SessionSummary[];
  lastInputAt: string | null;
};

const parseTime = (value: string | null) => {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
};

const resolveComparableTime = (value: string | null) =>
  parseTime(value) ?? Number.NEGATIVE_INFINITY;

const compareTimeDesc = (a: string | null, b: string | null) => {
  const aTs = resolveComparableTime(a);
  const bTs = resolveComparableTime(b);
  if (aTs === bTs) return 0;
  return bTs - aTs;
};

const compareSessions = (a: SessionSummary, b: SessionSummary) => {
  const inputCompare = compareTimeDesc(a.lastInputAt, b.lastInputAt);
  if (inputCompare !== 0) return inputCompare;
  const outputCompare = compareTimeDesc(a.lastOutputAt, b.lastOutputAt);
  if (outputCompare !== 0) return outputCompare;
  const sessionCompare = a.sessionName.localeCompare(b.sessionName);
  if (sessionCompare !== 0) return sessionCompare;
  return a.paneId.localeCompare(b.paneId);
};

const pickLatestInputAt = (sessions: SessionSummary[]) => {
  let latestValue: string | null = null;
  let latestTs: number | null = null;
  sessions.forEach((session) => {
    const ts = parseTime(session.lastInputAt);
    if (ts == null) return;
    if (latestTs == null || ts > latestTs) {
      latestTs = ts;
      latestValue = session.lastInputAt ?? null;
    }
  });
  return latestValue;
};

export const buildSessionGroups = (sessions: SessionSummary[]): SessionGroup[] => {
  const grouped = new Map<string | null, SessionSummary[]>();
  sessions.forEach((session) => {
    const key = session.repoRoot ?? null;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(session);
    } else {
      grouped.set(key, [session]);
    }
  });

  const groups = Array.from(grouped.entries()).map(([repoRoot, groupSessions]) => {
    const sorted = [...groupSessions].sort(compareSessions);
    return {
      repoRoot,
      sessions: sorted,
      lastInputAt: pickLatestInputAt(sorted),
    };
  });

  groups.sort((a, b) => {
    const inputCompare = compareTimeDesc(a.lastInputAt, b.lastInputAt);
    if (inputCompare !== 0) return inputCompare;
    if (a.repoRoot == null && b.repoRoot == null) return 0;
    if (a.repoRoot == null) return 1;
    if (b.repoRoot == null) return -1;
    return a.repoRoot.localeCompare(b.repoRoot);
  });

  return groups;
};
