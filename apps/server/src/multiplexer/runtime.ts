import type { AgentMonitorConfig } from "@vde-monitor/shared";

import { createTmuxRuntime } from "./runtime-tmux.js";
import { createWeztermRuntime } from "./runtime-wezterm.js";
import type { MultiplexerRuntime } from "./types.js";

export const createMultiplexerRuntime = (config: AgentMonitorConfig): MultiplexerRuntime => {
  if (config.multiplexer.backend === "wezterm") {
    return createWeztermRuntime(config);
  }
  return createTmuxRuntime(config);
};
