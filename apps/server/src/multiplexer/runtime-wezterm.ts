import type { AgentMonitorConfig } from "@vde-monitor/shared";
import { sanitizeServerKey } from "@vde-monitor/shared";
import {
  createInspector,
  createScreenCapture,
  createWeztermActions,
  createWeztermAdapter,
  normalizeWeztermTarget,
} from "@vde-monitor/wezterm";

import { markPaneFocus } from "../activity-suppressor";
import { normalizeFingerprint } from "../monitor/monitor-utils";
import { resolveBackendApp } from "../screen/macos-app";
import { focusTerminalApp, isAppRunning } from "../screen/macos-applescript";
import type { MultiplexerRuntime } from "./types";

export const createWeztermServerKey = (target: string | null | undefined) => {
  return sanitizeServerKey(`wezterm:${normalizeWeztermTarget(target)}`);
};

export const createWeztermRuntime = (config: AgentMonitorConfig): MultiplexerRuntime => {
  const adapter = createWeztermAdapter({
    cliPath: config.multiplexer.wezterm.cliPath,
    target: config.multiplexer.wezterm.target,
  });
  const inspector = createInspector(adapter);
  const screenCapture = createScreenCapture(adapter);
  const baseActions = createWeztermActions(adapter, config);
  const actions: MultiplexerRuntime["actions"] = {
    ...baseActions,
    focusPane: async (paneId: string) => {
      const result = await baseActions.focusPane(paneId);
      if (!result.ok) {
        return result;
      }
      markPaneFocus(paneId);
      if (process.platform !== "darwin") {
        return result;
      }
      const app = resolveBackendApp("wezterm");
      if (!app) {
        return result;
      }
      try {
        const running = await isAppRunning(app.appName);
        if (running) {
          await focusTerminalApp(app.appName);
        }
      } catch {
        // ignore focus errors after pane activation succeeds
      }
      return result;
    },
  };
  const captureFingerprint = async (paneId: string, useAlt: boolean) => {
    try {
      const captured = await screenCapture.captureText({
        paneId,
        lines: 200,
        joinLines: false,
        includeAnsi: true,
        altScreen: "auto",
        alternateOn: useAlt,
      });
      return normalizeFingerprint(captured.screen);
    } catch {
      return null;
    }
  };

  return {
    backend: "wezterm",
    serverKey: createWeztermServerKey(config.multiplexer.wezterm.target),
    inspector,
    screenCapture,
    actions,
    pipeManager: {
      hasConflict: () => false,
      attachPipe: async () => ({ attached: false, conflict: false }),
    },
    captureFingerprint,
    pipeSupport: "none",
  };
};
