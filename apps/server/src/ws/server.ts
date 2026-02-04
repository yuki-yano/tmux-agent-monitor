import type { createNodeWebSocket } from "@hono/node-ws";
import type {
  AgentMonitorConfig,
  CommandResponse,
  ScreenResponse,
  WsServerMessage,
} from "@vde-monitor/shared";
import { wsClientMessageSchema } from "@vde-monitor/shared";
import type { WSContext } from "hono/ws";

import { buildError, nowIso } from "../http/helpers.js";
import type { createSessionMonitor } from "../monitor.js";
import type { createTmuxActions } from "../tmux-actions.js";
import { handleCommandMessage } from "./command-handler.js";
import { buildEnvelope } from "./envelope.js";
import { createRateLimiter } from "./rate-limit.js";
import { createScreenCache } from "./screen-cache.js";
import { handleScreenRequest } from "./screen-handler.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type TmuxActions = ReturnType<typeof createTmuxActions>;
type UpgradeWebSocket = ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"];

export const createWsServer = ({
  config,
  monitor,
  tmuxActions,
  upgradeWebSocket,
}: {
  config: AgentMonitorConfig;
  monitor: Monitor;
  tmuxActions: TmuxActions;
  upgradeWebSocket: UpgradeWebSocket;
}) => {
  const wsClients = new Set<WSContext>();

  const sendLimiter = createRateLimiter(config.rateLimit.send.windowMs, config.rateLimit.send.max);
  const screenLimiter = createRateLimiter(
    config.rateLimit.screen.windowMs,
    config.rateLimit.screen.max,
  );
  const rawLimiter = createRateLimiter(config.rateLimit.raw.windowMs, config.rateLimit.raw.max);

  const screenCache = createScreenCache();

  const sendWs = (ws: WSContext, message: WsServerMessage) => {
    ws.send(JSON.stringify(message));
  };

  const buildHealthPayload = () => ({
    version: "0.0.1",
    clientConfig: {
      screen: {
        highlightCorrection: config.screen.highlightCorrection,
      },
    },
  });

  const closeAllWsClients = (code: number, reason: string) => {
    wsClients.forEach((ws) => {
      try {
        ws.close(code, reason);
      } catch {
        // Ignore close errors to ensure full cleanup.
      }
    });
    wsClients.clear();
  };

  const broadcast = (message: WsServerMessage) => {
    const payload = JSON.stringify(message);
    wsClients.forEach((ws) => ws.send(payload));
  };

  monitor.registry.onChanged((session) => {
    broadcast(buildEnvelope("session.updated", { session }));
  });

  monitor.registry.onRemoved((paneId) => {
    broadcast(buildEnvelope("session.removed", { paneId }));
  });

  const wsHandler = upgradeWebSocket(() => ({
    onOpen: (_event, ws) => {
      wsClients.add(ws);
      sendWs(ws, buildEnvelope("sessions.snapshot", { sessions: monitor.registry.snapshot() }));
      sendWs(ws, buildEnvelope("server.health", buildHealthPayload()));
    },
    onClose: (_event, ws) => {
      wsClients.delete(ws);
    },
    onMessage: async (event, ws) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(event.data.toString());
      } catch {
        sendWs(
          ws,
          buildEnvelope("command.response", {
            ok: false,
            error: buildError("INVALID_PAYLOAD", "invalid json"),
          } as CommandResponse),
        );
        return;
      }

      const parsed = wsClientMessageSchema.safeParse(parsedJson);
      if (!parsed.success) {
        sendWs(
          ws,
          buildEnvelope("command.response", {
            ok: false,
            error: buildError("INVALID_PAYLOAD", "invalid payload"),
          } as CommandResponse),
        );
        return;
      }

      const message = parsed.data;
      const reqId = message.reqId;
      if (message.type === "client.ping") {
        sendWs(ws, buildEnvelope("server.health", buildHealthPayload(), reqId));
        return;
      }

      const target = monitor.registry.getDetail(message.data.paneId);
      if (!target) {
        if (message.type === "screen.request") {
          sendWs(
            ws,
            buildEnvelope(
              "screen.response",
              {
                ok: false,
                paneId: message.data.paneId,
                mode: message.data.mode ?? config.screen.mode,
                capturedAt: nowIso(),
                error: buildError("NOT_FOUND", "pane not found"),
              } as ScreenResponse,
              reqId,
            ),
          );
        } else {
          sendWs(
            ws,
            buildEnvelope(
              "command.response",
              { ok: false, error: buildError("NOT_FOUND", "pane not found") },
              reqId,
            ),
          );
        }
        return;
      }

      if (message.type === "screen.request") {
        await handleScreenRequest({
          config,
          monitor,
          message,
          reqId,
          target,
          screenLimiter,
          buildTextResponse: screenCache.buildTextResponse,
          send: (payload) => sendWs(ws, payload),
        });
        return;
      }

      await handleCommandMessage({
        config,
        monitor,
        tmuxActions,
        message,
        reqId,
        sendLimiter,
        rawLimiter,
        send: (payload) => sendWs(ws, payload),
      });
    },
  }));

  return { wsHandler, closeAllClients: closeAllWsClients };
};
