import type { AgentMonitorConfig, SessionDetail } from "@vde-monitor/shared";

import type { createCommandResponse } from "../../command/command-response";
import type { createRateLimiter } from "../../limits/rate-limit";
import type { createSessionMonitor } from "../../monitor";
import type { MultiplexerInputActions } from "../../multiplexer/types";
import type { createScreenCache } from "../../screen/screen-cache";

export type Monitor = ReturnType<typeof createSessionMonitor>;
export type CommandPayload = Parameters<typeof createCommandResponse>[0]["payload"];
export type CommandResponseResult = ReturnType<typeof createCommandResponse>;
export type CommandLimiter = ReturnType<typeof createRateLimiter>;
export type ScreenCache = ReturnType<typeof createScreenCache>;

export type HeaderContext = {
  req: {
    header: (name: string) => string | undefined;
  };
};

export type RouteContext = {
  req: {
    param: (name: string) => string | undefined;
    header: (name: string) => string | undefined;
  };
  json: (body: unknown, status?: number) => Response;
};

export type PaneResolution = {
  paneId: string;
  detail: SessionDetail;
};

export type ResolvePane = (c: RouteContext) => PaneResolution | Response;
export type ResolveTitleUpdate = (
  c: RouteContext,
  title: string | null,
) => { nextTitle: string | null } | Response;
export type ValidateAttachmentContentLength = (c: RouteContext) => number | Response;
export type GetLimiterKey = (c: HeaderContext) => string;
export type ExecuteCommand = (c: HeaderContext, payload: CommandPayload) => CommandResponseResult;

export type SessionRouteDeps = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  actions: MultiplexerInputActions;
  screenLimiter: CommandLimiter;
  sendLimiter: CommandLimiter;
  screenCache: ScreenCache;
  getLimiterKey: GetLimiterKey;
  resolvePane: ResolvePane;
  resolveTitleUpdate: ResolveTitleUpdate;
  validateAttachmentContentLength: ValidateAttachmentContentLength;
  executeCommand: ExecuteCommand;
};

export type GitRouteDeps = {
  resolvePane: ResolvePane;
};
