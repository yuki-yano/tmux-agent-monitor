import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  SessionDetail,
  SessionStateTimelineSource,
  SessionStateValue,
} from "@vde-monitor/shared";

type PersistedSession = {
  paneId: string;
  lastOutputAt: string | null;
  lastEventAt: string | null;
  lastMessage: string | null;
  lastInputAt: string | null;
  customTitle: string | null;
  state: SessionStateValue;
  stateReason: string;
};

export type PersistedTimelineEvent = {
  id: string;
  paneId: string;
  state: SessionStateValue;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  source: SessionStateTimelineSource;
};

export type PersistedTimelineRecord = Record<string, PersistedTimelineEvent[]>;

type PersistedState = {
  version: 2;
  savedAt: string;
  sessions: Record<string, PersistedSession>;
  timeline: PersistedTimelineRecord;
};

const getStatePath = () => {
  return path.join(os.homedir(), ".vde-monitor", "state.json");
};

export const loadState = (): PersistedState | null => {
  try {
    const raw = fs.readFileSync(getStatePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isPersistedState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

type SaveStateOptions = {
  timeline?: PersistedTimelineRecord;
};

const isStateValue = (value: unknown): value is SessionStateValue =>
  value === "RUNNING" ||
  value === "WAITING_INPUT" ||
  value === "WAITING_PERMISSION" ||
  value === "SHELL" ||
  value === "UNKNOWN";

const isTimelineSource = (value: unknown): value is SessionStateTimelineSource =>
  value === "poll" || value === "hook" || value === "restore";

const isPersistedTimelineEvent = (value: unknown): value is PersistedTimelineEvent => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Partial<PersistedTimelineEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.paneId === "string" &&
    isStateValue(event.state) &&
    typeof event.reason === "string" &&
    typeof event.startedAt === "string" &&
    (event.endedAt == null || typeof event.endedAt === "string") &&
    isTimelineSource(event.source)
  );
};

const isPersistedState = (value: unknown): value is PersistedState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const state = value as Partial<PersistedState>;
  return (
    state.version === 2 &&
    typeof state.savedAt === "string" &&
    Boolean(state.sessions) &&
    typeof state.sessions === "object" &&
    Boolean(state.timeline) &&
    typeof state.timeline === "object"
  );
};

export const saveState = (sessions: SessionDetail[], options: SaveStateOptions = {}) => {
  const data: PersistedState = {
    version: 2,
    savedAt: new Date().toISOString(),
    sessions: Object.fromEntries(
      sessions.map((session) => [
        session.paneId,
        {
          paneId: session.paneId,
          lastOutputAt: session.lastOutputAt,
          lastEventAt: session.lastEventAt,
          lastMessage: session.lastMessage,
          lastInputAt: session.lastInputAt,
          customTitle: session.customTitle ?? null,
          state: session.state,
          stateReason: session.stateReason,
        },
      ]),
    ),
    timeline: options.timeline ?? {},
  };
  const dir = path.dirname(getStatePath());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(getStatePath(), `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
};

export type PersistedSessionMap = Map<string, PersistedSession>;
export type PersistedTimelineMap = Map<string, PersistedTimelineEvent[]>;

export const restoreSessions = () => {
  const state = loadState();
  if (!state) {
    return new Map();
  }
  return new Map(Object.entries(state.sessions)) as PersistedSessionMap;
};

export const restoreTimeline = (): PersistedTimelineMap => {
  const state = loadState();
  if (!state) {
    return new Map();
  }
  const entries = Object.entries(state.timeline ?? {})
    .map(([paneId, events]) => {
      if (!Array.isArray(events)) {
        return [paneId, [] as PersistedTimelineEvent[]] as const;
      }
      return [paneId, events.filter(isPersistedTimelineEvent)] as const;
    })
    .filter(([, events]) => events.length > 0);
  return new Map(entries);
};
