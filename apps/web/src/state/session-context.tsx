import type {
  CommandResponse,
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffSummary,
  HighlightCorrectionConfig,
  RawItem,
  ScreenResponse,
  SessionDetail,
  SessionSummary,
} from "@vde-monitor/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { useSessionApi } from "./use-session-api";
import { useSessionSocket } from "./use-session-socket";
import { useSessionStore } from "./use-session-store";
import { useSessionToken } from "./use-session-token";

type SessionContextValue = {
  token: string | null;
  sessions: SessionSummary[];
  connected: boolean;
  connectionIssue: string | null;
  readOnly: boolean;
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
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: string[]) => Promise<CommandResponse>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  touchSession: (paneId: string) => Promise<void>;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
  getSessionDetail: (paneId: string) => SessionDetail | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const { token } = useSessionToken();
  const {
    sessions,
    setSessions,
    applySessionsSnapshot,
    updateSession,
    removeSession,
    getSessionDetail,
  } = useSessionStore();
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [highlightCorrections, setHighlightCorrections] = useState<HighlightCorrectionConfig>({
    codex: true,
    claude: true,
  });

  const markReadOnly = useCallback(() => {
    setReadOnly(true);
  }, []);

  const applyHighlightCorrections = useCallback((nextHighlight: HighlightCorrectionConfig) => {
    setHighlightCorrections((prev) => ({ ...prev, ...nextHighlight }));
  }, []);

  const { connected, reconnect, requestScreen, sendText, sendKeys, sendRaw } = useSessionSocket({
    token,
    onSessionsSnapshot: applySessionsSnapshot,
    onSessionUpdated: updateSession,
    onSessionRemoved: removeSession,
    onReadOnly: markReadOnly,
    onConnectionIssue: setConnectionIssue,
    onHighlightCorrections: applyHighlightCorrections,
  });

  const {
    refreshSessions,
    requestDiffSummary,
    requestDiffFile,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
    updateSessionTitle,
    touchSession,
  } = useSessionApi({
    token,
    onSessions: setSessions,
    onConnectionIssue: setConnectionIssue,
    onReadOnly: markReadOnly,
    onSessionUpdated: updateSession,
  });

  useEffect(() => {
    if (connected) {
      refreshSessions();
    }
  }, [connected, refreshSessions]);

  return (
    <SessionContext.Provider
      value={{
        token,
        sessions,
        connected,
        connectionIssue,
        readOnly,
        highlightCorrections,
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
