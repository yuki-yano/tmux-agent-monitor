import type { AllowedKey, CommandResponse, RawItem } from "@vde-monitor/shared";

import { buildError } from "../http/helpers.js";
import type { createSessionMonitor } from "../monitor.js";
import type { MultiplexerInputActions } from "../multiplexer/types.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type CommandLimiter = (key: string) => boolean;

type CommandPayload =
  | { type: "send.text"; paneId: string; text: string; enter?: boolean }
  | { type: "send.keys"; paneId: string; keys: AllowedKey[] }
  | { type: "send.raw"; paneId: string; items: RawItem[]; unsafe?: boolean };

type CommandResponseParams = {
  monitor: Monitor;
  actions: MultiplexerInputActions;
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

const executePayload = async (actions: MultiplexerInputActions, payload: CommandPayload) => {
  switch (payload.type) {
    case "send.text":
      return {
        paneId: payload.paneId,
        result: await actions.sendText(payload.paneId, payload.text, payload.enter ?? true),
      };
    case "send.keys":
      return {
        paneId: payload.paneId,
        result: await actions.sendKeys(payload.paneId, payload.keys),
      };
    case "send.raw":
      return {
        paneId: payload.paneId,
        result: await actions.sendRaw(payload.paneId, payload.items, payload.unsafe ?? false),
      };
    default:
      return null;
  }
};

export const createCommandResponse = async ({
  monitor,
  actions,
  payload,
  limiterKey,
  sendLimiter,
  rawLimiter,
}: CommandResponseParams): Promise<CommandResponse> => {
  const limiter = resolveLimiter(payload.type, sendLimiter, rawLimiter);
  if (!limiter(limiterKey)) {
    return { ok: false, error: buildError("RATE_LIMIT", "rate limited") };
  }

  const executed = await executePayload(actions, payload);
  if (!executed) {
    return { ok: false, error: buildError("INVALID_PAYLOAD", "unsupported command payload") };
  }
  if (executed.result.ok) {
    monitor.recordInput(executed.paneId);
  }
  return executed.result as CommandResponse;
};
