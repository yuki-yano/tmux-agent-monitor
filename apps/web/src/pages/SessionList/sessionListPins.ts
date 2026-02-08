export type SessionListPinScope = "repos" | "sessions" | "windows" | "panes";

export type SessionListPins = Record<SessionListPinScope, string[]>;

const SESSION_LIST_PINS_STORAGE_KEY = "vde-monitor-session-list-pins";

const EMPTY_PINS: SessionListPins = {
  repos: [],
  sessions: [],
  windows: [],
  panes: [],
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const normalizePinList = (value: unknown): string[] => {
  if (!isStringArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter((item) => item.length > 0)));
};

const normalizePins = (value: unknown): SessionListPins => {
  if (value == null || typeof value !== "object") {
    return EMPTY_PINS;
  }
  const raw = value as Record<string, unknown>;
  return {
    repos: normalizePinList(raw.repos),
    sessions: normalizePinList(raw.sessions),
    windows: normalizePinList(raw.windows),
    panes: normalizePinList(raw.panes),
  };
};

const togglePinValue = (values: string[], target: string): string[] => {
  if (target.length === 0) {
    return values;
  }
  if (values.includes(target)) {
    return values.filter((value) => value !== target);
  }
  return [...values, target];
};

export const createSessionWindowSessionPinKey = (sessionName: string) => `session:${sessionName}`;

export const createSessionWindowPinKey = (sessionName: string, windowIndex: number) =>
  `window:${sessionName}:${windowIndex}`;

export const createRepoPinKey = (repoRoot: string | null) => `repo:${repoRoot ?? "__NO_REPO__"}`;

export const readStoredSessionListPins = (): SessionListPins => {
  if (typeof window === "undefined") {
    return EMPTY_PINS;
  }
  const stored = window.localStorage.getItem(SESSION_LIST_PINS_STORAGE_KEY);
  if (!stored) {
    return EMPTY_PINS;
  }
  try {
    const parsed = JSON.parse(stored) as unknown;
    return normalizePins(parsed);
  } catch {
    return EMPTY_PINS;
  }
};

export const storeSessionListPins = (pins: SessionListPins) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_LIST_PINS_STORAGE_KEY, JSON.stringify(normalizePins(pins)));
};

export const toggleSessionListPin = (
  pins: SessionListPins,
  scope: SessionListPinScope,
  key: string,
): SessionListPins => {
  return {
    ...pins,
    [scope]: togglePinValue(pins[scope], key),
  };
};
