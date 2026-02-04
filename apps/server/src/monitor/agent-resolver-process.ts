import { execa } from "execa";

import { type AgentType, buildAgent, normalizeTty } from "./agent-resolver-utils.js";

const runPs = async (args: string[], timeout: number) =>
  execa("ps", args, { reject: false, timeout });

const processCacheTtlMs = 5000;
const processCommandCache = new Map<number, { command: string; at: number }>();
const ttyAgentCache = new Map<string, { agent: AgentType; at: number }>();
const processSnapshotCache = {
  at: 0,
  byPid: new Map<number, { pid: number; ppid: number; command: string }>(),
  children: new Map<number, number[]>(),
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
    processCommandCache.set(pid, { command, at: nowMs });
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
    const byPid = new Map<number, { pid: number; ppid: number; command: string }>();
    const children = new Map<number, number[]>();
    const lines = (result.stdout ?? "").split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        continue;
      }
      const pid = Number.parseInt(match[1] ?? "", 10);
      const ppid = Number.parseInt(match[2] ?? "", 10);
      if (Number.isNaN(pid) || Number.isNaN(ppid)) {
        continue;
      }
      const command = match[3] ?? "";
      byPid.set(pid, { pid, ppid, command });
      const list = children.get(ppid) ?? [];
      list.push(pid);
      children.set(ppid, list);
    }
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
    ttyAgentCache.set(normalized, { agent, at: nowMs });
    return agent;
  } catch {
    return "unknown" as const;
  }
};
