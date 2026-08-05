import { getConnInfo } from "@hono/node-server/conninfo";
import type { AgentMonitorConfig } from "@vde-monitor/multiplexer";
import { Hono } from "hono";

import { createCommandResponse } from "../command/command-response";
import { ClaudeTranscriptTokenSource } from "../domain/usage-cost/claude-transcript-token-source";
import { CodexSessionTokenSource } from "../domain/usage-cost/codex-session-token-source";
import { createUsageCostProvider } from "../domain/usage-cost/cost-provider";
import { LiteLLMPricingSource } from "../domain/usage-cost/litellm-pricing-source";
import { createUsageDashboardService } from "../domain/usage-dashboard/usage-dashboard-service";
import { PreviewTicketService } from "../file-preview";
import { createRateLimiter } from "../limits/rate-limit";
import { createPromptCompletionService } from "../prompt-completions/service";
import type {
  MultiplexerInputActions,
  MultiplexerLaunchCapability,
} from "@vde-monitor/multiplexer";
import type { NotificationService } from "../notifications/service";
import { createScreenCache } from "../screen/screen-cache";
import type { ScreenStreamScheduler } from "../streams/screen-stream-scheduler";
import type { SessionsStreamSource } from "../streams/sessions-stream-source";
import type { StreamConnections } from "../streams/stream-connections";
import { buildError, isOriginAllowed, requireAuth } from "./helpers";
import { createBranchRoutes } from "./routes/branch-routes";
import { createFileRoutes } from "./routes/file-routes";
import { createGitRoutes } from "./routes/git-routes";
import { createNotificationRoutes } from "./routes/notification-routes";
import { createPromptCompletionRoutes } from "./routes/prompt-completion-routes";
import { createSessionRoutes } from "./routes/session-routes";
import type { CommandPayload, HeaderContext, Monitor, RouteContext } from "./routes/types";
import { createUsageRoutes } from "./routes/usage-routes";
import {
  resolvePane as _resolvePane,
  resolveTitleUpdate as _resolveTitleUpdate,
  validateAttachmentContentLength as _validateAttachmentContentLength,
} from "./route-validators";

type ApiContext = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  actions: MultiplexerInputActions;
  launchCapability?: MultiplexerLaunchCapability;
  notificationService: NotificationService;
  usageDashboardService?: ReturnType<typeof createUsageDashboardService>;
  streamSource: SessionsStreamSource;
  screenScheduler: ScreenStreamScheduler;
  streamConnections: StreamConnections;
  previewTicketService?: PreviewTicketService;
};

const CORS_ALLOW_METHODS = "GET,POST,PUT,DELETE,OPTIONS";
const CORS_ALLOW_HEADERS = "Authorization,Content-Type,Request-Id,X-Request-Id,Content-Length";
const CONFIG_VALIDATION_ERROR_PATTERN = /^invalid config(?: JSON)?: /i;

const logInternalError = (error: unknown) => {
  console.error("[vde-monitor] API request failed", error);
};

const resolveConfigValidationErrorCause = (error: unknown) => {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message.trim();
  if (!CONFIG_VALIDATION_ERROR_PATTERN.test(message)) {
    return null;
  }
  return message;
};

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

export const createApiRouter = ({
  config,
  monitor,
  actions,
  launchCapability,
  notificationService,
  usageDashboardService,
  streamSource,
  screenScheduler,
  streamConnections,
  previewTicketService,
}: ApiContext) => {
  const api = new Hono();
  const filePreviewTickets = previewTicketService ?? new PreviewTicketService();
  const promptCompletionService = createPromptCompletionService();
  api.onError((error, c) => {
    logInternalError(error);
    const configValidationErrorCause = resolveConfigValidationErrorCause(error);
    if (configValidationErrorCause) {
      return c.json(
        {
          error: buildError("INTERNAL", "configuration validation failed"),
          errorCause: configValidationErrorCause,
        },
        500,
      );
    }
    return c.text("Internal Server Error", 500);
  });
  const sendLimiter = createRateLimiter(1000, 10);
  const screenLimiter = createRateLimiter(1000, 10);
  const rawLimiter = createRateLimiter(1000, 200);
  const usageRefreshLimiter = createRateLimiter(5_000, 3);
  const authFailureLimiter = createRateLimiter(60_000, 20);
  const screenCache = createScreenCache();
  const pricingConfig = config.usage.pricing;
  const dashboardService =
    usageDashboardService ??
    createUsageDashboardService({
      usageConfig: config.usage,
      costProvider: createUsageCostProvider({
        pricingConfig,
        pricingSource: new LiteLLMPricingSource(),
        tokenSources: {
          codex: new CodexSessionTokenSource(),
          claude: new ClaudeTranscriptTokenSource(),
        },
      }),
    });

  const getLimiterKey = (c: HeaderContext) => {
    const auth = c.req.header("authorization") ?? c.req.header("Authorization");
    return auth ?? "rest";
  };

  const resolvePane = (c: RouteContext) => _resolvePane(c, monitor);
  const resolveTitleUpdate = (c: RouteContext, title: string | null) =>
    _resolveTitleUpdate(c, title);
  const validateAttachmentContentLength = (c: RouteContext) => _validateAttachmentContentLength(c);

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
      const clientKey = (() => {
        try {
          return getConnInfo(c).remote.address ?? "unknown";
        } catch {
          // Test harnesses and non-socket transports expose no connection info.
          return "unknown";
        }
      })();
      if (!authFailureLimiter(clientKey)) {
        return c.json({ error: buildError("RATE_LIMIT", "too many authentication failures") }, 429);
      }
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
      launchCapability,
      screenLimiter,
      sendLimiter,
      screenCache,
      getLimiterKey,
      resolvePane,
      resolveTitleUpdate,
      validateAttachmentContentLength,
      executeCommand,
      streamSource,
      screenScheduler,
      streamConnections,
    }),
  );
  const withGitRoutes = withSessionRoutes.route(
    "/",
    createGitRoutes({
      resolvePane,
    }),
  );
  const withBranchRoutes = withGitRoutes.route(
    "/",
    createBranchRoutes({
      resolvePane,
    }),
  );
  const withFileRoutes = withBranchRoutes.route(
    "/",
    createFileRoutes({
      resolvePane,
      config,
      previewTicketService: filePreviewTickets,
    }),
  );
  const withNotificationRoutes = withFileRoutes.route(
    "/",
    createPromptCompletionRoutes({
      resolvePane,
      service: promptCompletionService,
    }),
  );
  const withPushNotificationRoutes = withNotificationRoutes.route(
    "/",
    createNotificationRoutes({
      notificationService,
    }),
  );
  const withUsageRoutes = withPushNotificationRoutes.route(
    "/",
    createUsageRoutes({
      monitor,
      usageDashboardService: dashboardService,
      getLimiterKey,
      refreshLimiter: usageRefreshLimiter,
    }),
  );

  return withUsageRoutes;
};

export type ApiAppType = ReturnType<typeof createApiRouter>;
