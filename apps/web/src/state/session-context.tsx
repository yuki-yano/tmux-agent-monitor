import type {
  CommandResponse,
  ScreenResponse,
  SessionDetail,
  SessionSummary,
  WsServerMessage,
} from "@agent-monitor/shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

type SessionContextValue = {
  token: string | null;
  sessions: SessionSummary[];
  connected: boolean;
  readOnly: boolean;
  refreshSessions: () => Promise<void>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image" },
  ) => Promise<ScreenResponse>;
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: string[]) => Promise<CommandResponse>;
  getSessionDetail: (paneId: string) => SessionDetail | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const TOKEN_KEY = "agent-monitor-token";
const HEALTH_INTERVAL_MS = 15000;
const HEALTH_TIMEOUT_MS = 45000;

const readTokenFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    params.delete("token");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
  }
  return token;
};

const buildWsUrl = (token: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws?token=${token}`;
};

const createReqId = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `req_${Math.random().toString(16).slice(2)}`;

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const pending = useRef(
    new Map<
      string,
      {
        resolve: (value: ScreenResponse | CommandResponse) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const lastHealthAtRef = useRef<number | null>(null);

  const wsUrl = useMemo(() => (token ? buildWsUrl(token) : null), [token]);

  useEffect(() => {
    const urlToken = readTokenFromUrl();
    if (urlToken && urlToken !== token) {
      setToken(urlToken);
    }
  }, [token]);

  const refreshSessions = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { sessions: SessionSummary[] };
    setSessions(data.sessions);
  }, [token]);

  const updateSession = useCallback((session: SessionSummary) => {
    setSessions((prev) => {
      const index = prev.findIndex((item) => item.paneId === session.paneId);
      if (index === -1) {
        return [...prev, session];
      }
      const next = [...prev];
      next[index] = session;
      return next;
    });
  }, []);

  const removeSession = useCallback((paneId: string) => {
    setSessions((prev) => prev.filter((item) => item.paneId !== paneId));
  }, []);

  const handleWsMessage = useCallback(
    (message: WsServerMessage) => {
      lastHealthAtRef.current = Date.now();
      if (message.type === "server.health") {
        return;
      }
      if (message.type === "sessions.snapshot") {
        setSessions(message.data.sessions);
        return;
      }
      if (message.type === "session.updated") {
        updateSession(message.data.session);
        return;
      }
      if (message.type === "session.removed") {
        removeSession(message.data.paneId);
        return;
      }
      if (message.type === "command.response" || message.type === "screen.response") {
        if (message.reqId && pending.current.has(message.reqId)) {
          const handler = pending.current.get(message.reqId)!;
          pending.current.delete(message.reqId);
          if ("error" in message.data && message.data.error?.code === "READ_ONLY") {
            setReadOnly(true);
          }
          handler.resolve(message.data);
        }
      }
    },
    [removeSession, updateSession],
  );

  const { sendJsonMessage, lastMessage, readyState, getWebSocket } = useWebSocket(
    wsUrl,
    {
      share: true,
      shouldReconnect: () => true,
      reconnectAttempts: Infinity,
      reconnectInterval: (attempt) => Math.min(10000, 500 * 2 ** attempt + Math.random() * 300),
      retryOnError: true,
      onOpen: () => {
        lastHealthAtRef.current = Date.now();
      },
      onClose: () => {
        pending.current.forEach(({ reject }) => {
          reject(new Error("WebSocket disconnected"));
        });
        pending.current.clear();
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
    if (connected) {
      refreshSessions();
    }
  }, [connected, refreshSessions]);

  const ensureFreshConnection = useCallback(() => {
    if (!connected) {
      return;
    }
    const lastHealth = lastHealthAtRef.current;
    if (lastHealth && Date.now() - lastHealth > HEALTH_TIMEOUT_MS) {
      getWebSocket()?.close();
      return;
    }
    sendPing();
  }, [connected, getWebSocket, sendPing]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        ensureFreshConnection();
      }
    };
    const handleFocus = () => {
      ensureFreshConnection();
    };
    const handleOnline = () => {
      ensureFreshConnection();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted || document.visibilityState === "visible") {
        ensureFreshConnection();
      }
    };

    window.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [ensureFreshConnection]);

  useEffect(() => {
    if (!connected) return;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      const lastHealth = lastHealthAtRef.current;
      if (lastHealth && Date.now() - lastHealth > HEALTH_TIMEOUT_MS) {
        getWebSocket()?.close();
        return;
      }
      sendPing();
    }, HEALTH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, getWebSocket, sendPing]);

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
        sendWs({ ...payload, reqId, ts: new Date().toISOString() });
      });
    },
    [sendWs],
  );

  const requestScreen = useCallback(
    (paneId: string, options: { lines?: number; mode?: "text" | "image" }) => {
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

  const getSessionDetail = useCallback(
    (paneId: string) => {
      const session = sessions.find((item) => item.paneId === paneId);
      return session ? (session as SessionDetail) : null;
    },
    [sessions],
  );

  return (
    <SessionContext.Provider
      value={{
        token,
        sessions,
        connected,
        readOnly,
        refreshSessions,
        requestScreen,
        sendText,
        sendKeys,
        getSessionDetail,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSessions = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("SessionContext not found");
  }
  return context;
};
