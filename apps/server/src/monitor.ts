import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { estimateState } from "@tmux-agent-monitor/agents";
import {
  type AgentMonitorConfig,
  claudeHookEventSchema,
  type HookStateSignal,
  resolveLogPaths,
  resolveServerKey,
  type SessionDetail,
  type SessionStateValue,
} from "@tmux-agent-monitor/shared";
import {
  createInspector,
  createPipeManager,
  createScreenCapture,
  type TmuxAdapter,
} from "@tmux-agent-monitor/tmux";

import { resolveActivityTimestamp } from "./activity-resolver.js";
import {
  createJsonlTailer,
  createLogActivityPoller,
  ensureDir,
  rotateLogIfNeeded,
} from "./logs.js";
import { createSessionRegistry } from "./session-registry.js";
import { restoreSessions, saveState } from "./state-store.js";

type HookEventContext = {
  paneId: string;
  hookState: HookStateSignal;
};

const baseDir = path.join(os.homedir(), ".tmux-agent-monitor");

const execFileAsync = promisify(execFile);

const buildAgent = (hint: string): "codex" | "claude" | "unknown" => {
  const normalized = hint.toLowerCase();
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  return "unknown";
};

const mergeHints = (...parts: Array<string | null | undefined>) =>
  parts.filter((part) => Boolean(part && part.trim().length > 0)).join(" ");

const editorCommandNames = new Set(["vim", "nvim", "vi", "gvim", "nvim-qt", "neovim"]);
const agentHintPattern = /codex|claude/i;

const isEditorCommand = (command: string | null | undefined) => {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const binary = trimmed.split(/\s+/)[0] ?? "";
  if (!binary) return false;
  return editorCommandNames.has(path.basename(binary));
};

const editorCommandHasAgentArg = (command: string | null | undefined) => {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  const binary = tokens.shift() ?? "";
  if (!editorCommandNames.has(path.basename(binary))) {
    return false;
  }
  const rest = tokens.join(" ");
  return rest.length > 0 && agentHintPattern.test(rest);
};

const hasAgentHint = (value: string | null | undefined) =>
  Boolean(value && agentHintPattern.test(value));

const processCacheTtlMs = 5000;
const processCommandCache = new Map<number, { command: string; at: number }>();
const ttyAgentCache = new Map<string, { agent: "codex" | "claude" | "unknown"; at: number }>();
const repoRootCacheTtlMs = 10000;
const repoRootCache = new Map<string, { repoRoot: string | null; at: number }>();
const processSnapshotCache = {
  at: 0,
  byPid: new Map<number, { pid: number; ppid: number; command: string }>(),
  children: new Map<number, number[]>(),
};

const normalizeTty = (tty: string) => tty.replace(/^\/dev\//, "");

const normalizeFingerprint = (text: string) =>
  text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trimEnd();

const normalizeTitle = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildDefaultTitle = (currentPath: string | null, paneId: string, sessionName: string) => {
  if (!currentPath) {
    return `${sessionName}:${paneId}`;
  }
  const normalized = currentPath.replace(/\/+$/, "");
  const parts = normalized.split("/");
  const name = parts.pop() || "unknown";
  return `${name}:${paneId}`;
};

const hostCandidates = (() => {
  const host = os.hostname();
  const short = host.split(".")[0] ?? host;
  return new Set([host, short, `${host}.local`, `${short}.local`]);
})();

const runGit = async (cwd: string, args: string[]) => {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 2_000_000,
    });
    return result.stdout ?? "";
  } catch {
    return "";
  }
};

const resolveRepoRoot = async (cwd: string | null) => {
  if (!cwd) return null;
  const output = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveRepoRootCached = async (cwd: string | null) => {
  if (!cwd) return null;
  const normalized = cwd.replace(/\/+$/, "");
  if (!normalized) return null;
  const nowMs = Date.now();
  const cached = repoRootCache.get(normalized);
  if (cached && nowMs - cached.at < repoRootCacheTtlMs) {
    return cached.repoRoot;
  }
  const repoRoot = await resolveRepoRoot(normalized);
  repoRootCache.set(normalized, { repoRoot, at: nowMs });
  return repoRoot;
};

const getProcessCommand = async (pid: number | null) => {
  if (!pid) {
    return null;
  }
  const cached = processCommandCache.get(pid);
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < processCacheTtlMs) {
    return cached.command;
  }
  try {
    const result = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 1000,
    });
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
    const result = await execFileAsync("ps", ["-ax", "-o", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: 2000,
    });
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

const findAgentFromPidTree = async (pid: number | null) => {
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

const getAgentFromTty = async (tty: string | null) => {
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
    const result = await execFileAsync("ps", ["-o", "command=", "-t", normalized], {
      encoding: "utf8",
      timeout: 1000,
    });
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

const deriveHookState = (hookEventName: string, notificationType?: string) => {
  if (hookEventName === "Notification" && notificationType === "permission_prompt") {
    return { state: "WAITING_PERMISSION" as SessionStateValue, reason: "hook:permission_prompt" };
  }
  if (hookEventName === "Stop") {
    return { state: "WAITING_INPUT" as SessionStateValue, reason: "hook:stop" };
  }
  if (
    hookEventName === "UserPromptSubmit" ||
    hookEventName === "PreToolUse" ||
    hookEventName === "PostToolUse"
  ) {
    return { state: "RUNNING" as SessionStateValue, reason: `hook:${hookEventName}` };
  }
  return null;
};

const mapHookToPane = (
  panes: Array<{ paneId: string; paneTty: string | null; currentPath: string | null }>,
  hook: { tmux_pane?: string | null; tty?: string; cwd?: string },
) => {
  if (hook.tmux_pane) {
    return hook.tmux_pane;
  }
  if (hook.tty) {
    const matches = panes.filter((pane) => pane.paneTty === hook.tty);
    if (matches.length === 1) {
      return matches[0]?.paneId ?? null;
    }
    return null;
  }
  if (hook.cwd) {
    const matches = panes.filter((pane) => pane.currentPath === hook.cwd);
    if (matches.length === 1) {
      return matches[0]?.paneId ?? null;
    }
  }
  return null;
};

export const createSessionMonitor = (adapter: TmuxAdapter, config: AgentMonitorConfig) => {
  const inspector = createInspector(adapter);
  const pipeManager = createPipeManager(adapter);
  const screenCapture = createScreenCapture(adapter);
  const registry = createSessionRegistry();
  const hookStates = new Map<string, HookStateSignal>();
  const lastOutputAt = new Map<string, string>();
  const lastEventAt = new Map<string, string>();
  const lastMessage = new Map<string, string | null>();
  const lastInputAt = new Map<string, string>();
  const lastFingerprint = new Map<string, string>();
  const customTitles = new Map<string, string>();
  const restored = restoreSessions();
  const restoredReason = new Set<string>();
  const serverKey = resolveServerKey(config.tmux.socketName, config.tmux.socketPath);
  const eventsDir = path.join(baseDir, "events", serverKey);
  const eventLogPath = path.join(eventsDir, "claude.jsonl");
  const logActivity = createLogActivityPoller(config.activity.pollIntervalMs);
  const jsonlTailer = createJsonlTailer(config.activity.pollIntervalMs);
  let timer: NodeJS.Timeout | null = null;

  restored.forEach((session, paneId) => {
    lastOutputAt.set(paneId, session.lastOutputAt ?? null);
    lastEventAt.set(paneId, session.lastEventAt ?? null);
    lastMessage.set(paneId, session.lastMessage ?? null);
    if (session.lastInputAt) {
      lastInputAt.set(paneId, session.lastInputAt);
    }
    if (session.customTitle) {
      customTitles.set(paneId, session.customTitle);
    }
  });

  const getPaneLogPath = (paneId: string) => {
    return resolveLogPaths(baseDir, serverKey, paneId).paneLogPath;
  };

  const ensureLogFiles = async (paneId: string) => {
    const { panesDir, paneLogPath } = resolveLogPaths(baseDir, serverKey, paneId);
    await ensureDir(panesDir);
    await fs.open(paneLogPath, "a").then((handle) => handle.close());
  };

  const applyRestored = (paneId: string) => {
    if (restored.has(paneId) && !restoredReason.has(paneId)) {
      restoredReason.add(paneId);
      return restored.get(paneId) ?? null;
    }
    return null;
  };

  const capturePaneFingerprint = async (paneId: string, useAlt: boolean) => {
    const args = ["capture-pane", "-p", "-t", paneId, "-S", "-20", "-E", "-1"];
    if (useAlt) {
      args.push("-a");
    }
    const result = await adapter.run(args);
    if (result.exitCode !== 0) {
      return null;
    }
    return normalizeFingerprint(result.stdout ?? "");
  };

  const updateFromPanes = async () => {
    const panes = await inspector.listPanes();
    const activePaneIds = new Set<string>();

    for (const pane of panes) {
      if (pane.pipeTagValue === null) {
        const fallback = await inspector.readUserOption(pane.paneId, "@tmux-agent-monitor_pipe");
        pane.pipeTagValue = fallback;
      }

      const baseHint = mergeHints(pane.currentCommand, pane.paneStartCommand, pane.paneTitle);
      const isEditorPane =
        isEditorCommand(pane.currentCommand) || isEditorCommand(pane.paneStartCommand);
      let processCommand: string | null = null;
      let ignoreEditor = false;
      if (isEditorPane) {
        if (editorCommandHasAgentArg(pane.paneStartCommand) || hasAgentHint(pane.paneTitle)) {
          ignoreEditor = true;
        } else {
          processCommand = await getProcessCommand(pane.panePid);
          if (editorCommandHasAgentArg(processCommand)) {
            ignoreEditor = true;
          }
        }
      }
      if (ignoreEditor) {
        continue;
      }

      let agent = buildAgent(baseHint);
      if (agent === "unknown") {
        if (!processCommand) {
          processCommand = await getProcessCommand(pane.panePid);
        }
        if (processCommand) {
          agent = buildAgent(processCommand);
        }
      }
      if (agent === "unknown") {
        agent = await findAgentFromPidTree(pane.panePid);
      }
      if (agent === "unknown") {
        agent = await getAgentFromTty(pane.paneTty);
      }
      const monitored = agent !== "unknown";

      if (!monitored) {
        continue;
      }

      activePaneIds.add(pane.paneId);
      const pipeState = { panePipe: pane.panePipe, pipeTagValue: pane.pipeTagValue };

      let pipeAttached = pane.pipeTagValue === "1";
      let pipeConflict = pipeManager.hasConflict(pipeState);

      if (config.attachOnServe && monitored && !pipeConflict) {
        await ensureLogFiles(pane.paneId);
        const attachResult = await pipeManager.attachPipe(
          pane.paneId,
          getPaneLogPath(pane.paneId),
          pipeState,
        );
        pipeAttached = pipeAttached || attachResult.attached;
        pipeConflict = attachResult.conflict;
      }

      if (config.attachOnServe && monitored) {
        logActivity.register(pane.paneId, getPaneLogPath(pane.paneId));
      }

      await rotateLogIfNeeded(
        getPaneLogPath(pane.paneId),
        config.logs.maxPaneLogBytes,
        config.logs.retainRotations,
      );

      const hookState = hookStates.get(pane.paneId) ?? null;
      let outputAt = lastOutputAt.get(pane.paneId) ?? null;
      const updateOutputAt = (next: string | null) => {
        if (!next) {
          return;
        }
        const nextTs = Date.parse(next);
        if (Number.isNaN(nextTs)) {
          return;
        }
        const prevTs = outputAt ? Date.parse(outputAt) : null;
        if (!prevTs || Number.isNaN(prevTs) || nextTs > prevTs) {
          outputAt = new Date(nextTs).toISOString();
          lastOutputAt.set(pane.paneId, outputAt);
        }
      };

      const logPath = getPaneLogPath(pane.paneId);
      const stat = await fs.stat(logPath).catch(() => null);
      if (stat && stat.size > 0) {
        updateOutputAt(stat.mtime.toISOString());
      }

      const activityAt = resolveActivityTimestamp({
        paneId: pane.paneId,
        paneActivity: pane.paneActivity,
        windowActivity: pane.windowActivity,
        paneActive: pane.paneActive,
      });
      if (activityAt) {
        updateOutputAt(activityAt);
      }

      if (!pane.paneDead) {
        const fingerprint = await capturePaneFingerprint(pane.paneId, pane.alternateOn);
        if (fingerprint) {
          const previous = lastFingerprint.get(pane.paneId);
          if (previous !== fingerprint) {
            lastFingerprint.set(pane.paneId, fingerprint);
            updateOutputAt(new Date().toISOString());
          }
        }
      }

      if (!outputAt) {
        const fallbackTs = new Date(
          Date.now() - config.activity.inactiveThresholdMs - 1000,
        ).toISOString();
        updateOutputAt(fallbackTs);
      }
      const eventAt = lastEventAt.get(pane.paneId) ?? null;
      const message = lastMessage.get(pane.paneId) ?? null;
      const restoredSession = applyRestored(pane.paneId);

      const estimated = estimateState({
        paneDead: pane.paneDead,
        lastOutputAt: outputAt,
        hookState,
        thresholds: {
          runningThresholdMs:
            agent === "codex"
              ? Math.min(config.activity.runningThresholdMs, 10000)
              : config.activity.runningThresholdMs,
          inactiveThresholdMs: config.activity.inactiveThresholdMs,
        },
      });

      const finalState = restoredSession ? restoredSession.state : estimated.state;
      const finalReason = restoredSession ? "restored" : estimated.reason;

      const paneTitle = normalizeTitle(pane.paneTitle);
      const defaultTitle = buildDefaultTitle(pane.currentPath, pane.paneId, pane.sessionName);
      const title = paneTitle && !hostCandidates.has(paneTitle) ? paneTitle : defaultTitle;
      const customTitle = customTitles.get(pane.paneId) ?? null;
      const repoRoot = await resolveRepoRootCached(pane.currentPath);
      const inputAt = lastInputAt.get(pane.paneId) ?? null;

      const detail: SessionDetail = {
        paneId: pane.paneId,
        sessionName: pane.sessionName,
        windowIndex: pane.windowIndex,
        paneIndex: pane.paneIndex,
        windowActivity: pane.windowActivity,
        paneActive: pane.paneActive,
        currentCommand: pane.currentCommand,
        currentPath: pane.currentPath,
        paneTty: pane.paneTty,
        title,
        customTitle,
        repoRoot,
        agent,
        state: finalState,
        stateReason: finalReason,
        lastMessage: message,
        lastOutputAt: outputAt,
        lastEventAt: eventAt,
        lastInputAt: inputAt,
        paneDead: pane.paneDead,
        alternateOn: pane.alternateOn,
        pipeAttached,
        pipeConflict,
        startCommand: pane.paneStartCommand,
        panePid: pane.panePid,
      };

      registry.update(detail);
    }

    const removed = registry.removeMissing(activePaneIds);
    removed.forEach((paneId) => {
      customTitles.delete(paneId);
    });
    lastOutputAt.forEach((_, paneId) => {
      if (!activePaneIds.has(paneId)) {
        lastOutputAt.delete(paneId);
        lastEventAt.delete(paneId);
        lastMessage.delete(paneId);
        lastInputAt.delete(paneId);
        lastFingerprint.delete(paneId);
        hookStates.delete(paneId);
      }
    });
    saveState(registry.values());
  };

  const setCustomTitle = (paneId: string, title: string | null) => {
    if (title) {
      customTitles.set(paneId, title);
    } else {
      customTitles.delete(paneId);
    }
    const existing = registry.getDetail(paneId);
    if (!existing || existing.customTitle === (title ?? null)) {
      return;
    }
    const next = { ...existing, customTitle: title };
    registry.update(next);
    saveState(registry.values());
  };

  const handleHookEvent = (context: HookEventContext) => {
    hookStates.set(context.paneId, context.hookState);
    lastEventAt.set(context.paneId, context.hookState.at);
  };

  const recordInput = (paneId: string, at = new Date().toISOString()) => {
    lastInputAt.set(paneId, at);
    const existing = registry.getDetail(paneId);
    if (!existing) {
      return;
    }
    if (existing.lastInputAt === at) {
      return;
    }
    const next = { ...existing, lastInputAt: at };
    registry.update(next);
    saveState(registry.values());
  };

  const startHookTailer = async () => {
    await ensureDir(eventsDir);
    await fs.open(eventLogPath, "a").then((handle) => handle.close());
    jsonlTailer.onLine((line) => {
      const parsed = claudeHookEventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        return;
      }
      const event = parsed.data;
      const hookState = deriveHookState(event.hook_event_name, event.notification_type);
      if (!hookState) {
        return;
      }
      const paneId = mapHookToPane(registry.values(), {
        tmux_pane: event.tmux_pane ?? null,
        tty: event.tty,
        cwd: event.cwd,
      });
      if (!paneId) {
        return;
      }
      handleHookEvent({
        paneId,
        hookState: { ...hookState, at: event.ts },
      });
    });
    jsonlTailer.start(eventLogPath);
  };

  const start = async () => {
    logActivity.onActivity((paneId, at) => {
      lastOutputAt.set(paneId, at);
    });
    logActivity.start();
    await startHookTailer();

    timer = setInterval(() => {
      updateFromPanes().catch(() => null);
      rotateLogIfNeeded(
        eventLogPath,
        config.logs.maxEventLogBytes,
        config.logs.retainRotations,
      ).catch(() => null);
    }, config.activity.pollIntervalMs);

    await updateFromPanes();
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    logActivity.stop();
    jsonlTailer.stop();
  };

  const getScreenCapture = () => screenCapture;

  return {
    registry,
    start,
    stop,
    handleHookEvent,
    getScreenCapture,
    setCustomTitle,
    recordInput,
  };
};
