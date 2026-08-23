import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SessionDetail } from "@vde-monitor/shared";
import { execa } from "execa";

import { normalizeAbsolutePath } from "../path-normalization";

type ResumeResolveFailureReason = "not_found" | "ambiguous" | "unsupported" | "invalid_input";
type ResumeResolveSource = "hook" | "lsof" | "history";
type ResumeResolveConfidence = "high" | "medium" | "low";

export type ResumeResolvedSession =
  | {
      ok: true;
      sessionId: string;
      source: ResumeResolveSource;
      confidence: ResumeResolveConfidence;
      agent: "codex" | "claude";
    }
  | {
      ok: false;
      reason: ResumeResolveFailureReason;
      agent: "codex" | "claude" | "unknown";
    };

type ScoredCandidate = {
  sessionId: string;
  score: number;
  confidence: ResumeResolveConfidence;
};
const FIRST_JSON_LINE_MAX_BYTES = 64 * 1024;
const FIRST_JSON_LINE_CHUNK_BYTES = 4096;
const LSOF_PID_BATCH_SIZE = 256;
const readString = (value: unknown): string => (typeof value === "string" ? value : "");

const scoreByEventTime = (fileMtimeMs: number, lastEventAt: string | null): number => {
  if (!lastEventAt) {
    return 0;
  }
  const eventAtMs = Date.parse(lastEventAt);
  if (Number.isNaN(eventAtMs)) {
    return 0;
  }
  const diffMs = Math.abs(fileMtimeMs - eventAtMs);
  if (diffMs <= 10 * 60 * 1000) {
    return 30;
  }
  if (diffMs <= 30 * 60 * 1000) {
    return 10;
  }
  return 0;
};

const resolveConfidenceFromScore = (score: number): ResumeResolveConfidence => {
  if (score >= 100) {
    return "high";
  }
  if (score >= 30) {
    return "medium";
  }
  return "low";
};

const chooseBestCandidate = (
  candidates: ScoredCandidate[],
): { ok: true; candidate: ScoredCandidate } | { ok: false; reason: "not_found" | "ambiguous" } => {
  if (candidates.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const first = sorted[0];
  const second = sorted[1];
  if (!first) {
    return { ok: false, reason: "not_found" };
  }
  if (second && first.score === second.score) {
    return { ok: false, reason: "ambiguous" };
  }
  return { ok: true, candidate: first };
};

const readFirstJsonLine = async (filePath: string): Promise<Record<string, unknown> | null> => {
  let fileHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fileHandle = await fs.open(filePath, "r");
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (totalBytes < FIRST_JSON_LINE_MAX_BYTES) {
      const nextChunkBytes = Math.min(
        FIRST_JSON_LINE_CHUNK_BYTES,
        FIRST_JSON_LINE_MAX_BYTES - totalBytes,
      );
      const chunkBuffer = Buffer.allocUnsafe(nextChunkBytes);
      const { bytesRead } = await fileHandle.read(chunkBuffer, 0, nextChunkBytes, null);
      if (bytesRead <= 0) {
        break;
      }
      const chunk = chunkBuffer.subarray(0, bytesRead);
      totalBytes += bytesRead;
      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex >= 0) {
        chunks.push(chunk.subarray(0, newlineIndex));
        break;
      }
      chunks.push(chunk);
    }

    const firstLine = Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
    if (!firstLine) {
      return null;
    }
    const parsed = JSON.parse(firstLine) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
};

const encodeClaudeProjectDir = (cwd: string) => cwd.replace(/\//g, "-");
const encodeClaudeProjectDirLegacy = (cwd: string) => cwd.replace(/[/.]/g, "-");

const resolveClaudeProjectDirNames = (cwd: string) => {
  const primary = encodeClaudeProjectDir(cwd);
  const legacy = encodeClaudeProjectDirLegacy(cwd);
  return primary === legacy ? [primary] : [primary, legacy];
};

const resolveClaudeSessionFromHistory = async (
  pane: SessionDetail,
): Promise<ResumeResolvedSession> => {
  const normalizedCwd = normalizeAbsolutePath(pane.currentPath);
  if (!normalizedCwd) {
    return { ok: false, reason: "invalid_input", agent: "claude" };
  }
  const files = new Set<string>();
  const projectDirs = resolveClaudeProjectDirNames(normalizedCwd).map((encodedDir) =>
    path.join(os.homedir(), ".claude", "projects", encodedDir),
  );
  for (const projectDir of projectDirs) {
    try {
      const dirEntries = await fs.readdir(projectDir, { withFileTypes: true });
      dirEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => path.join(projectDir, entry.name))
        .forEach((filePath) => files.add(filePath));
    } catch {
      // ignore missing/invalid project dir and continue with other encodings
    }
  }
  if (files.size === 0) {
    return { ok: false, reason: "not_found", agent: "claude" };
  }

  const candidates: ScoredCandidate[] = [];
  for (const filePath of files) {
    const sessionId = path.basename(filePath, ".jsonl").trim();
    if (!sessionId) {
      continue;
    }
    let score = 1;
    try {
      const stat = await fs.stat(filePath);
      score += scoreByEventTime(stat.mtimeMs, pane.lastEventAt ?? null);
    } catch {
      // ignore mtime scoring errors
    }
    const firstLine = await readFirstJsonLine(filePath);
    const type = firstLine?.type;
    const payload = firstLine?.payload;
    const payloadRecord =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const sessionCwd =
      type === "session_meta" && payloadRecord
        ? normalizeAbsolutePath(readString(payloadRecord.cwd))
        : null;
    if (sessionCwd && sessionCwd === normalizedCwd) {
      score += 100;
    }
    candidates.push({
      sessionId,
      score,
      confidence: resolveConfidenceFromScore(score),
    });
  }

  const resolved = chooseBestCandidate(candidates);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, agent: "claude" };
  }
  return {
    ok: true,
    sessionId: resolved.candidate.sessionId,
    source: "history",
    confidence: resolved.candidate.confidence,
    agent: "claude",
  };
};

type ProcessEdge = {
  pid: number;
  ppid: number;
};

const parseProcessEdge = (line: string): ProcessEdge | null => {
  const match = line.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return null;
  }
  const pid = Number.parseInt(match[1] ?? "", 10);
  const ppid = Number.parseInt(match[2] ?? "", 10);
  if (Number.isNaN(pid) || Number.isNaN(ppid)) {
    return null;
  }
  return { pid, ppid };
};

const loadDescendantPids = async (rootPid: number): Promise<number[]> => {
  const result = await execa("ps", ["-ax", "-o", "pid=,ppid="], {
    reject: false,
    timeout: 2000,
    maxBuffer: 2_000_000,
  });
  if (result.exitCode !== 0) {
    return [rootPid];
  }
  const childrenByParent = new Map<number, number[]>();
  result.stdout
    .split(/\r?\n/)
    .map((line) => parseProcessEdge(line))
    .filter((edge): edge is ProcessEdge => edge != null)
    .forEach((edge) => {
      const children = childrenByParent.get(edge.ppid) ?? [];
      children.push(edge.pid);
      childrenByParent.set(edge.ppid, children);
    });

  const descendants = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null) {
      continue;
    }
    const children = childrenByParent.get(current) ?? [];
    for (const child of children) {
      if (descendants.has(child)) {
        continue;
      }
      descendants.add(child);
      stack.push(child);
    }
  }
  return Array.from(descendants);
};

const isCommandNotFoundError = (error: unknown, command: string) => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("enoent") || message.includes(`${command.toLowerCase()}: command not found`)
  );
};

const parseCodexSessionFilePath = (line: string): string | null => {
  if (!line.startsWith("n")) {
    return null;
  }
  const candidate = line.slice(1).trim();
  if (!candidate.endsWith(".jsonl")) {
    return null;
  }
  if (!candidate.includes(`${path.sep}.codex${path.sep}sessions${path.sep}`)) {
    return null;
  }
  return normalizeAbsolutePath(candidate);
};

const resolveCodexSessionCandidates = async (pane: SessionDetail): Promise<ScoredCandidate[]> => {
  const panePid = pane.panePid;
  if (!panePid || panePid <= 0) {
    return [];
  }
  const pids = await loadDescendantPids(panePid);
  if (pids.length === 0) {
    return [];
  }
  const files = new Set<string>();
  for (let offset = 0; offset < pids.length; offset += LSOF_PID_BATCH_SIZE) {
    const pidBatch = pids.slice(offset, offset + LSOF_PID_BATCH_SIZE);
    if (pidBatch.length === 0) {
      continue;
    }
    const lsofArgs = ["-Fn", ...pidBatch.flatMap((pid) => ["-p", String(pid)])];
    let opened: Awaited<ReturnType<typeof execa>>;
    try {
      opened = await execa("lsof", lsofArgs, {
        reject: false,
        timeout: 3000,
        maxBuffer: 4_000_000,
      });
    } catch (error) {
      if (isCommandNotFoundError(error, "lsof")) {
        return [];
      }
      continue;
    }
    const stdout = typeof opened.stdout === "string" ? opened.stdout : "";
    if (!stdout.trim()) {
      continue;
    }
    stdout
      .split(/\r?\n/)
      .map((line) => parseCodexSessionFilePath(line))
      .filter((filePath): filePath is string => Boolean(filePath))
      .forEach((filePath) => files.add(filePath));
  }
  if (files.size === 0) {
    return [];
  }

  const normalizedCwd = normalizeAbsolutePath(pane.currentPath);
  const candidatesById = new Map<string, ScoredCandidate>();
  for (const filePath of files) {
    const firstLine = await readFirstJsonLine(filePath);
    const type = firstLine?.type;
    const payload = firstLine?.payload;
    const payloadRecord =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    if (type !== "session_meta" || !payloadRecord) {
      continue;
    }
    const sessionId = readString(payloadRecord.id).trim();
    if (!sessionId) {
      continue;
    }
    let score = 5;
    const metaCwd = normalizeAbsolutePath(readString(payloadRecord.cwd));
    if (metaCwd && normalizedCwd && metaCwd === normalizedCwd) {
      score += 100;
    }
    try {
      const stat = await fs.stat(filePath);
      score += scoreByEventTime(stat.mtimeMs, pane.lastEventAt ?? null);
    } catch {
      // ignore mtime scoring errors
    }
    const nextCandidate: ScoredCandidate = {
      sessionId,
      score,
      confidence: resolveConfidenceFromScore(score),
    };
    const prev = candidatesById.get(sessionId);
    if (!prev || nextCandidate.score > prev.score) {
      candidatesById.set(sessionId, nextCandidate);
    }
  }
  return Array.from(candidatesById.values());
};

const resolveCodexSessionFromLsof = async (pane: SessionDetail): Promise<ResumeResolvedSession> => {
  const candidates = await resolveCodexSessionCandidates(pane);
  const resolved = chooseBestCandidate(candidates);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, agent: "codex" };
  }
  return {
    ok: true,
    sessionId: resolved.candidate.sessionId,
    source: "lsof",
    confidence: resolved.candidate.confidence,
    agent: "codex",
  };
};

export const resolveSessionByPane = async ({
  pane,
  requestAgent,
}: {
  pane: SessionDetail;
  requestAgent: "codex" | "claude";
}): Promise<ResumeResolvedSession> => {
  if (pane.agent !== "codex" && pane.agent !== "claude") {
    return { ok: false, reason: "unsupported", agent: "unknown" };
  }
  if (pane.agent !== requestAgent) {
    return { ok: false, reason: "invalid_input", agent: pane.agent };
  }

  if (pane.agent === "claude") {
    const hookSessionId = pane.agentSessionId?.trim();
    if (hookSessionId) {
      return {
        ok: true,
        sessionId: hookSessionId,
        source: "hook",
        confidence: "high",
        agent: "claude",
      };
    }
    return resolveClaudeSessionFromHistory(pane);
  }

  return resolveCodexSessionFromLsof(pane);
};
