import type { AgentMonitorConfig, ScreenResponse, SessionDetail } from "@vde-monitor/shared";

import { buildError, nowIso } from "../http/helpers";
import type { createSessionMonitor } from "../monitor";
import { isEditorCommand } from "../monitor/agent-resolver-utils";
import { captureTerminalScreen } from "../screen-service";
import type { ScreenCache } from "./screen-cache";

type Monitor = ReturnType<typeof createSessionMonitor>;
type ScreenLimiter = (key: string) => boolean;

type ScreenResponseParams = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  target: SessionDetail;
  mode?: "text" | "image";
  lines?: number;
  cursor?: string;
  screenLimiter: ScreenLimiter;
  limiterKey: string;
  buildTextResponse: ScreenCache["buildTextResponse"];
};

const resolveJoinLines = (config: AgentMonitorConfig, target: SessionDetail) =>
  config.screen.joinLines || target.agent === "claude";

const resolveAltScreenMode = (config: AgentMonitorConfig, target: SessionDetail) => {
  if (isEditorCommand(target.currentCommand) || isEditorCommand(target.startCommand)) {
    return "on" as const;
  }
  return config.screen.altScreen;
};

export const createScreenResponse = async ({
  config,
  monitor,
  target,
  mode,
  lines,
  cursor,
  screenLimiter,
  limiterKey,
  buildTextResponse,
}: ScreenResponseParams): Promise<ScreenResponse> => {
  const lineCount = Math.min(lines ?? config.screen.defaultLines, config.screen.maxLines);

  const captureTextResponse = async (
    fallbackReason?: "image_failed" | "image_disabled",
    applyCursor = true,
  ): Promise<ScreenResponse> => {
    try {
      const text = await monitor.getScreenCapture().captureText({
        paneId: target.paneId,
        lines: lineCount,
        joinLines: resolveJoinLines(config, target),
        includeAnsi: config.screen.ansi,
        altScreen: resolveAltScreenMode(config, target),
        alternateOn: target.alternateOn,
        currentCommand: target.currentCommand ?? target.startCommand,
      });
      return buildTextResponse({
        paneId: target.paneId,
        lineCount,
        screen: text.screen,
        alternateOn: text.alternateOn,
        truncated: text.truncated,
        cursor: applyCursor ? cursor : undefined,
        fallbackReason,
      });
    } catch {
      return {
        ok: false,
        paneId: target.paneId,
        mode: "text",
        capturedAt: nowIso(),
        error: buildError("INTERNAL", "screen capture failed"),
      };
    }
  };

  if (!screenLimiter(limiterKey)) {
    return {
      ok: false,
      paneId: target.paneId,
      mode: "text",
      capturedAt: nowIso(),
      error: buildError("RATE_LIMIT", "rate limited"),
    };
  }

  const effectiveMode = mode ?? config.screen.mode;

  if (effectiveMode === "image") {
    if (!config.screen.image.enabled) {
      return captureTextResponse("image_disabled", false);
    }
    const multiplexerBackend = config.multiplexer.backend;
    if (multiplexerBackend !== "tmux" && multiplexerBackend !== "wezterm") {
      return captureTextResponse("image_disabled", false);
    }
    const imageResult = await captureTerminalScreen(target.paneTty, {
      paneId: target.paneId,
      multiplexerBackend,
      tmux: config.tmux,
      wezterm: config.multiplexer.wezterm,
      cropPane: config.screen.image.cropPane,
      backend: config.screen.image.backend,
    });
    if (imageResult) {
      return {
        ok: true,
        paneId: target.paneId,
        mode: "image",
        capturedAt: nowIso(),
        imageBase64: imageResult.imageBase64,
        cropped: imageResult.cropped,
      };
    }
    return captureTextResponse("image_failed", false);
  }

  return captureTextResponse();
};
