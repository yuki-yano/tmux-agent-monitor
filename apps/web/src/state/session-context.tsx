import type {
  AllowedKey,
  BranchList,
  ClientCapabilities,
  ClientFileNavigatorConfig,
  CommandResponse,
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffMode,
  DiffSummary,
  HighlightCorrectionConfig,
  ImageAttachment,
  LaunchCommandResponse,
  LaunchConfig,
  PromptCompletionResult,
  PromptCompletionTrigger,
  RawItem,
  RepoFileContent,
  RepoFileSearchPage,
  RepoFileTreePage,
  RepoNote,
  ScreenResponse,
  SessionDetail,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
  SessionSummary,
  WorktreeList,
} from "@vde-monitor/shared";
import { Provider as JotaiProvider, createStore, useAtomValue, useSetAtom } from "jotai";
import type { Context, ReactNode } from "react";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import {
  buildNotificationSessionTitleFingerprint,
  syncLocalNotificationSessionTitles,
  toNotificationSessionTitleEntries,
} from "@/lib/notification-session-title-store";

import { type LaunchAgentRequestOptions, defaultLaunchConfig } from "./launch-agent-options";
import {
  type SessionConnectionStatus,
  sessionCapabilitiesAtom,
  sessionFileNavigatorConfigAtom,
  sessionHighlightCorrectionsAtom,
  sessionLaunchConfigAtom,
  sessionWorkspaceTabsDisplayModeAtom,
} from "./session-state-atoms";
import { useSessionApi as useSessionApiHook } from "./use-session-api";
import { useSessionConnectionState } from "./use-session-connection-state";
import { useSessionPolling } from "./use-session-polling";
import { useSessionStore } from "./use-session-store";
import { useSessionToken } from "./use-session-token";
import { useSessionsStream } from "./use-sessions-stream";
import type { SessionsStreamTransport } from "./use-sessions-stream";

// ---------------------------------------------------------------------------
// Domain split rationale (T9)
//
// The former single SessionDataContext + SessionApiContext pair carried 45
// fields and forced every consumer (AuthGate, push notifications, workspace
// tabs, session list/chat-grid/usage VMs, session detail) to re-render on any
// field change, even fields it never read. Two axes drove this split:
//
//  1. Data vs. API: data fields mutate at very different frequencies (sessions
//     stream on every SSE tick; token/config barely change), while API
//     functions are effectively stable references (they only change identity
//     when the underlying apiClient/token changes). Keeping data and API in
//     separate contexts means a sessions update no longer invalidates the
//     (stable) API function objects for unrelated consumers.
//  2. Consumption clusters measured from actual call sites (see the
//     implementation-plan doc for the full table): AuthGate only needs
//     auth/config; push notifications need token/apiBaseUrl/authError;
//     workspace tabs need only the live sessions list; ChatGridTile needs a
//     handful of pane-action functions; the list/grid/usage VMs need a
//     recurring cluster of stream data + core actions + branches(worktrees)
//     + launch; SessionDetail alone needs virtually everything, matching
//     its role as the single "does it all" page-level consumer.
//
// Result: 2 data contexts (stream / config) + 5 API contexts (core /
// branches-commits-diffs / files / notes / launch), matching the plan's
// initial 5-way API split, confirmed against measured consumption.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data contexts — reactive fields; consumers re-render when these change
// ---------------------------------------------------------------------------

/** High-frequency data: the live session list and its connection/stream state. */
export type SessionStreamDataContextValue = {
  sessions: SessionSummary[];
  connected: boolean;
  hasLoadedInitialSessions: boolean;
  connectionStatus: SessionConnectionStatus;
  connectionIssue: string | null;
  transport: SessionsStreamTransport;
  getSessionDetail: (paneId: string) => SessionDetail | null;
};

/** Low-frequency data: auth/token state and server-provided client config. */
export type SessionConfigDataContextValue = {
  token: string | null;
  apiBaseUrl: string | null;
  authError: string | null;
  highlightCorrections: HighlightCorrectionConfig;
  fileNavigatorConfig: ClientFileNavigatorConfig;
  launchConfig: LaunchConfig;
  capabilities: ClientCapabilities;
};

// ---------------------------------------------------------------------------
// API contexts — stable method references; identity does not change on data updates
// ---------------------------------------------------------------------------

/** Core session lifecycle/interaction: connection, screen, messaging, pane control. */
export type SessionCoreApiContextValue = {
  setToken: (token: string | null) => Promise<boolean>;
  reconnect: () => void;
  refreshSessions: () => Promise<void>;
  requestPromptCompletions: (
    paneId: string,
    trigger: PromptCompletionTrigger,
    query?: string,
  ) => Promise<PromptCompletionResult>;
  requestStateTimeline: (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
  ) => Promise<SessionStateTimeline>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  focusPane: (paneId: string) => Promise<CommandResponse>;
  killPane: (paneId: string) => Promise<CommandResponse>;
  killWindow: (paneId: string) => Promise<CommandResponse>;
  uploadImageAttachment: (paneId: string, file: File) => Promise<ImageAttachment>;
  sendText: (
    paneId: string,
    text: string,
    enter?: boolean,
    requestId?: string,
  ) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: AllowedKey[]) => Promise<CommandResponse>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  touchSession: (paneId: string) => Promise<void>;
  moveSessionToTop: (paneId: string) => Promise<void>;
  acknowledgeSessionView: (paneId: string, epoch: string, throughSeq: number) => Promise<void>;
  updateSessionTitle: (paneId: string, title: string | null) => Promise<void>;
  resetSessionTitle: (paneId: string) => Promise<void>;
};

/** Worktrees/branches/commits/diffs — the repo-history exploration surface. */
export type SessionBranchesApiContextValue = {
  requestWorktrees: (paneId: string) => Promise<WorktreeList>;
  requestBranches: (paneId: string, options?: { force?: boolean }) => Promise<BranchList>;
  requestBranchCheckout: (paneId: string, branch: string) => Promise<void>;
  requestBranchCreate: (paneId: string, name: string, base?: string) => Promise<void>;
  requestBranchDelete: (
    paneId: string,
    name: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  requestDiffSummary: (
    paneId: string,
    options: { mode: DiffMode; force?: boolean; worktreePath?: string; branch?: string },
  ) => Promise<DiffSummary>;
  requestDiffFile: (
    paneId: string,
    path: string,
    rev: string | null | undefined,
    options: { mode: DiffMode; force?: boolean; worktreePath?: string; branch?: string },
  ) => Promise<DiffFile>;
  requestCommitLog: (
    paneId: string,
    options?: {
      limit?: number;
      skip?: number;
      force?: boolean;
      worktreePath?: string;
      branch?: string;
    },
  ) => Promise<CommitLog>;
  requestCommitDetail: (
    paneId: string,
    hash: string,
    options?: { force?: boolean; worktreePath?: string },
  ) => Promise<CommitDetail>;
  requestCommitFile: (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean; worktreePath?: string },
  ) => Promise<CommitFileDiff>;
};

/** Repo file navigator surface. */
export type SessionFilesApiContextValue = {
  requestRepoFileTree: (
    paneId: string,
    options?: { path?: string; cursor?: string; limit?: number; worktreePath?: string },
  ) => Promise<RepoFileTreePage>;
  requestRepoFileSearch: (
    paneId: string,
    query: string,
    options?: {
      cursor?: string;
      limit?: number;
      worktreePath?: string;
      exactReference?: boolean;
    },
  ) => Promise<RepoFileSearchPage>;
  requestRepoFileContent: (
    paneId: string,
    path: string,
    options?: { maxBytes?: number; worktreePath?: string },
  ) => Promise<RepoFileContent>;
  revokeRepoFilePreview: (paneId: string, token: string) => Promise<void>;
};

/** Repo notes CRUD. */
export type SessionNotesApiContextValue = {
  requestRepoNotes: (paneId: string) => Promise<RepoNote[]>;
  createRepoNote: (
    paneId: string,
    input: { title?: string | null; body: string },
  ) => Promise<RepoNote>;
  updateRepoNote: (
    paneId: string,
    noteId: string,
    input: { title?: string | null; body: string },
  ) => Promise<RepoNote>;
  deleteRepoNote: (paneId: string, noteId: string) => Promise<string>;
};

/** Agent launch — kept separate: broadly consumed (list/grid/usage VMs) yet
 * conceptually distinct (worktree-creation options, longer request timeout). */
export type SessionLaunchApiContextValue = {
  launchAgentInSession: (
    sessionName: string,
    agent: "codex" | "claude",
    requestId: string,
    options?: LaunchAgentRequestOptions,
  ) => Promise<LaunchCommandResponse>;
};

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const SessionStreamDataContext = createContext<SessionStreamDataContextValue | null>(null);
const SessionConfigDataContext = createContext<SessionConfigDataContextValue | null>(null);
const SessionCoreApiContext = createContext<SessionCoreApiContextValue | null>(null);
const SessionBranchesApiContext = createContext<SessionBranchesApiContextValue | null>(null);
const SessionFilesApiContext = createContext<SessionFilesApiContextValue | null>(null);
const SessionNotesApiContext = createContext<SessionNotesApiContextValue | null>(null);
const SessionLaunchApiContext = createContext<SessionLaunchApiContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

const SessionRuntime = ({ children }: { children: ReactNode }) => {
  const { token, setToken, apiBaseUrl } = useSessionToken();
  const { sessions, setSessions, updateSession, removeSession, getSessionDetail } =
    useSessionStore();
  const highlightCorrections = useAtomValue(sessionHighlightCorrectionsAtom);
  const fileNavigatorConfig = useAtomValue(sessionFileNavigatorConfigAtom);
  const launchConfig = useAtomValue(sessionLaunchConfigAtom);
  const capabilities = useAtomValue(sessionCapabilitiesAtom);
  const setHighlightCorrections = useSetAtom(sessionHighlightCorrectionsAtom);
  const setFileNavigatorConfig = useSetAtom(sessionFileNavigatorConfigAtom);
  const setWorkspaceTabsDisplayMode = useSetAtom(sessionWorkspaceTabsDisplayModeAtom);
  const setLaunchConfig = useSetAtom(sessionLaunchConfigAtom);
  const setCapabilities = useSetAtom(sessionCapabilitiesAtom);
  const {
    connectionIssue,
    setConnectionIssue,
    connected,
    hasLoadedInitialSessions,
    authBlocked,
    pollBackoffMs,
    connectionStatus,
    transport,
    setTransport,
    markSessionsSnapshotReceived,
    handleRefreshResult: handleRefreshResultFromConnection,
    reconnect: reconnectWithConnectionState,
  } = useSessionConnectionState(token);

  const applyHighlightCorrections = useCallback(
    (nextHighlight: HighlightCorrectionConfig) => {
      setHighlightCorrections((prev) => ({ ...prev, ...nextHighlight }));
    },
    [setHighlightCorrections],
  );

  const hasToken = Boolean(token);
  const authError = !hasToken
    ? API_ERROR_MESSAGES.missingToken
    : connectionIssue != null && /unauthorized/i.test(connectionIssue)
      ? connectionIssue
      : null;
  const notificationTitleFingerprintRef = useRef<string>("");

  const {
    core: coreApi,
    branches: branchesApi,
    files: filesApi,
    notes: notesApi,
    launch: launchApi,
  } = useSessionApiHook({
    token,
    apiBaseUrl,
    onSessions: setSessions,
    onConnectionIssue: setConnectionIssue,
    onSessionUpdated: updateSession,
    onSessionRemoved: removeSession,
    onHighlightCorrections: applyHighlightCorrections,
    onFileNavigatorConfig: setFileNavigatorConfig,
    onWorkspaceTabsDisplayMode: setWorkspaceTabsDisplayMode,
    onLaunchConfig: setLaunchConfig,
    onCapabilities: setCapabilities,
  });

  const refreshSessions = useCallback(async () => {
    if (!hasToken || authBlocked) {
      return;
    }
    const result = await coreApi.refreshSessions();
    handleRefreshResultFromConnection(result);
  }, [authBlocked, coreApi, handleRefreshResultFromConnection, hasToken]);

  const reconnect = useCallback(() => {
    reconnectWithConnectionState(refreshSessions);
  }, [reconnectWithConnectionState, refreshSessions]);

  const handleSessionsSnapshot = useCallback(
    (nextSessions: SessionSummary[]) => {
      markSessionsSnapshotReceived();
      setSessions(nextSessions);
    },
    [markSessionsSnapshotReceived, setSessions],
  );

  useSessionsStream({
    enabled: hasToken && !authBlocked,
    apiBaseUrl,
    token,
    onSnapshot: handleSessionsSnapshot,
    onUpsert: updateSession,
    onRemove: removeSession,
    onAuthError: () => {
      setConnectionIssue(API_ERROR_MESSAGES.unauthorized);
    },
    onTransportChange: setTransport,
  });

  // Polling is the fallback: it runs only when SSE is not open.
  // It also fires the initial REST fetch on mount (before SSE connects).
  useSessionPolling({
    enabled: hasToken && !authBlocked && transport !== "sse",
    pollBackoffMs,
    refreshSessions,
  });

  useEffect(() => {
    setFileNavigatorConfig({ autoExpandMatchLimit: 100 });
    setWorkspaceTabsDisplayMode("all");
    setLaunchConfig(defaultLaunchConfig);
    setCapabilities({ screenImage: false, launchAgent: false, resumeAgent: false });
  }, [
    setCapabilities,
    setFileNavigatorConfig,
    setLaunchConfig,
    setWorkspaceTabsDisplayMode,
    token,
  ]);

  useEffect(() => {
    if (!hasToken) {
      notificationTitleFingerprintRef.current = "";
      return;
    }
    const nextEntries = toNotificationSessionTitleEntries(sessions);
    const nextFingerprint = buildNotificationSessionTitleFingerprint(nextEntries);
    if (notificationTitleFingerprintRef.current === nextFingerprint) {
      return;
    }
    notificationTitleFingerprintRef.current = nextFingerprint;
    void syncLocalNotificationSessionTitles(nextEntries).catch(() => undefined);
  }, [hasToken, sessions]);

  // Stable API contexts — memoized per domain so identity only changes when
  // that domain's own deps change, not on every data update (sessions, connected, etc.)
  // Each namespace from useSessionApiHook (`coreApi`/`branchesApi`/etc.) is
  // already memoized 1:1 against its own dependencies, so branches/files/
  // notes/launch pass straight through; core layers in the 3 fields
  // (setToken/reconnect/refreshSessions) that live outside useSessionApiHook.
  const sessionCoreApiValue = useMemo<SessionCoreApiContextValue>(
    () => ({
      ...coreApi,
      setToken,
      reconnect,
      refreshSessions,
    }),
    [coreApi, setToken, reconnect, refreshSessions],
  );

  const sessionBranchesApiValue = branchesApi;
  const sessionFilesApiValue = filesApi;
  const sessionNotesApiValue = notesApi;
  const sessionLaunchApiValue = launchApi;

  // Data contexts — split by update frequency: stream data changes on every
  // sessions update (SSE/polling); config data changes only on auth/config events.
  const sessionStreamDataValue = useMemo<SessionStreamDataContextValue>(
    () => ({
      sessions,
      connected,
      hasLoadedInitialSessions,
      connectionStatus,
      connectionIssue,
      transport,
      getSessionDetail,
    }),
    [
      sessions,
      connected,
      hasLoadedInitialSessions,
      connectionStatus,
      connectionIssue,
      transport,
      getSessionDetail,
    ],
  );

  const sessionConfigDataValue = useMemo<SessionConfigDataContextValue>(
    () => ({
      token,
      apiBaseUrl,
      authError,
      highlightCorrections,
      fileNavigatorConfig,
      launchConfig,
      capabilities,
    }),
    [
      token,
      apiBaseUrl,
      authError,
      highlightCorrections,
      fileNavigatorConfig,
      launchConfig,
      capabilities,
    ],
  );

  return (
    <SessionStreamDataContext.Provider value={sessionStreamDataValue}>
      <SessionConfigDataContext.Provider value={sessionConfigDataValue}>
        <SessionCoreApiContext.Provider value={sessionCoreApiValue}>
          <SessionBranchesApiContext.Provider value={sessionBranchesApiValue}>
            <SessionFilesApiContext.Provider value={sessionFilesApiValue}>
              <SessionNotesApiContext.Provider value={sessionNotesApiValue}>
                <SessionLaunchApiContext.Provider value={sessionLaunchApiValue}>
                  {children}
                </SessionLaunchApiContext.Provider>
              </SessionNotesApiContext.Provider>
            </SessionFilesApiContext.Provider>
          </SessionBranchesApiContext.Provider>
        </SessionCoreApiContext.Provider>
      </SessionConfigDataContext.Provider>
    </SessionStreamDataContext.Provider>
  );
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [store] = useState(createStore);

  return (
    <JotaiProvider store={store}>
      <SessionRuntime>{children}</SessionRuntime>
    </JotaiProvider>
  );
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const useRequiredContext = <T,>(context: Context<T | null>): T => {
  const value = use(context);
  if (value == null) {
    throw new Error("SessionProvider is required");
  }
  return value;
};

/** High-frequency: live sessions list + connection/stream status. */
export const useSessionStreamData = (): SessionStreamDataContextValue =>
  useRequiredContext(SessionStreamDataContext);

/** Low-frequency: auth/token state and server-provided client config. */
export const useSessionConfigData = (): SessionConfigDataContextValue =>
  useRequiredContext(SessionConfigDataContext);

/** Core session lifecycle/interaction API (connection, screen, messaging, pane control). */
export const useSessionCoreApi = (): SessionCoreApiContextValue =>
  useRequiredContext(SessionCoreApiContext);

/** Worktrees/branches/commits/diffs API. */
export const useSessionBranchesApi = (): SessionBranchesApiContextValue =>
  useRequiredContext(SessionBranchesApiContext);

/** Repo file navigator API. */
export const useSessionFilesApi = (): SessionFilesApiContextValue =>
  useRequiredContext(SessionFilesApiContext);

/** Repo notes CRUD API. */
export const useSessionNotesApi = (): SessionNotesApiContextValue =>
  useRequiredContext(SessionNotesApiContext);

/** Agent launch API. */
export const useSessionLaunchApi = (): SessionLaunchApiContextValue =>
  useRequiredContext(SessionLaunchApiContext);
