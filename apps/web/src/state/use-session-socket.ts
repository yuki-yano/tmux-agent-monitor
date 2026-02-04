import type {
  HighlightCorrectionConfig,
  SessionSummary,
  WsServerMessage,
} from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

import { useSessionSocketHealth } from "./use-session-socket-health";
import { useSessionSocketRequests } from "./use-session-socket-requests";

type UseSessionSocketParams = {
  token: string | null;
  onSessionsSnapshot: (sessions: SessionSummary[]) => void;
  onSessionUpdated: (session: SessionSummary) => void;
  onSessionRemoved: (paneId: string) => void;
  onReadOnly: () => void;
  onConnectionIssue: (message: string | null) => void;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
};

const buildWsUrl = (token: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws?token=${token}`;
};

export const useSessionSocket = ({
  token,
  onSessionsSnapshot,
  onSessionUpdated,
  onSessionRemoved,
  onReadOnly,
  onConnectionIssue,
  onHighlightCorrections,
}: UseSessionSocketParams) => {
  const [wsNonce, setWsNonce] = useState(0);
  const prevReadyStateRef = useRef<ReadyState | null>(null);

  const wsUrl = useMemo(
    () => (token ? `${buildWsUrl(token)}&v=${wsNonce}` : null),
    [token, wsNonce],
  );

  const { sendJsonMessage, lastMessage, readyState, getWebSocket } = useWebSocket(
    wsUrl,
    {
      share: true,
      shouldReconnect: () => true,
      reconnectAttempts: Infinity,
      reconnectInterval: () => 300 + Math.random() * 200,
      retryOnError: true,
      onClose: () => {
        onConnectionIssue("Disconnected. Reconnecting...");
      },
      onError: () => {
        onConnectionIssue("WebSocket error. Reconnecting...");
      },
    },
    Boolean(token),
  );

  const connected = readyState === ReadyState.OPEN;

  const sendPing = useCallback(() => {
    if (!connected) {
      return;
    }
    sendJsonMessage({ type: "client.ping", ts: new Date().toISOString(), data: {} });
  }, [connected, sendJsonMessage]);

  const { markHealthy } = useSessionSocketHealth({
    connected,
    getWebSocket,
    sendPing,
  });

  const { requestScreen, sendText, sendKeys, sendRaw, handleResponseMessage, rejectAllPending } =
    useSessionSocketRequests({
      connected,
      sendJsonMessage,
      onReadOnly,
    });

  useEffect(() => {
    if (connected) {
      markHealthy();
      onConnectionIssue(null);
    }
  }, [connected, markHealthy, onConnectionIssue]);

  const reconnect = useCallback(() => {
    onConnectionIssue("Reconnecting...");
    setWsNonce((prev) => prev + 1);
    try {
      getWebSocket()?.close();
    } catch {
      // ignore reconnect close failures
    }
  }, [getWebSocket, onConnectionIssue]);

  const handleWsMessage = useCallback(
    (message: WsServerMessage) => {
      markHealthy();
      if (message.type === "server.health") {
        const nextHighlight = message.data.clientConfig?.screen?.highlightCorrection;
        if (nextHighlight) {
          onHighlightCorrections(nextHighlight);
        }
        return;
      }
      if (message.type === "sessions.snapshot") {
        onSessionsSnapshot(message.data.sessions);
        return;
      }
      if (message.type === "session.updated") {
        onSessionUpdated(message.data.session);
        return;
      }
      if (message.type === "session.removed") {
        onSessionRemoved(message.data.paneId);
        return;
      }
      handleResponseMessage(message);
    },
    [
      handleResponseMessage,
      markHealthy,
      onHighlightCorrections,
      onSessionRemoved,
      onSessionUpdated,
      onSessionsSnapshot,
    ],
  );

  useEffect(() => {
    if (!lastMessage) {
      return;
    }
    try {
      const parsed = JSON.parse(lastMessage.data) as WsServerMessage;
      handleWsMessage(parsed);
    } catch {
      // ignore invalid messages
    }
  }, [handleWsMessage, lastMessage]);

  useEffect(() => {
    const prev = prevReadyStateRef.current;
    prevReadyStateRef.current = readyState;
    if (prev === ReadyState.OPEN && readyState !== ReadyState.OPEN) {
      rejectAllPending(new Error("WebSocket disconnected"));
    }
  }, [readyState, rejectAllPending]);

  return {
    connected,
    reconnect,
    requestScreen,
    sendText,
    sendKeys,
    sendRaw,
  };
};
