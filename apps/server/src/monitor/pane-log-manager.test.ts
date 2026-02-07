import type { AgentMonitorConfig } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { createPaneLogManager } from "./pane-log-manager.js";

describe("pane-log-manager", () => {
  it("attaches pipe when allowed and updates logging", async () => {
    const pipeManager = {
      hasConflict: vi.fn(() => false),
      attachPipe: vi.fn(async () => ({ attached: true, conflict: false })),
    };
    const logActivity = { register: vi.fn() };
    const config = {
      attachOnServe: true,
      logs: { maxPaneLogBytes: 10, retainRotations: 1 },
    } as AgentMonitorConfig;
    const manager = createPaneLogManager({
      baseDir: "/base",
      serverKey: "key",
      config,
      pipeSupport: "tmux-pipe",
      pipeManager,
      logActivity,
      deps: {
        resolveLogPaths: (_base, _key, paneId) => ({
          paneIdEncoded: paneId,
          panesDir: "/logs",
          eventsDir: "/logs",
          paneLogPath: `/logs/${paneId}.log`,
          eventLogPath: "/logs/events.log",
        }),
        ensureDir: vi.fn(async () => {}),
        rotateLogIfNeeded: vi.fn(async () => {}),
        openLogFile: vi.fn(async () => {}),
      },
    });

    const result = await manager.preparePaneLogging({
      paneId: "1",
      panePipe: false,
      pipeTagValue: "0",
    });

    expect(pipeManager.attachPipe).toHaveBeenCalledWith("1", "/logs/1.log", {
      panePipe: false,
      pipeTagValue: "0",
    });
    expect(logActivity.register).toHaveBeenCalledWith("1", "/logs/1.log");
    expect(result.pipeAttached).toBe(true);
    expect(result.pipeConflict).toBe(false);
  });

  it("skips attach when conflict is detected", async () => {
    const pipeManager = {
      hasConflict: vi.fn(() => true),
      attachPipe: vi.fn(async () => ({ attached: false, conflict: true })),
    };
    const logActivity = { register: vi.fn() };
    const config = {
      attachOnServe: true,
      logs: { maxPaneLogBytes: 10, retainRotations: 1 },
    } as AgentMonitorConfig;
    const manager = createPaneLogManager({
      baseDir: "/base",
      serverKey: "key",
      config,
      pipeSupport: "tmux-pipe",
      pipeManager,
      logActivity,
      deps: {
        resolveLogPaths: (_base, _key, paneId) => ({
          paneIdEncoded: paneId,
          panesDir: "/logs",
          eventsDir: "/logs",
          paneLogPath: `/logs/${paneId}.log`,
          eventLogPath: "/logs/events.log",
        }),
        ensureDir: vi.fn(async () => {}),
        rotateLogIfNeeded: vi.fn(async () => {}),
        openLogFile: vi.fn(async () => {}),
      },
    });

    const result = await manager.preparePaneLogging({
      paneId: "2",
      panePipe: true,
      pipeTagValue: null,
    });

    expect(pipeManager.attachPipe).not.toHaveBeenCalled();
    expect(result.pipeConflict).toBe(true);
  });

  it("skips pipe and log registration when pipe support is none", async () => {
    const pipeManager = {
      hasConflict: vi.fn(() => false),
      attachPipe: vi.fn(async () => ({ attached: true, conflict: false })),
    };
    const logActivity = { register: vi.fn() };
    const config = {
      attachOnServe: true,
      logs: { maxPaneLogBytes: 10, retainRotations: 1 },
    } as AgentMonitorConfig;
    const manager = createPaneLogManager({
      baseDir: "/base",
      serverKey: "key",
      config,
      pipeSupport: "none",
      pipeManager,
      logActivity,
      deps: {
        resolveLogPaths: (_base, _key, paneId) => ({
          paneIdEncoded: paneId,
          panesDir: "/logs",
          eventsDir: "/logs",
          paneLogPath: `/logs/${paneId}.log`,
          eventLogPath: "/logs/events.log",
        }),
        ensureDir: vi.fn(async () => {}),
        rotateLogIfNeeded: vi.fn(async () => {}),
        openLogFile: vi.fn(async () => {}),
      },
    });

    const result = await manager.preparePaneLogging({
      paneId: "2",
      panePipe: false,
      pipeTagValue: null,
    });

    expect(pipeManager.attachPipe).not.toHaveBeenCalled();
    expect(logActivity.register).not.toHaveBeenCalled();
    expect(result).toEqual({
      pipeAttached: false,
      pipeConflict: false,
      logPath: null,
    });
  });
});
