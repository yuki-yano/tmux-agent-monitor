import type { TmuxAdapter } from "@vde-monitor/tmux";

import { normalizeFingerprint } from "./monitor-utils.js";

export const createFingerprintCapture = (adapter: TmuxAdapter) => {
  return async (paneId: string, useAlt: boolean) => {
    const args = ["capture-pane", "-p", "-e", "-t", paneId];
    if (useAlt) {
      args.push("-a");
    }
    const result = await adapter.run(args);
    if (result.exitCode !== 0) {
      return null;
    }
    return normalizeFingerprint(result.stdout ?? "");
  };
};
