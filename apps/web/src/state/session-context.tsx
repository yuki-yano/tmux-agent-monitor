import type {
  AllowedKey,
  CommandResponse,
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffSummary,
  HighlightCorrectionConfig,
  ImageAttachment,
  RawItem,
  ScreenResponse,
  SessionDetail,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionSummary,
} from "@vde-monitor/shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { type RefreshSessionsResult, useSessionApi } from "./use-session-api";
import { useSessionStore } from "./use-session-store";
import { useSessionToken } from "./use-session-token";

type SessionContextValue = {
  token: string | null;
  sessions: SessionSummary[];
  connected: boolean;
  connectionStatus: "healthy" | "degraded" | "disconnected";
  connectionIssue: string | null;
  highlightCorrections: HighlightCorrectionConfig;
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
  requestStateTimeline: (
    paneId: string,
    options?: { range?: SessionStateTimelineRange; limit?: number },
  ) => Promise<SessionStateTimeline>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  focusPane: (paneId: string) => Promise<CommandResponse>;
  uploadImageAttachment: (paneId: string, file: File) => Promise<ImageAttachment>;
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: AllowedKey[]) => Promise<CommandResponse>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  touchSession: (paneId: string) => Promise<void>;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
  getSessionDetail: (paneId: string) => SessionDetail | null;
};

const SESSION_POLL_INTERVAL_MS = 1000;
const RATE_LIMIT_BACKOFF_STEP_MS = 5000;
const MAX_RATE_LIMIT_STEPS = 3;

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const { token, apiBaseUrl } = useSessionToken();
  const { sessions, setSessions, updateSession, removeSession, getSessionDetail } =
    useSessionStore();
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [highlightCorrections, setHighlightCorrections] = useState<HighlightCorrectionConfig>({
    codex: true,
    claude: true,
  });
  const [connected, setConnected] = useState(false);
  const [authBlocked, setAuthBlocked] = useState(false);
  const [pollBackoffMs, setPollBackoffMs] = useState(0);
  const backoffStepRef = useRef(0);

  const applyHighlightCorrections = useCallback((nextHighlight: HighlightCorrectionConfig) => {
    setHighlightCorrections((prev) => ({ ...prev, ...nextHighlight }));
  }, []);

  const applyRateLimitBackoff = useCallback(() => {
    const nextStep = Math.min(backoffStepRef.current + 1, MAX_RATE_LIMIT_STEPS);
    if (nextStep === backoffStepRef.current) {
      return;
    }
    backoffStepRef.current = nextStep;
    setPollBackoffMs(nextStep * RATE_LIMIT_BACKOFF_STEP_MS);
  }, []);

  const resetRateLimitBackoff = useCallback(() => {
    if (backoffStepRef.current === 0) {
      return;
    }
    backoffStepRef.current = 0;
    setPollBackoffMs(0);
  }, []);

  const hasToken = Boolean(token);
  const connectionStatus: SessionContextValue["connectionStatus"] =
    !hasToken || authBlocked
      ? "disconnected"
      : connected
        ? pollBackoffMs > 0
          ? "degraded"
          : "healthy"
        : "degraded";

  const {
    refreshSessions: refreshSessionsApi,
    requestDiffSummary,
    requestDiffFile,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
    requestStateTimeline,
    requestScreen,
    focusPane,
    uploadImageAttachment,
    sendText,
    sendKeys,
    sendRaw,
    updateSessionTitle,
    touchSession,
  } = useSessionApi({
    token,
    apiBaseUrl,
    onSessions: setSessions,
    onConnectionIssue: setConnectionIssue,
    onSessionUpdated: updateSession,
    onSessionRemoved: removeSession,
    onHighlightCorrections: applyHighlightCorrections,
  });

  const handleRefreshResult = useCallback(
    (result: RefreshSessionsResult) => {
      if (!result.ok) {
        if (result.authError) {
          setAuthBlocked(true);
        }
        if (result.rateLimited) {
          applyRateLimitBackoff();
          setConnected(true);
        } else {
          setConnected(false);
        }
        return;
      }
      if (authBlocked) {
        setAuthBlocked(false);
      }
      setConnected(true);
      resetRateLimitBackoff();
    },
    [applyRateLimitBackoff, authBlocked, resetRateLimitBackoff],
  );

  const refreshSessions = useCallback(async () => {
    if (!hasToken || authBlocked) {
      return;
    }
    const result = await refreshSessionsApi();
    handleRefreshResult(result);
  }, [authBlocked, handleRefreshResult, hasToken, refreshSessionsApi]);

  const reconnect = useCallback(() => {
    if (!token) return;
    setAuthBlocked(false);
    setConnectionIssue("Reconnecting...");
    void refreshSessions();
  }, [refreshSessions, token]);

  const pollSessions = useCallback(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!hasToken || authBlocked) {
      return;
    }
    void refreshSessions();
  }, [authBlocked, hasToken, refreshSessions]);

  useEffect(() => {
    if (connectionIssue === API_ERROR_MESSAGES.unauthorized) {
      setAuthBlocked(true);
      setConnected(false);
    }
  }, [connectionIssue]);

  useVisibilityPolling({
    enabled: hasToken && !authBlocked,
    intervalMs: SESSION_POLL_INTERVAL_MS + pollBackoffMs,
    onTick: pollSessions,
    onResume: pollSessions,
  });

  useEffect(() => {
    setAuthBlocked(false);
    resetRateLimitBackoff();
    setConnectionIssue(null);
    setConnected(false);
  }, [resetRateLimitBackoff, token]);

  return (
    <SessionContext.Provider
      value={{
        token,
        sessions,
        connected,
        connectionStatus,
        connectionIssue,
        highlightCorrections,
        reconnect,
        refreshSessions,
        requestDiffSummary,
        requestDiffFile,
        requestCommitLog,
        requestCommitDetail,
        requestCommitFile,
        requestStateTimeline,
        requestScreen,
        focusPane,
        uploadImageAttachment,
        sendText,
        sendKeys,
        sendRaw,
        touchSession,
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
