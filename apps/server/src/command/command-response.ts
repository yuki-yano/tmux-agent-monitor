import type { AgentMonitorConfig, AllowedKey, CommandResponse, RawItem } from "@vde-monitor/shared";

import { buildError } from "../http/helpers.js";
import type { createSessionMonitor } from "../monitor.js";
import type { createTmuxActions } from "../tmux-actions.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type TmuxActions = ReturnType<typeof createTmuxActions>;
type CommandLimiter = (key: string) => boolean;

type CommandPayload =
  | { type: "send.text"; paneId: string; text: string; enter?: boolean }
  | { type: "send.keys"; paneId: string; keys: AllowedKey[] }
  | { type: "send.raw"; paneId: string; items: RawItem[]; unsafe?: boolean };

type CommandResponseParams = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  tmuxActions: TmuxActions;
  payload: CommandPayload;
  limiterKey: string;
  sendLimiter: CommandLimiter;
  rawLimiter: CommandLimiter;
};

const resolveLimiter = (
  payloadType: CommandPayload["type"],
  sendLimiter: CommandLimiter,
  rawLimiter: CommandLimiter,
) => (payloadType === "send.raw" ? rawLimiter : sendLimiter);

const executePayload = async (tmuxActions: TmuxActions, payload: CommandPayload) => {
  switch (payload.type) {
    case "send.text":
      return {
        paneId: payload.paneId,
        result: await tmuxActions.sendText(payload.paneId, payload.text, payload.enter ?? true),
      };
    case "send.keys":
      return {
        paneId: payload.paneId,
        result: await tmuxActions.sendKeys(payload.paneId, payload.keys),
      };
    case "send.raw":
      return {
        paneId: payload.paneId,
        result: await tmuxActions.sendRaw(payload.paneId, payload.items, payload.unsafe ?? false),
      };
    default:
      return null;
  }
};

export const createCommandResponse = async ({
  config,
  monitor,
  tmuxActions,
  payload,
  limiterKey,
  sendLimiter,
  rawLimiter,
}: CommandResponseParams): Promise<CommandResponse> => {
  if (config.readOnly) {
    return { ok: false, error: buildError("READ_ONLY", "read-only mode") };
  }

  const limiter = resolveLimiter(payload.type, sendLimiter, rawLimiter);
  if (!limiter(limiterKey)) {
    return { ok: false, error: buildError("RATE_LIMIT", "rate limited") };
  }

  const executed = await executePayload(tmuxActions, payload);
  if (!executed) {
    return { ok: false, error: buildError("INVALID_PAYLOAD", "unsupported command payload") };
  }
  if (executed.result.ok) {
    monitor.recordInput(executed.paneId);
  }
  return executed.result as CommandResponse;
};
