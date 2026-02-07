import type { AgentMonitorConfig } from "@vde-monitor/shared";
import { sanitizeServerKey } from "@vde-monitor/shared";
import {
  createInspector,
  createScreenCapture,
  createWeztermActions,
  createWeztermAdapter,
  normalizeWeztermTarget,
} from "@vde-monitor/wezterm";

import { normalizeFingerprint } from "../monitor/monitor-utils.js";
import type { MultiplexerRuntime } from "./types.js";

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
  const actions = createWeztermActions(adapter, config);
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
