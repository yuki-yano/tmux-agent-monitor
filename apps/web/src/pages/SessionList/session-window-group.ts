import type { SessionSummary } from "@vde-monitor/shared";

export type SessionWindowGroup = {
  sessionName: string;
  windowIndex: number;
  sessions: SessionSummary[];
  lastInputAt: string | null;
};

export type BuildSessionWindowGroupOptions = {
  isSessionPinned?: (sessionName: string) => boolean;
  isWindowPinned?: (sessionName: string, windowIndex: number) => boolean;
  isPanePinned?: (session: SessionSummary) => boolean;
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

const comparePinnedDesc = (a: boolean, b: boolean) => {
  if (a === b) {
    return 0;
  }
  return a ? -1 : 1;
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

const comparePanes = (
  a: SessionSummary,
  b: SessionSummary,
  isPanePinned?: (session: SessionSummary) => boolean,
) => {
  const pinnedCompare = comparePinnedDesc(Boolean(isPanePinned?.(a)), Boolean(isPanePinned?.(b)));
  if (pinnedCompare !== 0) {
    return pinnedCompare;
  }
  if (a.paneActive !== b.paneActive) {
    return a.paneActive ? -1 : 1;
  }
  if (a.paneIndex !== b.paneIndex) {
    return a.paneIndex - b.paneIndex;
  }
  return a.paneId.localeCompare(b.paneId);
};

const compareGroups = (
  a: SessionWindowGroup,
  b: SessionWindowGroup,
  options?: BuildSessionWindowGroupOptions,
) => {
  const sessionPinnedCompare = comparePinnedDesc(
    Boolean(options?.isSessionPinned?.(a.sessionName)),
    Boolean(options?.isSessionPinned?.(b.sessionName)),
  );
  if (sessionPinnedCompare !== 0) {
    return sessionPinnedCompare;
  }

  const sessionCompare = a.sessionName.localeCompare(b.sessionName);
  if (sessionCompare !== 0) {
    return sessionCompare;
  }

  const windowPinnedCompare = comparePinnedDesc(
    Boolean(options?.isWindowPinned?.(a.sessionName, a.windowIndex)),
    Boolean(options?.isWindowPinned?.(b.sessionName, b.windowIndex)),
  );
  if (windowPinnedCompare !== 0) {
    return windowPinnedCompare;
  }

  const inputCompare = compareTimeDesc(a.lastInputAt, b.lastInputAt);
  if (inputCompare !== 0) {
    return inputCompare;
  }

  return a.windowIndex - b.windowIndex;
};

export const buildSessionWindowGroups = (
  sessions: SessionSummary[],
  options?: BuildSessionWindowGroupOptions,
): SessionWindowGroup[] => {
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
      const sorted = [...groupSessions].sort((a, b) => comparePanes(a, b, options?.isPanePinned));
      groups.push({
        sessionName,
        windowIndex,
        sessions: sorted,
        lastInputAt: pickLatestInputAt(sorted),
      });
    });
  });

  return groups.sort((a, b) => compareGroups(a, b, options));
};
