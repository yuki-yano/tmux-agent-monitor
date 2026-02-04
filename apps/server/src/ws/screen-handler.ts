import type {
  AgentMonitorConfig,
  ScreenResponse,
  SessionDetail,
  WsClientMessage,
  WsServerMessage,
} from "@vde-monitor/shared";

import { buildError, nowIso } from "../http/helpers.js";
import type { createSessionMonitor } from "../monitor.js";
import { captureTerminalScreen } from "../screen-service.js";
import { buildEnvelope } from "./envelope.js";
import type { ScreenCache } from "./screen-cache.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type ScreenLimiter = (key: string) => boolean;
type ScreenRequestMessage = Extract<WsClientMessage, { type: "screen.request" }>;
type SendMessage = (message: WsServerMessage) => void;

type ScreenHandlerArgs = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  message: ScreenRequestMessage;
  reqId?: string;
  target: SessionDetail;
  screenLimiter: ScreenLimiter;
  buildTextResponse: ScreenCache["buildTextResponse"];
  send: SendMessage;
};

export const handleScreenRequest = async ({
  config,
  monitor,
  message,
  reqId,
  target,
  screenLimiter,
  buildTextResponse,
  send,
}: ScreenHandlerArgs) => {
  const sendResponse = (response: ScreenResponse) => {
    send(buildEnvelope("screen.response", response, reqId));
  };

  const captureTextAndRespond = async (
    fallbackReason?: "image_failed" | "image_disabled",
  ): Promise<void> => {
    try {
      const text = await monitor.getScreenCapture().captureText({
        paneId: message.data.paneId,
        lines: lineCount,
        joinLines: config.screen.joinLines,
        includeAnsi: config.screen.ansi,
        altScreen: config.screen.altScreen,
        alternateOn: target.alternateOn,
      });
      const response = buildTextResponse({
        paneId: message.data.paneId,
        lineCount,
        screen: text.screen,
        alternateOn: text.alternateOn,
        truncated: text.truncated,
        cursor: message.data.cursor,
        fallbackReason,
      });
      sendResponse(response);
    } catch {
      sendResponse({
        ok: false,
        paneId: message.data.paneId,
        mode: "text",
        capturedAt: nowIso(),
        error: buildError("INTERNAL", "screen capture failed"),
      });
    }
  };

  const clientKey = "ws";
  if (!screenLimiter(clientKey)) {
    sendResponse({
      ok: false,
      paneId: message.data.paneId,
      mode: "text",
      capturedAt: nowIso(),
      error: buildError("RATE_LIMIT", "rate limited"),
    });
    return;
  }

  const mode = message.data.mode ?? config.screen.mode;
  const lineCount = Math.min(
    message.data.lines ?? config.screen.defaultLines,
    config.screen.maxLines,
  );

  if (mode === "image") {
    if (!config.screen.image.enabled) {
      await captureTextAndRespond("image_disabled");
      return;
    }
    const imageResult = await captureTerminalScreen(target.paneTty, {
      paneId: message.data.paneId,
      tmux: config.tmux,
      cropPane: config.screen.image.cropPane,
      backend: config.screen.image.backend,
    });
    if (imageResult) {
      sendResponse({
        ok: true,
        paneId: message.data.paneId,
        mode: "image",
        capturedAt: nowIso(),
        imageBase64: imageResult.imageBase64,
        cropped: imageResult.cropped,
      });
      return;
    }
    await captureTextAndRespond("image_failed");
    return;
  }

  await captureTextAndRespond();
};
