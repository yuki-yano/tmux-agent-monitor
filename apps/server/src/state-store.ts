import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SessionDetail, SessionStateValue } from "@tmux-agent-monitor/shared";

type PersistedSession = {
  paneId: string;
  lastOutputAt: string | null;
  lastEventAt: string | null;
  lastMessage: string | null;
  state: SessionStateValue;
  stateReason: string;
};

type PersistedState = {
  version: 1;
  savedAt: string;
  sessions: Record<string, PersistedSession>;
};

const getStatePath = () => {
  return path.join(os.homedir(), ".tmux-agent-monitor", "state.json");
};

export const loadState = (): PersistedState | null => {
  try {
    const raw = fs.readFileSync(getStatePath(), "utf8");
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
};

export const saveState = (sessions: SessionDetail[]) => {
  const data: PersistedState = {
    version: 1,
    savedAt: new Date().toISOString(),
    sessions: Object.fromEntries(
      sessions.map((session) => [
        session.paneId,
        {
          paneId: session.paneId,
          lastOutputAt: session.lastOutputAt,
          lastEventAt: session.lastEventAt,
          lastMessage: session.lastMessage,
          state: session.state,
          stateReason: session.stateReason,
        },
      ]),
    ),
  };
  const dir = path.dirname(getStatePath());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(getStatePath(), `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
};

export type PersistedSessionMap = Map<string, PersistedSession>;

export const restoreSessions = () => {
  const state = loadState();
  if (!state) {
    return new Map();
  }
  return new Map(Object.entries(state.sessions)) as PersistedSessionMap;
};
