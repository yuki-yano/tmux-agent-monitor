import { execa } from "execa";

import { setMapEntryWithLimit } from "../cache";
import { type AgentType, buildAgent, normalizeTty } from "./agent-resolver-utils";

const runPs = async (args: string[], timeout: number) =>
  execa("ps", args, { reject: false, timeout });

const processCacheTtlMs = 1000;
const PROCESS_COMMAND_CACHE_MAX_ENTRIES = 1000;
const TTY_AGENT_CACHE_MAX_ENTRIES = 500;
const processCommandCache = new Map<number, { command: string; at: number }>();
const ttyAgentCache = new Map<string, { agent: AgentType; at: number }>();
const processSnapshotCache = {
  at: 0,
  byPid: new Map<number, { pid: number; ppid: number; command: string }>(),
  children: new Map<number, number[]>(),
};

type ProcessSnapshotEntry = {
  pid: number;
  ppid: number;
  command: string;
};

const parseProcessSnapshotLine = (line: string): ProcessSnapshotEntry | null => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) {
    return null;
  }
  const pid = Number.parseInt(match[1] ?? "", 10);
  const ppid = Number.parseInt(match[2] ?? "", 10);
  if (Number.isNaN(pid) || Number.isNaN(ppid)) {
    return null;
  }
  return {
    pid,
    ppid,
    command: match[3] ?? "",
  };
};

const appendChildPid = (children: Map<number, number[]>, ppid: number, pid: number) => {
  const list = children.get(ppid) ?? [];
  list.push(pid);
  children.set(ppid, list);
};

const buildProcessSnapshotMaps = (stdout: string) => {
  const byPid = new Map<number, ProcessSnapshotEntry>();
  const children = new Map<number, number[]>();
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);

  lines.forEach((line) => {
    const entry = parseProcessSnapshotLine(line);
    if (!entry) {
      return;
    }
    byPid.set(entry.pid, entry);
    appendChildPid(children, entry.ppid, entry.pid);
  });

  return { byPid, children };
};

export const getProcessCommand = async (pid: number | null) => {
  if (!pid) {
    return null;
  }
  const cached = processCommandCache.get(pid);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < processCacheTtlMs) {
    return cached.command;
  }
  try {
    const result = await runPs(["-p", String(pid), "-o", "command="], 1000);
    const command = (result.stdout ?? "").trim();
    if (command.length === 0) {
      return null;
    }
    setMapEntryWithLimit(
      processCommandCache,
      pid,
      { command, at: nowMs },
      PROCESS_COMMAND_CACHE_MAX_ENTRIES,
    );
    return command;
  } catch {
    return null;
  }
};

const loadProcessSnapshot = async () => {
  const nowMs = Date.now();
  if (nowMs - processSnapshotCache.at < processCacheTtlMs) {
    return processSnapshotCache;
  }
  try {
    const result = await runPs(["-ax", "-o", "pid=,ppid=,command="], 2000);
    const { byPid, children } = buildProcessSnapshotMaps(result.stdout ?? "");
    processSnapshotCache.at = nowMs;
    processSnapshotCache.byPid = byPid;
    processSnapshotCache.children = children;
  } catch {
    // ignore snapshot failures
  }
  return processSnapshotCache;
};

export const findAgentFromPidTree = async (pid: number | null) => {
  if (!pid) {
    return "unknown" as const;
  }
  const snapshot = await loadProcessSnapshot();
  const visited = new Set<number>();
  const stack = [pid];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const entry = snapshot.byPid.get(current);
    if (entry) {
      const agent = buildAgent(entry.command);
      if (agent !== "unknown") {
        return agent;
      }
    }
    const next = snapshot.children.get(current) ?? [];
    next.forEach((child) => {
      if (!visited.has(child)) {
        stack.push(child);
      }
    });
  }
  return "unknown" as const;
};

export const getAgentFromTty = async (tty: string | null) => {
  if (!tty) {
    return "unknown" as const;
  }
  const normalized = normalizeTty(tty);
  const cached = ttyAgentCache.get(normalized);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < processCacheTtlMs) {
    return cached.agent;
  }
  try {
    const result = await runPs(["-o", "command=", "-t", normalized], 1000);
    const lines = (result.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const agent = buildAgent(lines.join(" "));
    setMapEntryWithLimit(
      ttyAgentCache,
      normalized,
      { agent, at: nowMs },
      TTY_AGENT_CACHE_MAX_ENTRIES,
    );
    return agent;
  } catch {
    return "unknown" as const;
  }
};
