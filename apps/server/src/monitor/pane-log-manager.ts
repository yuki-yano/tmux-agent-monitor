import fs from "node:fs/promises";

import type { AgentMonitorConfig } from "@vde-monitor/shared";
import { resolveLogPaths } from "@vde-monitor/shared";

import { ensureDir, rotateLogIfNeeded } from "../logs.js";

export type PaneLogManager = ReturnType<typeof createPaneLogManager>;

type PaneLogManagerDeps = {
  resolveLogPaths?: typeof resolveLogPaths;
  ensureDir?: typeof ensureDir;
  rotateLogIfNeeded?: typeof rotateLogIfNeeded;
  openLogFile?: (filePath: string) => Promise<void>;
};

type PaneLogManagerArgs = {
  baseDir: string;
  serverKey: string;
  config: AgentMonitorConfig;
  pipeManager: {
    hasConflict: (state: { panePipe: boolean; pipeTagValue: string | null }) => boolean;
    attachPipe: (
      paneId: string,
      logPath: string,
      state: { panePipe: boolean; pipeTagValue: string | null },
    ) => Promise<{ attached: boolean; conflict: boolean }>;
  };
  logActivity: { register: (paneId: string, filePath: string) => void };
  deps?: PaneLogManagerDeps;
};

type PreparePaneLoggingArgs = {
  paneId: string;
  panePipe: boolean;
  pipeTagValue: string | null;
};

export const createPaneLogManager = ({
  baseDir,
  serverKey,
  config,
  pipeManager,
  logActivity,
  deps,
}: PaneLogManagerArgs) => {
  const resolvePaths = deps?.resolveLogPaths ?? resolveLogPaths;
  const ensureDirFn = deps?.ensureDir ?? ensureDir;
  const rotateFn = deps?.rotateLogIfNeeded ?? rotateLogIfNeeded;
  const openLogFile =
    deps?.openLogFile ??
    (async (filePath: string) => {
      await fs.open(filePath, "a").then((handle) => handle.close());
    });

  const getPaneLogPath = (paneId: string) => {
    return resolvePaths(baseDir, serverKey, paneId).paneLogPath;
  };

  const ensureLogFiles = async (paneId: string) => {
    const { panesDir, paneLogPath } = resolvePaths(baseDir, serverKey, paneId);
    await ensureDirFn(panesDir);
    await openLogFile(paneLogPath);
  };

  const preparePaneLogging = async ({ paneId, panePipe, pipeTagValue }: PreparePaneLoggingArgs) => {
    const logPath = getPaneLogPath(paneId);
    const pipeState = { panePipe, pipeTagValue };

    let pipeAttached = pipeTagValue === "1";
    let pipeConflict = pipeManager.hasConflict(pipeState);

    if (config.attachOnServe && !pipeConflict) {
      await ensureLogFiles(paneId);
      const attachResult = await pipeManager.attachPipe(paneId, logPath, pipeState);
      pipeAttached = pipeAttached || attachResult.attached;
      pipeConflict = attachResult.conflict;
    }

    if (config.attachOnServe) {
      logActivity.register(paneId, logPath);
    }

    await rotateFn(logPath, config.logs.maxPaneLogBytes, config.logs.retainRotations);

    return { pipeAttached, pipeConflict, logPath };
  };

  return { getPaneLogPath, ensureLogFiles, preparePaneLogging };
};
