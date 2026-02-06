import type { AgentMonitorConfig, PaneMeta, SessionDetail } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { PaneLogManager } from "./pane-log-manager.js";
import { processPane } from "./pane-processor.js";
import type { PaneRuntimeState } from "./pane-state.js";

const createPaneState = (overrides: Partial<PaneRuntimeState> = {}): PaneRuntimeState => ({
  hookState: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastMessage: null,
  lastInputAt: null,
  lastFingerprint: null,
  ...overrides,
});

const createPaneLogManager = (overrides: Partial<PaneLogManager> = {}): PaneLogManager => ({
  getPaneLogPath: vi.fn(() => "/tmp/log"),
  ensureLogFiles: vi.fn(async () => {}),
  preparePaneLogging: vi.fn(async () => ({
    pipeAttached: false,
    pipeConflict: false,
    logPath: "/tmp/log",
  })),
  ...overrides,
});

const basePane: PaneMeta = {
  paneId: "%1",
  sessionName: "main",
  windowIndex: 0,
  paneIndex: 1,
  windowActivity: null,
  paneActivity: null,
  paneActive: true,
  currentCommand: "bash",
  currentPath: "/tmp/project",
  paneTty: "/dev/ttys001",
  paneDead: false,
  panePipe: false,
  alternateOn: false,
  panePid: 123,
  paneTitle: null,
  paneStartCommand: "bash",
  pipeTagValue: "0",
};

const baseConfig = {
  activity: { runningThresholdMs: 20000, inactiveThresholdMs: 60000 },
} as AgentMonitorConfig;

describe("processPane", () => {
  it("returns null when pane should be ignored", async () => {
    const updatePaneOutputState = vi.fn();
    const result = await processPane(
      {
        pane: basePane,
        config: baseConfig,
        paneStates: { get: () => createPaneState() },
        paneLogManager: createPaneLogManager(),
        capturePaneFingerprint: vi.fn(async () => null),
        applyRestored: vi.fn(() => null),
        getCustomTitle: vi.fn(() => null),
        resolveRepoRoot: vi.fn(async () => null),
      },
      {
        resolvePaneAgent: vi.fn(async () => ({ agent: "unknown" as const, ignore: true })),
        updatePaneOutputState,
      },
    );

    expect(result).toBeNull();
    expect(updatePaneOutputState).not.toHaveBeenCalled();
  });

  it("returns detail for shell panes and skips pipe logging", async () => {
    const preparePaneLogging = vi.fn(async () => ({
      pipeAttached: false,
      pipeConflict: false,
      logPath: "/tmp/log",
    }));
    const getPaneLogPath = vi.fn(() => "/tmp/log");
    const updatePaneOutputState = vi.fn(async () => ({
      outputAt: "2024-01-01T00:00:00.000Z",
      hookState: null,
    }));
    const result = await processPane(
      {
        pane: basePane,
        config: baseConfig,
        paneStates: { get: () => createPaneState() },
        paneLogManager: createPaneLogManager({ preparePaneLogging, getPaneLogPath }),
        capturePaneFingerprint: vi.fn(async () => null),
        applyRestored: vi.fn(() => null),
        getCustomTitle: vi.fn(() => null),
        resolveRepoRoot: vi.fn(async () => null),
      },
      {
        resolvePaneAgent: vi.fn(async () => ({ agent: "unknown" as const, ignore: false })),
        updatePaneOutputState,
      },
    );

    expect(result).not.toBeNull();
    expect(result?.state).toBe("SHELL");
    expect(preparePaneLogging).not.toHaveBeenCalled();
    expect(updatePaneOutputState).toHaveBeenCalledWith(
      expect.objectContaining({ logPath: "/tmp/log" }),
    );
  });

  it("returns detail with restored state when available", async () => {
    const paneState = createPaneState({ lastMessage: "msg" });
    const detail = await processPane(
      {
        pane: basePane,
        config: baseConfig,
        paneStates: { get: () => paneState },
        paneLogManager: createPaneLogManager({
          preparePaneLogging: vi.fn(async () => ({
            pipeAttached: true,
            pipeConflict: false,
            logPath: "/tmp/log",
          })),
        }),
        capturePaneFingerprint: vi.fn(async () => null),
        applyRestored: vi.fn(() => ({ state: "WAITING_INPUT" }) as SessionDetail),
        getCustomTitle: vi.fn(() => "Custom"),
        resolveRepoRoot: vi.fn(async () => "/tmp/project"),
      },
      {
        resolvePaneAgent: vi.fn(async () => ({ agent: "codex" as const, ignore: false })),
        updatePaneOutputState: vi.fn(async () => ({
          outputAt: "2024-01-01T00:00:00.000Z",
          hookState: null,
        })),
        estimateSessionState: vi.fn(() => ({ state: "RUNNING" as const, reason: "estimated" })),
      },
    );

    expect(detail).not.toBeNull();
    expect(detail?.state).toBe("WAITING_INPUT");
    expect(detail?.stateReason).toBe("restored");
    expect(detail?.customTitle).toBe("Custom");
  });
});
