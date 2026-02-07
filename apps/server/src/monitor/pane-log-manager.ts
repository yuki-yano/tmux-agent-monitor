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
  pipeSupport: "tmux-pipe" | "none";
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

const defaultOpenLogFile = async (filePath: string) => {
  await fs.open(filePath, "a").then((handle) => handle.close());
};

const resolvePaneLogDeps = (deps?: PaneLogManagerDeps) => {
  const resolved = {
    resolvePaths: resolveLogPaths,
    ensureDirFn: ensureDir,
    rotateFn: rotateLogIfNeeded,
    openLogFile: defaultOpenLogFile,
  };
  if (!deps) {
    return resolved;
  }
  if (deps.resolveLogPaths) {
    resolved.resolvePaths = deps.resolveLogPaths;
  }
  if (deps.ensureDir) {
    resolved.ensureDirFn = deps.ensureDir;
  }
  if (deps.rotateLogIfNeeded) {
    resolved.rotateFn = deps.rotateLogIfNeeded;
  }
  if (deps.openLogFile) {
    resolved.openLogFile = deps.openLogFile;
  }
  return resolved;
};

export const createPaneLogManager = ({
  baseDir,
  serverKey,
  config,
  pipeSupport,
  pipeManager,
  logActivity,
  deps,
}: PaneLogManagerArgs) => {
  const { resolvePaths, ensureDirFn, rotateFn, openLogFile } = resolvePaneLogDeps(deps);

  const getPaneLogPath = (paneId: string) => {
    return resolvePaths(baseDir, serverKey, paneId).paneLogPath;
  };

  const ensureLogFiles = async (paneId: string) => {
    const { panesDir, paneLogPath } = resolvePaths(baseDir, serverKey, paneId);
    await ensureDirFn(panesDir);
    await openLogFile(paneLogPath);
  };

  const attachPipeIfNeeded = async ({
    paneId,
    logPath,
    pipeState,
    pipeAttached,
    pipeConflict,
  }: {
    paneId: string;
    logPath: string;
    pipeState: { panePipe: boolean; pipeTagValue: string | null };
    pipeAttached: boolean;
    pipeConflict: boolean;
  }) => {
    if (!config.attachOnServe || pipeConflict) {
      return { pipeAttached, pipeConflict };
    }
    await ensureLogFiles(paneId);
    const attachResult = await pipeManager.attachPipe(paneId, logPath, pipeState);
    return {
      pipeAttached: pipeAttached || attachResult.attached,
      pipeConflict: attachResult.conflict,
    };
  };

  const preparePaneLogging = async ({ paneId, panePipe, pipeTagValue }: PreparePaneLoggingArgs) => {
    if (pipeSupport === "none") {
      return { pipeAttached: false, pipeConflict: false, logPath: null };
    }

    const logPath = getPaneLogPath(paneId);
    const pipeState = { panePipe, pipeTagValue };

    let pipeAttached = pipeTagValue === "1";
    let pipeConflict = pipeManager.hasConflict(pipeState);

    const attachResult = await attachPipeIfNeeded({
      paneId,
      logPath,
      pipeState,
      pipeAttached,
      pipeConflict,
    });
    pipeAttached = attachResult.pipeAttached;
    pipeConflict = attachResult.pipeConflict;

    if (config.attachOnServe) {
      logActivity.register(paneId, logPath);
    }

    await rotateFn(logPath, config.logs.maxPaneLogBytes, config.logs.retainRotations);

    return { pipeAttached, pipeConflict, logPath };
  };

  return { pipeSupport, getPaneLogPath, ensureLogFiles, preparePaneLogging };
};
