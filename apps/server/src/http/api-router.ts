import type { AgentMonitorConfig, SessionDetail } from "@vde-monitor/shared";
import { Hono } from "hono";

import { createCommandResponse } from "../command/command-response";
import { createRateLimiter } from "../limits/rate-limit";
import type { MultiplexerInputActions } from "../multiplexer/types";
import { createScreenCache } from "../screen/screen-cache";
import { buildError, isOriginAllowed, requireAuth } from "./helpers";
import { IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES } from "./image-attachment";
import { createGitRoutes } from "./routes/git-routes";
import { createSessionRoutes } from "./routes/session-routes";
import type { CommandPayload, HeaderContext, Monitor, RouteContext } from "./routes/types";

type ApiContext = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  actions: MultiplexerInputActions;
};

const CORS_ALLOW_METHODS = "GET,POST,PUT,OPTIONS";
const CORS_ALLOW_HEADERS = "Authorization,Content-Type,Request-Id,X-Request-Id,Content-Length";

const mergeVary = (existing: string | null, value: string) => {
  if (!existing) {
    return value;
  }
  const values = existing
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.includes(value)) {
    return existing;
  }
  return `${existing}, ${value}`;
};

const applyCorsHeaders = (
  c: {
    header: (name: string, value: string) => void;
    res: { headers: { get: (name: string) => string | null } };
  },
  origin: string,
) => {
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  c.header("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  c.header("Vary", mergeVary(c.res.headers.get("Vary"), "Origin"));
};

export const createApiRouter = ({ config, monitor, actions }: ApiContext) => {
  const api = new Hono();
  const sendLimiter = createRateLimiter(config.rateLimit.send.windowMs, config.rateLimit.send.max);
  const screenLimiter = createRateLimiter(
    config.rateLimit.screen.windowMs,
    config.rateLimit.screen.max,
  );
  const rawLimiter = createRateLimiter(config.rateLimit.raw.windowMs, config.rateLimit.raw.max);
  const screenCache = createScreenCache();

  const getLimiterKey = (c: HeaderContext) => {
    const auth = c.req.header("authorization") ?? c.req.header("Authorization");
    return auth ?? "rest";
  };

  const resolvePane = (c: RouteContext): { paneId: string; detail: SessionDetail } | Response => {
    const paneId = c.req.param("paneId");
    if (!paneId) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid pane id") }, 400);
    }
    const detail = monitor.registry.getDetail(paneId);
    if (!detail) {
      return c.json({ error: buildError("INVALID_PANE", "pane not found") }, 404);
    }
    return { paneId, detail };
  };

  const resolveTitleUpdate = (c: RouteContext, title: string | null) => {
    const trimmed = title ? title.trim() : null;
    if (trimmed && trimmed.length > 80) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "title too long") }, 400);
    }
    return { nextTitle: trimmed && trimmed.length > 0 ? trimmed : null };
  };

  const validateAttachmentContentLength = (c: RouteContext): number | Response => {
    const header =
      c.req.header("content-length") ??
      c.req.header("Content-Length") ??
      (process.env.NODE_ENV === "test" ? c.req.header("x-content-length") : undefined);
    if (!header) {
      return c.json(
        { error: buildError("INVALID_PAYLOAD", "content-length header is required") },
        400,
      );
    }
    const normalized = header.trim();
    if (!/^\d+$/.test(normalized)) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid content-length") }, 400);
    }
    const contentLength = Number(normalized);
    if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "invalid content-length") }, 400);
    }
    if (contentLength > IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES) {
      return c.json(
        { error: buildError("INVALID_PAYLOAD", "attachment exceeds content-length limit") },
        400,
      );
    }
    return contentLength;
  };

  const executeCommand = (c: HeaderContext, payload: CommandPayload) =>
    createCommandResponse({
      monitor,
      actions,
      payload,
      limiterKey: getLimiterKey(c),
      sendLimiter,
      rawLimiter,
    });

  const withMiddleware = api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const requestId = c.req.header("request-id") ?? c.req.header("x-request-id");
    if (requestId) {
      c.header("Request-Id", requestId);
    }
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (!isOriginAllowed(config, origin, host)) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "origin not allowed") }, 403);
    }
    if (origin) {
      applyCorsHeaders(c, origin);
    }
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    if (!requireAuth(config, c)) {
      return c.json({ error: buildError("INVALID_PAYLOAD", "unauthorized") }, 401);
    }
    await next();
  });

  const withSessionRoutes = withMiddleware.route(
    "/",
    createSessionRoutes({
      config,
      monitor,
      actions,
      screenLimiter,
      sendLimiter,
      screenCache,
      getLimiterKey,
      resolvePane,
      resolveTitleUpdate,
      validateAttachmentContentLength,
      executeCommand,
    }),
  );
  const withGitRoutes = withSessionRoutes.route(
    "/",
    createGitRoutes({
      resolvePane,
    }),
  );

  return withGitRoutes;
};

export type ApiAppType = ReturnType<typeof createApiRouter>;
