import type {
  CommandResponse,
  RawItem,
  ScreenResponse,
  WsServerMessage,
} from "@vde-monitor/shared";
import { useCallback, useRef } from "react";

type RequestHandler = {
  resolve: (value: ScreenResponse | CommandResponse) => void;
  reject: (error: Error) => void;
};

type UseSessionSocketRequestsParams = {
  connected: boolean;
  sendJsonMessage: (data: Record<string, unknown>) => void;
  onReadOnly: () => void;
};

const createReqId = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `req_${Math.random().toString(16).slice(2)}`;

export const useSessionSocketRequests = ({
  connected,
  sendJsonMessage,
  onReadOnly,
}: UseSessionSocketRequestsParams) => {
  const pending = useRef(new Map<string, RequestHandler>());

  const rejectAllPending = useCallback((error: Error) => {
    pending.current.forEach(({ reject }) => {
      reject(error);
    });
    pending.current.clear();
  }, []);

  const sendWs = useCallback(
    (payload: Record<string, unknown>) => {
      if (!connected) {
        throw new Error("WebSocket not connected");
      }
      sendJsonMessage(payload);
    },
    [connected, sendJsonMessage],
  );

  const sendRequest = useCallback(
    (payload: Record<string, unknown>) => {
      const reqId = createReqId();
      return new Promise<ScreenResponse | CommandResponse>((resolve, reject) => {
        pending.current.set(reqId, { resolve, reject });
        try {
          sendWs({ ...payload, reqId, ts: new Date().toISOString() });
        } catch (err) {
          pending.current.delete(reqId);
          reject(err instanceof Error ? err : new Error("WebSocket not connected"));
        }
      });
    },
    [sendWs],
  );

  const handleResponseMessage = useCallback(
    (message: WsServerMessage) => {
      if (message.type !== "command.response" && message.type !== "screen.response") {
        return;
      }
      if (!message.reqId || !pending.current.has(message.reqId)) {
        return;
      }
      const handler = pending.current.get(message.reqId)!;
      pending.current.delete(message.reqId);
      if ("error" in message.data && message.data.error?.code === "READ_ONLY") {
        onReadOnly();
      }
      handler.resolve(message.data);
    },
    [onReadOnly],
  );

  const requestScreen = useCallback(
    (paneId: string, options: { lines?: number; mode?: "text" | "image"; cursor?: string }) => {
      return sendRequest({
        type: "screen.request",
        data: { paneId, ...options },
      }) as Promise<ScreenResponse>;
    },
    [sendRequest],
  );

  const sendText = useCallback(
    (paneId: string, text: string, enter = true) => {
      return sendRequest({
        type: "send.text",
        data: { paneId, text, enter },
      }) as Promise<CommandResponse>;
    },
    [sendRequest],
  );

  const sendKeys = useCallback(
    (paneId: string, keys: string[]) => {
      return sendRequest({
        type: "send.keys",
        data: { paneId, keys },
      }) as Promise<CommandResponse>;
    },
    [sendRequest],
  );

  const sendRaw = useCallback(
    (paneId: string, items: RawItem[], unsafe = false) => {
      return sendRequest({
        type: "send.raw",
        data: { paneId, items, unsafe },
      }) as Promise<CommandResponse>;
    },
    [sendRequest],
  );

  return {
    requestScreen,
    sendText,
    sendKeys,
    sendRaw,
    handleResponseMessage,
    rejectAllPending,
  };
};
