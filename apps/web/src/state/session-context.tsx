import type {
  CommandResponse,
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffSummary,
  ScreenResponse,
  SessionDetail,
  SessionSummary,
  WsServerMessage,
} from "@tmux-agent-monitor/shared";
import { encodePaneId } from "@tmux-agent-monitor/shared";
import { hc } from "hono/client";
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

import type { ApiAppType } from "../../../server/src/app";

type SessionContextValue = {
  token: string | null;
  sessions: SessionSummary[];
  connected: boolean;
  connectionIssue: string | null;
  readOnly: boolean;
  reconnect: () => void;
  refreshSessions: () => Promise<void>;
  requestDiffSummary: (paneId: string, options?: { force?: boolean }) => Promise<DiffSummary>;
  requestDiffFile: (
    paneId: string,
    path: string,
    rev?: string | null,
    options?: { force?: boolean },
  ) => Promise<DiffFile>;
  requestCommitLog: (
    paneId: string,
    options?: { limit?: number; skip?: number; force?: boolean },
  ) => Promise<CommitLog>;
  requestCommitDetail: (
    paneId: string,
    hash: string,
    options?: { force?: boolean },
  ) => Promise<CommitDetail>;
  requestCommitFile: (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean },
  ) => Promise<CommitFileDiff>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image" },
  ) => Promise<ScreenResponse>;
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: string[]) => Promise<CommandResponse>;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
  getSessionDetail: (paneId: string) => SessionDetail | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const TOKEN_KEY = "tmux-agent-monitor-token";
const HEALTH_INTERVAL_MS = 5000;
const HEALTH_TIMEOUT_MS = 10000;

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
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [wsNonce, setWsNonce] = useState(0);
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

  const wsUrl = useMemo(
    () => (token ? `${buildWsUrl(token)}&v=${wsNonce}` : null),
    [token, wsNonce],
  );
  const authHeaders = useMemo(
    (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const apiClient = useMemo(
    () =>
      hc<ApiAppType>("/api", {
        headers: authHeaders,
      }),
    [authHeaders],
  );

  useEffect(() => {
    const urlToken = readTokenFromUrl();
    if (urlToken && urlToken !== token) {
      setToken(urlToken);
    }
  }, [token]);

  const refreshSessions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiClient.sessions.$get();
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        if (res.status === 401 || res.status === 403) {
          message = "Unauthorized. Please refresh with a valid token.";
        } else {
          try {
            const data = (await res.json()) as { error?: { message?: string } };
            if (data.error?.message) {
              message = data.error.message;
            }
          } catch {
            // ignore response parse failures
          }
        }
        setConnectionIssue(message);
        return;
      }
      const data = (await res.json()) as { sessions: SessionSummary[] };
      setSessions(data.sessions);
      setConnectionIssue(null);
    } catch (err) {
      setConnectionIssue(err instanceof Error ? err.message : "Network error. Reconnecting...");
    }
  }, [apiClient, token]);

  const requestDiffSummary = useCallback(
    async (paneId: string, options?: { force?: boolean }) => {
      if (!token) {
        throw new Error("Missing token");
      }
      const param = { paneId: encodePaneId(paneId) };
      const query = options?.force ? { force: "1" } : {};
      const res = await apiClient.sessions[":paneId"].diff.$get({ param, query });
      const data = (await res.json()) as { summary?: DiffSummary; error?: { message?: string } };
      if (!res.ok || !data.summary) {
        throw new Error(data.error?.message ?? "Failed to load diff summary");
      }
      return data.summary;
    },
    [apiClient, token],
  );

  const requestDiffFile = useCallback(
    async (
      paneId: string,
      filePath: string,
      rev?: string | null,
      options?: { force?: boolean },
    ) => {
      if (!token) {
        throw new Error("Missing token");
      }
      const param = { paneId: encodePaneId(paneId) };
      const query: { path: string; rev?: string; force?: string } = { path: filePath };
      if (rev) {
        query.rev = rev;
      }
      if (options?.force) {
        query.force = "1";
      }
      const res = await apiClient.sessions[":paneId"].diff.file.$get({ param, query });
      const data = (await res.json()) as { file?: DiffFile; error?: { message?: string } };
      if (!res.ok || !data.file) {
        throw new Error(data.error?.message ?? "Failed to load diff file");
      }
      return data.file;
    },
    [apiClient, token],
  );

  const requestCommitLog = useCallback(
    async (paneId: string, options?: { limit?: number; skip?: number; force?: boolean }) => {
      if (!token) {
        throw new Error("Missing token");
      }
      const param = { paneId: encodePaneId(paneId) };
      const query: { limit?: string; skip?: string; force?: string } = {};
      if (options?.limit) {
        query.limit = String(options.limit);
      }
      if (options?.skip) {
        query.skip = String(options.skip);
      }
      if (options?.force) {
        query.force = "1";
      }
      const res = await apiClient.sessions[":paneId"].commits.$get({ param, query });
      const data = (await res.json()) as { log?: CommitLog; error?: { message?: string } };
      if (!res.ok || !data.log) {
        throw new Error(data.error?.message ?? "Failed to load commit log");
      }
      return data.log;
    },
    [apiClient, token],
  );

  const requestCommitDetail = useCallback(
    async (paneId: string, hash: string, options?: { force?: boolean }) => {
      if (!token) {
        throw new Error("Missing token");
      }
      const param = { paneId: encodePaneId(paneId), hash };
      const query = options?.force ? { force: "1" } : {};
      const res = await apiClient.sessions[":paneId"].commits[":hash"].$get({ param, query });
      const data = (await res.json()) as { commit?: CommitDetail; error?: { message?: string } };
      if (!res.ok || !data.commit) {
        throw new Error(data.error?.message ?? "Failed to load commit detail");
      }
      return data.commit;
    },
    [apiClient, token],
  );

  const requestCommitFile = useCallback(
    async (paneId: string, hash: string, path: string, options?: { force?: boolean }) => {
      if (!token) {
        throw new Error("Missing token");
      }
      const param = { paneId: encodePaneId(paneId), hash };
      const query: { path: string; force?: string } = { path };
      if (options?.force) {
        query.force = "1";
      }
      const res = await apiClient.sessions[":paneId"].commits[":hash"].file.$get({
        param,
        query,
      });
      const data = (await res.json()) as {
        file?: CommitFileDiff;
        error?: { message?: string };
      };
      if (!res.ok || !data.file) {
        throw new Error(data.error?.message ?? "Failed to load commit file");
      }
      return data.file;
    },
    [apiClient, token],
  );

  const updateSession = useCallback((session: SessionSummary) => {
    setSessions((prev) => {
      const next = new Map<string, SessionSummary>();
      prev.forEach((item) => next.set(item.paneId, item));
      next.set(session.paneId, session);
      return Array.from(next.values());
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
        const unique = new Map<string, SessionSummary>();
        message.data.sessions.forEach((session) => {
          unique.set(session.paneId, session);
        });
        setSessions(Array.from(unique.values()));
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
      reconnectInterval: () => 300 + Math.random() * 200,
      retryOnError: true,
      onOpen: () => {
        lastHealthAtRef.current = Date.now();
        setConnectionIssue(null);
      },
      onClose: () => {
        pending.current.forEach(({ reject }) => {
          reject(new Error("WebSocket disconnected"));
        });
        pending.current.clear();
        setConnectionIssue("Disconnected. Reconnecting...");
      },
      onError: () => {
        setConnectionIssue("WebSocket error. Reconnecting...");
      },
    },
    Boolean(token),
  );

  const connected = readyState === ReadyState.OPEN;
  const reconnect = useCallback(() => {
    setConnectionIssue("Reconnecting...");
    setWsNonce((prev) => prev + 1);
    try {
      getWebSocket()?.close();
    } catch {
      // ignore reconnect close failures
    }
  }, [getWebSocket]);

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

  const updateSessionTitle = useCallback(
    async (paneId: string, title: string | null) => {
      if (!token) {
        throw new Error("Missing token");
      }
      const res = await apiClient.sessions[":paneId"].title.$put({
        param: { paneId: encodePaneId(paneId) },
        json: { title },
      });
      let data: { session?: SessionSummary; error?: { message?: string; code?: string } } = {};
      try {
        data = (await res.json()) as {
          session?: SessionSummary;
          error?: { message?: string; code?: string };
        };
      } catch {
        // ignore parse failures
      }
      if (!res.ok) {
        if (data.error?.code === "READ_ONLY") {
          setReadOnly(true);
        }
        throw new Error(data.error?.message ?? "Failed to update title");
      }
      if (data.session) {
        updateSession(data.session);
        return;
      }
      await refreshSessions();
    },
    [apiClient, refreshSessions, token, updateSession],
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
        connectionIssue,
        readOnly,
        reconnect,
        refreshSessions,
        requestDiffSummary,
        requestDiffFile,
        requestCommitLog,
        requestCommitDetail,
        requestCommitFile,
        requestScreen,
        sendText,
        sendKeys,
        updateSessionTitle,
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
