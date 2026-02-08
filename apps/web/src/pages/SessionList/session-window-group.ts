import type { SessionSummary } from "@vde-monitor/shared";

export type SessionWindowGroup = {
  sessionName: string;
  windowIndex: number;
  sessions: SessionSummary[];
  lastInputAt: string | null;
};

const parseTime = (value: string | null) => {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
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

const comparePanes = (a: SessionSummary, b: SessionSummary) => {
  if (a.paneActive !== b.paneActive) {
    return a.paneActive ? -1 : 1;
  }
  if (a.paneIndex !== b.paneIndex) {
    return a.paneIndex - b.paneIndex;
  }
  return a.paneId.localeCompare(b.paneId);
};

const compareGroups = (a: SessionWindowGroup, b: SessionWindowGroup) => {
  const sessionCompare = a.sessionName.localeCompare(b.sessionName);
  if (sessionCompare !== 0) return sessionCompare;
  return a.windowIndex - b.windowIndex;
};

export const buildSessionWindowGroups = (sessions: SessionSummary[]): SessionWindowGroup[] => {
  const grouped = new Map<string, Map<number, SessionSummary[]>>();

  sessions.forEach((session) => {
    const bySession = grouped.get(session.sessionName) ?? new Map<number, SessionSummary[]>();
    const byWindow = bySession.get(session.windowIndex) ?? [];
    byWindow.push(session);
    bySession.set(session.windowIndex, byWindow);
    grouped.set(session.sessionName, bySession);
  });

  const groups: SessionWindowGroup[] = [];
  grouped.forEach((byWindow, sessionName) => {
    byWindow.forEach((groupSessions, windowIndex) => {
      const sorted = [...groupSessions].sort(comparePanes);
      groups.push({
        sessionName,
        windowIndex,
        sessions: sorted,
        lastInputAt: pickLatestInputAt(sorted),
      });
    });
  });

  return groups.sort(compareGroups);
};
