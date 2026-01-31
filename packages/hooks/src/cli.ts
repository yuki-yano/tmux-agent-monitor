#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveServerKey } from "@tmux-agent-monitor/shared";

const readStdin = (): string => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const encodeClaudeCwd = (cwd: string): string => {
  return cwd.replace(/[/.]/g, "-");
};

const resolveTranscriptPath = (
  cwd: string | undefined,
  sessionId: string | undefined,
): string | null => {
  if (!cwd || !sessionId) {
    return null;
  }
  const encoded = encodeClaudeCwd(cwd);
  return path.join(os.homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
};

const loadConfig = () => {
  const configPath = path.join(os.homedir(), ".tmux-agent-monitor", "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as { tmux?: { socketName?: string | null; socketPath?: string | null } };
  } catch {
    return null;
  }
};

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
};

const main = () => {
  const hookEventName = process.argv[2];
  if (!hookEventName) {
    console.error("Usage: tmux-agent-monitor-hook <HookEventName>");
    process.exit(1);
  }

  const rawInput = readStdin().trim();
  if (!rawInput) {
    process.exit(0);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawInput) as Record<string, unknown>;
  } catch {
    console.error("Invalid JSON payload");
    process.exit(1);
  }

  const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const tty = typeof payload.tty === "string" ? payload.tty : undefined;
  const tmuxPane =
    typeof payload.tmux_pane === "string" ? payload.tmux_pane : (process.env.TMUX_PANE ?? null);
  const notificationType =
    typeof payload.notification_type === "string" ? payload.notification_type : undefined;
  const transcriptPath =
    typeof payload.transcript_path === "string"
      ? payload.transcript_path
      : resolveTranscriptPath(cwd, sessionId);

  const event = {
    ts: new Date().toISOString(),
    hook_event_name: hookEventName,
    notification_type: notificationType,
    session_id: sessionId ?? "",
    cwd,
    tty,
    tmux_pane: tmuxPane ?? null,
    transcript_path: transcriptPath ?? undefined,
    fallback:
      tmuxPane === null
        ? {
            cwd,
            transcript_path: transcriptPath ?? undefined,
          }
        : undefined,
    payload: {
      raw: rawInput,
    },
  };

  const config = loadConfig();
  const serverKey = resolveServerKey(
    config?.tmux?.socketName ?? null,
    config?.tmux?.socketPath ?? null,
  );
  const baseDir = path.join(os.homedir(), ".tmux-agent-monitor");
  const eventsDir = path.join(baseDir, "events", serverKey);
  const eventsPath = path.join(eventsDir, "claude.jsonl");

  ensureDir(eventsDir);
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
};

main();
