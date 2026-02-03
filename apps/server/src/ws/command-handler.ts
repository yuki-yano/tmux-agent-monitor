import type {
  AgentMonitorConfig,
  CommandResponse,
  WsClientMessage,
  WsServerMessage,
} from "@vde-monitor/shared";

import { buildError } from "../http/helpers.js";
import type { createSessionMonitor } from "../monitor.js";
import type { createTmuxActions } from "../tmux-actions.js";
import { buildEnvelope } from "./envelope.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type TmuxActions = ReturnType<typeof createTmuxActions>;
type CommandLimiter = (key: string) => boolean;
type CommandMessage = Extract<WsClientMessage, { type: "send.text" | "send.keys" }>;
type SendMessage = (message: WsServerMessage) => void;

type CommandHandlerArgs = {
  config: AgentMonitorConfig;
  monitor: Monitor;
  tmuxActions: TmuxActions;
  message: CommandMessage;
  reqId?: string;
  sendLimiter: CommandLimiter;
  send: SendMessage;
};

export const handleCommandMessage = async ({
  config,
  monitor,
  tmuxActions,
  message,
  reqId,
  sendLimiter,
  send,
}: CommandHandlerArgs) => {
  const sendResponse = (response: CommandResponse) => {
    send(buildEnvelope("command.response", response, reqId));
  };

  if (config.readOnly) {
    sendResponse({ ok: false, error: buildError("READ_ONLY", "read-only mode") });
    return;
  }

  const clientKey = "ws";
  if (!sendLimiter(clientKey)) {
    sendResponse({ ok: false, error: buildError("RATE_LIMIT", "rate limited") });
    return;
  }

  if (message.type === "send.text") {
    const result = await tmuxActions.sendText(
      message.data.paneId,
      message.data.text,
      message.data.enter ?? true,
    );
    if (result.ok) {
      monitor.recordInput(message.data.paneId);
    }
    sendResponse(result as CommandResponse);
    return;
  }

  if (message.type === "send.keys") {
    const result = await tmuxActions.sendKeys(message.data.paneId, message.data.keys);
    if (result.ok) {
      monitor.recordInput(message.data.paneId);
    }
    sendResponse(result as CommandResponse);
  }
};
