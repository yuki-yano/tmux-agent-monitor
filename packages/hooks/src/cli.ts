#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type AgentMonitorConfigFile,
  configSchema,
  resolveConfigDir,
  resolveMonitorServerKey,
} from "@vde-monitor/shared";

type HookPayload = Record<string, unknown>;

type HookPayloadFields = {
  sessionId?: string;
  cwd?: string;
  tty?: string;
  tmuxPane: string | null;
  notificationType?: string;
  transcriptPath?: string | null;
};

export type HookEvent = {
  ts: string;
  hook_event_name: string;
  notification_type?: string;
  session_id: string;
  cwd?: string;
  tty?: string;
  tmux_pane: string | null;
  transcript_path?: string;
  fallback?: { cwd?: string; transcript_path?: string };
  payload: { raw: string };
};

type HookServerConfig = {
  multiplexerBackend: "tmux" | "wezterm";
  tmuxSocketName: string | null;
  tmuxSocketPath: string | null;
  weztermTarget: string | null;
};

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

export const resolveTranscriptPath = (
  cwd: string | undefined,
  sessionId: string | undefined,
): string | null => {
  if (!cwd || !sessionId) {
    return null;
  }
  const encoded = encodeClaudeCwd(cwd);
  return path.join(os.homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
};

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
};

const toOptionalString = (value: unknown) => (typeof value === "string" ? value : undefined);
const toNullableString = (value: unknown) => (typeof value === "string" ? value : null);

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseLegacyHookServerConfig = (value: unknown): HookServerConfig | null => {
  const root = toRecord(value);
  if (!root) {
    return null;
  }
  const tmux = toRecord(root.tmux);
  const multiplexer = toRecord(root.multiplexer);
  const wezterm = toRecord(multiplexer?.wezterm);
  return {
    multiplexerBackend: multiplexer?.backend === "wezterm" ? "wezterm" : "tmux",
    tmuxSocketName: toNullableString(tmux?.socketName),
    tmuxSocketPath: toNullableString(tmux?.socketPath),
    weztermTarget: toNullableString(wezterm?.target),
  };
};

const parseHookServerConfig = (value: unknown): HookServerConfig | null => {
  const parsed = configSchema.safeParse(value);
  if (parsed.success) {
    const config: AgentMonitorConfigFile = parsed.data;
    return {
      multiplexerBackend: config.multiplexer.backend,
      tmuxSocketName: config.tmux.socketName,
      tmuxSocketPath: config.tmux.socketPath,
      weztermTarget: config.multiplexer.wezterm.target,
    };
  }
  return parseLegacyHookServerConfig(value);
};

const loadConfig = (): HookServerConfig | null => {
  const configPath = path.join(resolveConfigDir(), "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return parseHookServerConfig(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const resolveHookServerKey = (config: HookServerConfig | null): string => {
  if (!config) {
    return resolveMonitorServerKey({
      multiplexerBackend: "tmux",
      tmuxSocketName: null,
      tmuxSocketPath: null,
      weztermTarget: null,
    });
  }
  return resolveMonitorServerKey({
    multiplexerBackend: config.multiplexerBackend,
    tmuxSocketName: config.tmuxSocketName,
    tmuxSocketPath: config.tmuxSocketPath,
    weztermTarget: config.weztermTarget,
  });
};

const parsePayload = (rawInput: string): HookPayload | null => {
  try {
    return JSON.parse(rawInput) as HookPayload;
  } catch {
    return null;
  }
};

export const extractPayloadFields = (
  payload: HookPayload,
  env: NodeJS.ProcessEnv = process.env,
): HookPayloadFields => {
  const sessionId = toOptionalString(payload.session_id);
  const cwd = toOptionalString(payload.cwd);
  const transcriptPath =
    toOptionalString(payload.transcript_path) ?? resolveTranscriptPath(cwd, sessionId);
  return {
    sessionId,
    cwd,
    tty: toOptionalString(payload.tty),
    tmuxPane: toOptionalString(payload.tmux_pane) ?? env.TMUX_PANE ?? null,
    notificationType: toOptionalString(payload.notification_type),
    transcriptPath,
  };
};

const buildFallback = (fields: HookPayloadFields): HookEvent["fallback"] => {
  if (fields.tmuxPane != null) {
    return undefined;
  }
  return {
    cwd: fields.cwd,
    transcript_path: fields.transcriptPath ?? undefined,
  };
};

export const buildHookEvent = (
  hookEventName: string,
  rawInput: string,
  fields: HookPayloadFields,
): HookEvent => ({
  ts: new Date().toISOString(),
  hook_event_name: hookEventName,
  notification_type: fields.notificationType,
  session_id: fields.sessionId ?? "",
  cwd: fields.cwd,
  tty: fields.tty,
  tmux_pane: fields.tmuxPane,
  transcript_path: fields.transcriptPath ?? undefined,
  fallback: buildFallback(fields),
  payload: {
    raw: rawInput,
  },
});

const appendEvent = (event: HookEvent) => {
  const config = loadConfig();
  const serverKey = resolveHookServerKey(config);
  const baseDir = path.join(os.homedir(), ".vde-monitor");
  const eventsDir = path.join(baseDir, "events", serverKey);
  const eventsPath = path.join(eventsDir, "claude.jsonl");
  ensureDir(eventsDir);
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
};

const isMainModule = () => {
  const mainPath = process.argv[1];
  if (!mainPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(mainPath).href;
};

const main = () => {
  const hookEventName = process.argv[2];
  if (!hookEventName) {
    console.error("Usage: vde-monitor-hook <HookEventName>");
    process.exit(1);
  }

  const rawInput = readStdin().trim();
  if (!rawInput) {
    process.exit(0);
  }

  const payload = parsePayload(rawInput);
  if (!payload) {
    console.error("Invalid JSON payload");
    process.exit(1);
  }

  const fields = extractPayloadFields(payload);
  const event = buildHookEvent(hookEventName, rawInput, fields);
  appendEvent(event);
};

if (isMainModule()) {
  main();
}
