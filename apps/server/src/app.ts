import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import {
  type AgentMonitorConfig,
  type ApiError,
  type CommandResponse,
  type ScreenResponse,
  wsClientMessageSchema,
  type WsEnvelope,
  type WsServerMessage,
} from "@tmux-agent-monitor/shared";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";

import { rotateToken } from "./config.js";
import { fetchCommitDetail, fetchCommitFile, fetchCommitLog } from "./git-commits.js";
import { fetchDiffFile, fetchDiffSummary } from "./git-diff.js";
import type { createSessionMonitor } from "./monitor.js";
import { captureTerminalScreen } from "./screen-service.js";
import type { createTmuxActions } from "./tmux-actions.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type TmuxActions = ReturnType<typeof createTmuxActions>;

type AppContext = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  tmuxActions: TmuxActions;
};

const now = () => new Date().toISOString();

const buildError = (code: ApiError["code"], message: string): ApiError => ({
  code,
  message,
});

const buildEnvelope = <TType extends string, TData>(
  type: TType,
  data: TData,
  reqId?: string,
): WsEnvelope<TType, TData> => ({
  type,
  ts: now(),
  reqId,
  data,
});

const createRateLimiter = (windowMs: number, max: number) => {
  const hits = new Map<string, { count: number; expiresAt: number }>();
  return (key: string) => {
    const nowMs = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.expiresAt <= nowMs) {
      hits.set(key, { count: 1, expiresAt: nowMs + windowMs });
      return true;
    }
    if (entry.count >= max) {
      return false;
    }
    entry.count += 1;
    return true;
  };
};

export const createApp = ({ config, monitor, tmuxActions }: AppContext) => {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const wsClients = new Set<WSContext>();

  const sendLimiter = createRateLimiter(config.rateLimit.send.windowMs, config.rateLimit.send.max);
  const screenLimiter = createRateLimiter(
    config.rateLimit.screen.windowMs,
    config.rateLimit.screen.max,
  );

  const requireAuth = (c: { req: { header: (name: string) => string | undefined } }) => {
    const auth = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return false;
    }
    const token = auth.replace("Bearer ", "").trim();
    return token === config.token;
  };

  const requireStaticAuth = (c: { req: { query: (name: string) => string | undefined } }) => {
    const token = c.req.query("token");
    if (!token) {
      return false;
    }
    return token === config.token;
  };

  const isOriginAllowed = (origin?: string | null, host?: string | null) => {
    if (config.allowedOrigins.length === 0) {
      return true;
    }
    if (!origin) {
      return false;
    }
    return (
      config.allowedOrigins.includes(origin) ||
      (host ? config.allowedOrigins.includes(host) : false)
    );
  };

  const sendWs = (ws: WSContext, message: WsServerMessage) => {
    ws.send(JSON.stringify(message));
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

  app.use("/api/*", async (c, next) => {
    if (!requireAuth(c)) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "unauthorized") }, 401);
    }
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (!isOriginAllowed(origin, host)) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "origin not allowed") }, 403);
    }
    await next();
  });

  app.get("/api/sessions", (c) => {
    return c.json({ sessions: monitor.registry.snapshot(), serverTime: now() });
  });

  app.get("/api/sessions/:paneId", (c) => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("NOT_FOUND", "pane not found") }, 404);
    }
    return c.json({ session: detail });
  });

  app.get("/api/sessions/:paneId/diff", async (c) => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("NOT_FOUND", "pane not found") }, 404);
    }
    const force = c.req.query("force") === "1";
    const summary = await fetchDiffSummary(detail.currentPath, { force });
    return c.json({ summary });
  });

  app.get("/api/sessions/:paneId/diff/file", async (c) => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("NOT_FOUND", "pane not found") }, 404);
    }
    const pathParam = c.req.query("path");
    if (!pathParam) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "missing path") }, 400);
    }
    const force = c.req.query("force") === "1";
    const summary = await fetchDiffSummary(detail.currentPath, { force });
    if (!summary.repoRoot || summary.reason || !summary.rev) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "diff summary unavailable") }, 400);
    }
    const target = summary.files.find((file) => file.path === pathParam);
    if (!target) {
      return c.json({ error: buildError("NOT_FOUND", "file not found") }, 404);
    }
    const file = await fetchDiffFile(summary.repoRoot, target, summary.rev, { force });
    return c.json({ file });
  });

  app.get("/api/sessions/:paneId/commits", async (c) => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("NOT_FOUND", "pane not found") }, 404);
    }
    const limit = Number.parseInt(c.req.query("limit") ?? "10", 10);
    const skip = Number.parseInt(c.req.query("skip") ?? "0", 10);
    const force = c.req.query("force") === "1";
    const log = await fetchCommitLog(detail.currentPath, {
      limit: Number.isFinite(limit) ? limit : 10,
      skip: Number.isFinite(skip) ? skip : 0,
      force,
    });
    return c.json({ log });
  });

  app.get("/api/sessions/:paneId/commits/:hash", async (c) => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("NOT_FOUND", "pane not found") }, 404);
    }
    const hash = c.req.param("hash");
    if (!hash) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "missing hash") }, 400);
    }
    const log = await fetchCommitLog(detail.currentPath, { limit: 1, skip: 0 });
    if (!log.repoRoot || log.reason) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "commit log unavailable") }, 400);
    }
    const commit = await fetchCommitDetail(log.repoRoot, hash, {
      force: c.req.query("force") === "1",
    });
    if (!commit) {
      return c.json({ error: buildError("NOT_FOUND", "commit not found") }, 404);
    }
    return c.json({ commit });
  });

  app.get("/api/sessions/:paneId/commits/:hash/file", async (c) => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("NOT_FOUND", "pane not found") }, 404);
    }
    const hash = c.req.param("hash");
    const pathParam = c.req.query("path");
    if (!hash || !pathParam) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "missing hash or path") }, 400);
    }
    const log = await fetchCommitLog(detail.currentPath, { limit: 1, skip: 0 });
    if (!log.repoRoot || log.reason) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "commit log unavailable") }, 400);
    }
    const commit = await fetchCommitDetail(log.repoRoot, hash, { force: true });
    if (!commit) {
      return c.json({ error: buildError("NOT_FOUND", "commit not found") }, 404);
    }
    const target =
      commit.files.find((file) => file.path === pathParam) ??
      commit.files.find((file) => file.renamedFrom === pathParam);
    if (!target) {
      return c.json({ error: buildError("NOT_FOUND", "file not found") }, 404);
    }
    const file = await fetchCommitFile(log.repoRoot, hash, target, {
      force: c.req.query("force") === "1",
    });
    return c.json({ file });
  });

  app.post("/api/admin/token/rotate", (c) => {
    const next = rotateToken();
    config.token = next.token;
    return c.json({ token: next.token });
  });

  const wsHandler = upgradeWebSocket(() => ({
    onOpen: (_event, ws) => {
      wsClients.add(ws);
      sendWs(ws, buildEnvelope("sessions.snapshot", { sessions: monitor.registry.snapshot() }));
      sendWs(ws, buildEnvelope("server.health", { version: "0.0.1" }));
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
        sendWs(ws, buildEnvelope("server.health", { version: "0.0.1" }, reqId));
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
                capturedAt: now(),
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
        const clientKey = "ws";
        if (!screenLimiter(clientKey)) {
          sendWs(
            ws,
            buildEnvelope(
              "screen.response",
              {
                ok: false,
                paneId: message.data.paneId,
                mode: "text",
                capturedAt: now(),
                error: buildError("RATE_LIMIT", "rate limited"),
              } as ScreenResponse,
              reqId,
            ),
          );
          return;
        }

        const mode = message.data.mode ?? config.screen.mode;
        const lineCount = Math.min(
          message.data.lines ?? config.screen.defaultLines,
          config.screen.maxLines,
        );

        if (mode === "image") {
          if (!config.screen.image.enabled) {
            try {
              const text = await monitor.getScreenCapture().captureText({
                paneId: message.data.paneId,
                lines: lineCount,
                joinLines: config.screen.joinLines,
                includeAnsi: config.screen.ansi,
                altScreen: config.screen.altScreen,
                alternateOn: target.alternateOn,
              });
              sendWs(
                ws,
                buildEnvelope(
                  "screen.response",
                  {
                    ok: true,
                    paneId: message.data.paneId,
                    mode: "text",
                    capturedAt: now(),
                    lines: lineCount,
                    truncated: text.truncated,
                    alternateOn: target.alternateOn,
                    screen: text.screen,
                    fallbackReason: "image_disabled",
                  } as ScreenResponse,
                  reqId,
                ),
              );
              return;
            } catch {
              sendWs(
                ws,
                buildEnvelope(
                  "screen.response",
                  {
                    ok: false,
                    paneId: message.data.paneId,
                    mode: "text",
                    capturedAt: now(),
                    error: buildError("INTERNAL", "screen capture failed"),
                  } as ScreenResponse,
                  reqId,
                ),
              );
              return;
            }
          }
          const imageResult = await captureTerminalScreen(target.paneTty, {
            paneId: message.data.paneId,
            tmux: config.tmux,
            cropPane: config.screen.image.cropPane,
            backend: config.screen.image.backend,
          });
          if (imageResult) {
            sendWs(
              ws,
              buildEnvelope(
                "screen.response",
                {
                  ok: true,
                  paneId: message.data.paneId,
                  mode: "image",
                  capturedAt: now(),
                  imageBase64: imageResult.imageBase64,
                  cropped: imageResult.cropped,
                } as ScreenResponse,
                reqId,
              ),
            );
            return;
          }
          try {
            const text = await monitor.getScreenCapture().captureText({
              paneId: message.data.paneId,
              lines: lineCount,
              joinLines: config.screen.joinLines,
              includeAnsi: config.screen.ansi,
              altScreen: config.screen.altScreen,
              alternateOn: target.alternateOn,
            });
            sendWs(
              ws,
              buildEnvelope(
                "screen.response",
                {
                  ok: true,
                  paneId: message.data.paneId,
                  mode: "text",
                  capturedAt: now(),
                  lines: lineCount,
                  truncated: text.truncated,
                  alternateOn: target.alternateOn,
                  screen: text.screen,
                  fallbackReason: "image_failed",
                } as ScreenResponse,
                reqId,
              ),
            );
            return;
          } catch {
            sendWs(
              ws,
              buildEnvelope(
                "screen.response",
                {
                  ok: false,
                  paneId: message.data.paneId,
                  mode: "text",
                  capturedAt: now(),
                  error: buildError("INTERNAL", "screen capture failed"),
                } as ScreenResponse,
                reqId,
              ),
            );
            return;
          }
        }

        try {
          const text = await monitor.getScreenCapture().captureText({
            paneId: message.data.paneId,
            lines: lineCount,
            joinLines: config.screen.joinLines,
            includeAnsi: config.screen.ansi,
            altScreen: config.screen.altScreen,
            alternateOn: target.alternateOn,
          });
          sendWs(
            ws,
            buildEnvelope(
              "screen.response",
              {
                ok: true,
                paneId: message.data.paneId,
                mode: "text",
                capturedAt: now(),
                lines: lineCount,
                truncated: text.truncated,
                alternateOn: target.alternateOn,
                screen: text.screen,
              } as ScreenResponse,
              reqId,
            ),
          );
          return;
        } catch {
          sendWs(
            ws,
            buildEnvelope(
              "screen.response",
              {
                ok: false,
                paneId: message.data.paneId,
                mode: "text",
                capturedAt: now(),
                error: buildError("INTERNAL", "screen capture failed"),
              } as ScreenResponse,
              reqId,
            ),
          );
          return;
        }
      }

      if (config.readOnly) {
        sendWs(
          ws,
          buildEnvelope(
            "command.response",
            { ok: false, error: buildError("READ_ONLY", "read-only mode") },
            reqId,
          ),
        );
        return;
      }

      const clientKey = "ws";
      if (!sendLimiter(clientKey)) {
        sendWs(
          ws,
          buildEnvelope(
            "command.response",
            { ok: false, error: buildError("RATE_LIMIT", "rate limited") },
            reqId,
          ),
        );
        return;
      }

      if (message.type === "send.text") {
        const result = await tmuxActions.sendText(
          message.data.paneId,
          message.data.text,
          message.data.enter ?? true,
        );
        sendWs(ws, buildEnvelope("command.response", result as CommandResponse, reqId));
        return;
      }

      if (message.type === "send.keys") {
        const result = await tmuxActions.sendKeys(message.data.paneId, message.data.keys);
        sendWs(ws, buildEnvelope("command.response", result as CommandResponse, reqId));
        return;
      }

      return;
    },
  }));

  app.use("/ws", async (c, next) => {
    const token = c.req.query("token");
    if (!token || token !== config.token) {
      return c.text("Unauthorized", 401);
    }
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (!isOriginAllowed(origin, host)) {
      return c.text("Forbidden", 403);
    }
    await next();
  });

  app.get("/ws", wsHandler);

  const distRoot = path.dirname(fileURLToPath(import.meta.url));
  const bundledDistDir = path.resolve(distRoot, "web");
  const workspaceDistDir = path.resolve(distRoot, "../../web/dist");
  const distDir = fs.existsSync(bundledDistDir) ? bundledDistDir : workspaceDistDir;

  if (fs.existsSync(distDir)) {
    app.use("/*", async (c, next) => {
      if (!config.staticAuth) {
        return next();
      }
      if (!requireStaticAuth(c)) {
        return c.text("Unauthorized", 401);
      }
      return next();
    });

    app.use("/*", serveStatic({ root: distDir }));
    app.get("/*", serveStatic({ root: distDir, path: "index.html" }));
  }

  return { app, injectWebSocket };
};
