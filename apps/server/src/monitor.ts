import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type AgentMonitorConfig,
  type SessionStateTimelineRange,
  type SessionStateTimelineSource,
} from "@vde-monitor/shared";

import { createJsonlTailer, createLogActivityPoller, ensureDir } from "./logs.js";
import { handleHookLine, type HookEventContext } from "./monitor/hook-tailer.js";
import { createMonitorLoop } from "./monitor/loop.js";
import { createPaneLogManager } from "./monitor/pane-log-manager.js";
import { ensurePipeTagValue } from "./monitor/pane-prep.js";
import { processPane } from "./monitor/pane-processor.js";
import { createPaneStateStore } from "./monitor/pane-state.js";
import { cleanupRegistry } from "./monitor/registry-cleanup.js";
import { resolveRepoRootCached } from "./monitor/repo-root.js";
import type { MultiplexerRuntime } from "./multiplexer/types.js";
import { createSessionRegistry } from "./session-registry.js";
import { restoreSessions, restoreTimeline, saveState } from "./state-store.js";
import { createSessionTimelineStore } from "./state-timeline/store.js";

const baseDir = path.join(os.homedir(), ".vde-monitor");
const PANE_PROCESS_CONCURRENCY = 8;

export const mapWithConcurrencyLimit = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit)));
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await mapper(items[currentIndex] as T, currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

const resolveTimelineSource = (reason: string): SessionStateTimelineSource => {
  if (reason === "restored") {
    return "restore";
  }
  if (reason.startsWith("hook:")) {
    return "hook";
  }
  return "poll";
};

export const createSessionMonitor = (runtime: MultiplexerRuntime, config: AgentMonitorConfig) => {
  const inspector = runtime.inspector;
  const screenCapture = runtime.screenCapture;
  const registry = createSessionRegistry();
  const stateTimeline = createSessionTimelineStore();
  const capturePaneFingerprint = runtime.captureFingerprint;
  const paneStates = createPaneStateStore();
  const customTitles = new Map<string, string>();
  const restored = restoreSessions();
  const restoredTimeline = restoreTimeline();
  const restoredReason = new Set<string>();
  const serverKey = runtime.serverKey;
  const eventsDir = path.join(baseDir, "events", serverKey);
  const eventLogPath = path.join(eventsDir, "claude.jsonl");
  const logActivity = createLogActivityPoller(config.activity.pollIntervalMs);
  const paneLogManager = createPaneLogManager({
    baseDir,
    serverKey,
    config,
    pipeSupport: runtime.pipeSupport,
    pipeManager: runtime.pipeManager,
    logActivity,
  });
  const jsonlTailer = createJsonlTailer(config.activity.pollIntervalMs);
  stateTimeline.restore(restoredTimeline);

  const savePersistedState = () => {
    saveState(registry.values(), { timeline: stateTimeline.serialize() });
  };

  restored.forEach((session, paneId) => {
    const state = paneStates.get(paneId);
    state.lastOutputAt = session.lastOutputAt ?? null;
    state.lastEventAt = session.lastEventAt ?? null;
    state.lastMessage = session.lastMessage ?? null;
    state.lastInputAt = session.lastInputAt ?? null;
    if (session.customTitle) {
      customTitles.set(paneId, session.customTitle);
    }
    if (!restoredTimeline.has(paneId)) {
      stateTimeline.record({
        paneId,
        state: session.state,
        reason: session.stateReason || "restored",
        at: session.lastEventAt ?? session.lastOutputAt ?? session.lastInputAt ?? undefined,
        source: "restore",
      });
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

    const paneResults = await mapWithConcurrencyLimit(
      panes,
      PANE_PROCESS_CONCURRENCY,
      async (pane) => {
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
        return { preparedPane, detail };
      },
    );

    for (const { preparedPane, detail } of paneResults) {
      if (!detail) {
        continue;
      }

      const existing = registry.getDetail(preparedPane.paneId);
      activePaneIds.add(preparedPane.paneId);
      if (
        !existing ||
        existing.state !== detail.state ||
        existing.stateReason !== detail.stateReason
      ) {
        stateTimeline.record({
          paneId: detail.paneId,
          state: detail.state,
          reason: detail.stateReason,
          at: detail.lastEventAt ?? detail.lastOutputAt ?? detail.lastInputAt ?? undefined,
          source: resolveTimelineSource(detail.stateReason),
        });
      }
      registry.update(detail);
    }

    const removedPaneIds = cleanupRegistry({
      registry,
      paneStates,
      customTitles,
      activePaneIds,
      saveState: () => undefined,
    });
    removedPaneIds.forEach((paneId) => {
      stateTimeline.closePane({ paneId });
    });
    savePersistedState();
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
    savePersistedState();
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
    savePersistedState();
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
  const getStateTimeline = (
    paneId: string,
    range: SessionStateTimelineRange = "1h",
    limit = 200,
  ) => {
    return stateTimeline.getTimeline({ paneId, range, limit });
  };

  return {
    registry,
    start,
    stop,
    handleHookEvent,
    getScreenCapture,
    getStateTimeline,
    setCustomTitle,
    recordInput,
  };
};
