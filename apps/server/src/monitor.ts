import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type AgentMonitorConfig, resolveServerKey } from "@vde-monitor/shared";
import {
  createInspector,
  createPipeManager,
  createScreenCapture,
  type TmuxAdapter,
} from "@vde-monitor/tmux";

import { createJsonlTailer, createLogActivityPoller, ensureDir } from "./logs.js";
import { createFingerprintCapture } from "./monitor/fingerprint.js";
import { handleHookLine, type HookEventContext } from "./monitor/hook-tailer.js";
import { createMonitorLoop } from "./monitor/loop.js";
import { createPaneLogManager } from "./monitor/pane-log-manager.js";
import { ensurePipeTagValue } from "./monitor/pane-prep.js";
import { processPane } from "./monitor/pane-processor.js";
import { createPaneStateStore } from "./monitor/pane-state.js";
import { cleanupRegistry } from "./monitor/registry-cleanup.js";
import { resolveRepoRootCached } from "./monitor/repo-root.js";
import { createSessionRegistry } from "./session-registry.js";
import { restoreSessions, saveState } from "./state-store.js";

const baseDir = path.join(os.homedir(), ".vde-monitor");

export const createSessionMonitor = (adapter: TmuxAdapter, config: AgentMonitorConfig) => {
  const inspector = createInspector(adapter);
  const pipeManager = createPipeManager(adapter);
  const screenCapture = createScreenCapture(adapter);
  const registry = createSessionRegistry();
  const capturePaneFingerprint = createFingerprintCapture(adapter);
  const paneStates = createPaneStateStore();
  const customTitles = new Map<string, string>();
  const restored = restoreSessions();
  const restoredReason = new Set<string>();
  const serverKey = resolveServerKey(config.tmux.socketName, config.tmux.socketPath);
  const eventsDir = path.join(baseDir, "events", serverKey);
  const eventLogPath = path.join(eventsDir, "claude.jsonl");
  const logActivity = createLogActivityPoller(config.activity.pollIntervalMs);
  const paneLogManager = createPaneLogManager({
    baseDir,
    serverKey,
    config,
    pipeManager,
    logActivity,
  });
  const jsonlTailer = createJsonlTailer(config.activity.pollIntervalMs);
  restored.forEach((session, paneId) => {
    const state = paneStates.get(paneId);
    state.lastOutputAt = session.lastOutputAt ?? null;
    state.lastEventAt = session.lastEventAt ?? null;
    state.lastMessage = session.lastMessage ?? null;
    state.lastInputAt = session.lastInputAt ?? null;
    if (session.customTitle) {
      customTitles.set(paneId, session.customTitle);
    }
  });

  const applyRestored = (paneId: string) => {
    if (restored.has(paneId) && !restoredReason.has(paneId)) {
      restoredReason.add(paneId);
      return restored.get(paneId) ?? null;
    }
    return null;
  };

  const updateFromPanes = async () => {
    const panes = await inspector.listPanes();
    const activePaneIds = new Set<string>();

    for (const pane of panes) {
      const preparedPane = await ensurePipeTagValue(pane, {
        readUserOption: inspector.readUserOption,
      });

      const detail = await processPane({
        pane: preparedPane,
        config,
        paneStates,
        paneLogManager,
        capturePaneFingerprint,
        applyRestored,
        getCustomTitle: (paneId) => customTitles.get(paneId) ?? null,
        resolveRepoRoot: resolveRepoRootCached,
      });

      if (!detail) {
        continue;
      }

      activePaneIds.add(preparedPane.paneId);
      registry.update(detail);
    }

    cleanupRegistry({
      registry,
      paneStates,
      customTitles,
      activePaneIds,
      saveState,
    });
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
    const state = paneStates.get(context.paneId);
    state.hookState = context.hookState;
    state.lastEventAt = context.hookState.at;
  };

  const recordInput = (paneId: string, at = new Date().toISOString()) => {
    const state = paneStates.get(paneId);
    state.lastInputAt = at;
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
      handleHookLine(line, registry.values(), handleHookEvent);
    });
    jsonlTailer.start(eventLogPath);
  };

  const monitorLoop = createMonitorLoop({
    intervalMs: config.activity.pollIntervalMs,
    eventLogPath,
    maxEventLogBytes: config.logs.maxEventLogBytes,
    retainRotations: config.logs.retainRotations,
    updateFromPanes,
  });

  const start = async () => {
    logActivity.onActivity((paneId, at) => {
      const state = paneStates.get(paneId);
      state.lastOutputAt = at;
    });
    logActivity.start();
    await startHookTailer();

    monitorLoop.start();

    await updateFromPanes();
  };

  const stop = () => {
    monitorLoop.stop();
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
