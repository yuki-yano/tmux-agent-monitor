import {
  type ApiEnvelope,
  type ApiError,
  type ClientCapabilities,
  type ClientFileNavigatorConfig,
  type CommandResponse,
  type HighlightCorrectionConfig,
  type LaunchCommandResponse,
  type LaunchConfig,
  type ScreenResponse,
  type SessionSummary,
  type WorkspaceTabsDisplayMode,
} from "@vde-monitor/shared";
import { useCallback, useMemo, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import { createSessionActionRequests } from "./session-api-action-requests";
import { createApiClient } from "./session-api-contract";
import { createSessionQueryRequests } from "./session-api-query-requests";
import {
  mutateSession as executeMutateSession,
  refreshSessions as executeRefreshSessions,
  requestCommand as executeRequestCommand,
  requestLaunchCommand as executeRequestLaunchCommand,
  requestSessionField as executeRequestSessionField,
} from "./session-api-request-executors";
import { createSessionScreenRequest } from "./session-api-screen-request";
import {
  type RefreshSessionsResult,
  buildPaneHashParam,
  buildPaneNoteParam,
  buildPaneParam,
} from "./session-api-utils";

type UseSessionApiParams = {
  token: string | null;
  apiBaseUrl?: string | null;
  onSessions: (sessions: SessionSummary[]) => void;
  onConnectionIssue: (message: string | null) => void;
  onSessionUpdated: (session: SessionSummary) => void;
  onSessionRemoved: (paneId: string) => void;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
  onFileNavigatorConfig: (config: ClientFileNavigatorConfig) => void;
  onWorkspaceTabsDisplayMode?: (displayMode: WorkspaceTabsDisplayMode) => void;
  onLaunchConfig?: (config: LaunchConfig) => void;
  onCapabilities?: (capabilities: ClientCapabilities) => void;
};

type PaneParam = ReturnType<typeof buildPaneParam>;
type PaneHashParam = ReturnType<typeof buildPaneHashParam>;
type NoteIdParam = ReturnType<typeof buildPaneNoteParam>;

export type { RefreshSessionsResult } from "./session-api-utils";

export const useSessionApi = ({
  token,
  apiBaseUrl,
  onSessions,
  onConnectionIssue,
  onSessionUpdated,
  onSessionRemoved,
  onHighlightCorrections,
  onFileNavigatorConfig,
  onWorkspaceTabsDisplayMode,
  onLaunchConfig,
  onCapabilities,
}: UseSessionApiParams) => {
  const ensureToken = useCallback(() => {
    if (!token) {
      throw new Error(API_ERROR_MESSAGES.missingToken);
    }
  }, [token]);

  const buildApiError = useCallback(
    (code: ApiError["code"], message: string): ApiError => ({ code, message }),
    [],
  );

  const isPaneMissingError = useCallback((error?: ApiError | null) => {
    if (!error) return false;
    if (error.code === "INVALID_PANE") return true;
    return error.code === "NOT_FOUND" && error.message === "pane not found";
  }, []);

  const handleSessionMissing = useCallback(
    (paneId: string, res: Response, data: ApiEnvelope<unknown> | null) => {
      if (isPaneMissingError(data?.error) || res.status === 410) {
        onSessionRemoved(paneId);
      }
    },
    [isPaneMissingError, onSessionRemoved],
  );

  const authHeaders = useMemo(
    (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const apiBasePath = useMemo(() => {
    const normalized = apiBaseUrl?.trim();
    return normalized && normalized.length > 0 ? normalized : "/api";
  }, [apiBaseUrl]);
  const apiClient = useMemo(
    () => createApiClient(apiBasePath, authHeaders),
    [apiBasePath, authHeaders],
  );
  const [screenInFlightMap] = useState(() => new Map<string, Promise<ScreenResponse>>());

  const refreshSessions = useCallback(async (): Promise<RefreshSessionsResult> => {
    return executeRefreshSessions({
      token,
      request: apiClient.sessions.$get(),
      onSessions,
      onConnectionIssue,
      onHighlightCorrections,
      onFileNavigatorConfig,
      onWorkspaceTabsDisplayMode,
      onLaunchConfig,
      onCapabilities,
    });
  }, [
    apiClient,
    onConnectionIssue,
    onFileNavigatorConfig,
    onHighlightCorrections,
    onLaunchConfig,
    onCapabilities,
    onWorkspaceTabsDisplayMode,
    onSessions,
    token,
  ]);

  const requestSessionField = useCallback(
    async <T, K extends keyof T>({
      paneId,
      request,
      field,
      fallbackMessage,
      includeStatus,
    }: {
      paneId: string;
      request: Promise<Response>;
      field: K;
      fallbackMessage: string;
      includeStatus?: boolean;
    }): Promise<NonNullable<T[K]>> =>
      executeRequestSessionField({
        paneId,
        request,
        field,
        fallbackMessage,
        includeStatus,
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
      }),
    [ensureToken, handleSessionMissing, onConnectionIssue],
  );

  const mutateSession = useCallback(
    async (paneId: string, request: Promise<Response>, fallbackMessage: string) =>
      executeMutateSession({
        paneId,
        request,
        fallbackMessage,
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
        onSessionUpdated,
        refreshSessions,
      }),
    [ensureToken, handleSessionMissing, onConnectionIssue, onSessionUpdated, refreshSessions],
  );

  const requestPaneField = useCallback(
    async <T, K extends keyof T>({
      paneId,
      request,
      field,
      fallbackMessage,
    }: {
      paneId: string;
      request: Promise<Response>;
      field: K;
      fallbackMessage: string;
    }) =>
      requestSessionField<T, K>({
        paneId,
        request,
        field,
        fallbackMessage,
        includeStatus: true,
      }),
    [requestSessionField],
  );

  const requestPaneQueryField = useCallback(
    async <T, K extends keyof T>({
      paneId,
      request,
      field,
      fallbackMessage,
    }: {
      paneId: string;
      request: (param: PaneParam) => Promise<Response>;
      field: K;
      fallbackMessage: string;
    }) =>
      requestPaneField<T, K>({
        paneId,
        request: request(buildPaneParam(paneId)),
        field,
        fallbackMessage,
      }),
    [requestPaneField],
  );

  const requestPaneHashField = useCallback(
    async <T, K extends keyof T>({
      paneId,
      hash,
      request,
      field,
      fallbackMessage,
    }: {
      paneId: string;
      hash: string;
      request: (param: PaneHashParam) => Promise<Response>;
      field: K;
      fallbackMessage: string;
    }) =>
      requestPaneField<T, K>({
        paneId,
        request: request(buildPaneHashParam(paneId, hash)),
        field,
        fallbackMessage,
      }),
    [requestPaneField],
  );

  const requestPaneNoteField = useCallback(
    async <T, K extends keyof T>({
      paneId,
      noteId,
      request,
      field,
      fallbackMessage,
    }: {
      paneId: string;
      noteId: string;
      request: (param: NoteIdParam) => Promise<Response>;
      field: K;
      fallbackMessage: string;
    }) =>
      requestPaneField<T, K>({
        paneId,
        request: request(buildPaneNoteParam(paneId, noteId)),
        field,
        fallbackMessage,
      }),
    [requestPaneField],
  );

  const queryRequests = useMemo(
    () =>
      createSessionQueryRequests({
        apiClient,
        requestPaneQueryField,
        requestPaneHashField,
      }),
    [apiClient, requestPaneHashField, requestPaneQueryField],
  );

  const requestScreen = useMemo(
    () =>
      createSessionScreenRequest({
        apiClient,
        screenInFlightMap,
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
        isPaneMissingError,
        onSessionRemoved,
        buildApiError,
      }),
    [
      apiClient,
      buildApiError,
      ensureToken,
      handleSessionMissing,
      isPaneMissingError,
      onConnectionIssue,
      onSessionRemoved,
      screenInFlightMap,
    ],
  );

  const requestCommand = useCallback(
    async (
      paneId: string,
      request: (signal?: AbortSignal) => Promise<Response>,
      fallbackMessage: string,
      requestTimeoutMs?: number,
    ): Promise<CommandResponse> =>
      executeRequestCommand({
        paneId,
        request,
        fallbackMessage,
        requestTimeoutMs,
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
        buildApiError,
        isPaneMissingError,
        onSessionRemoved,
      }),
    [
      buildApiError,
      ensureToken,
      handleSessionMissing,
      isPaneMissingError,
      onConnectionIssue,
      onSessionRemoved,
    ],
  );

  const requestLaunchCommand = useCallback(
    async (
      request: (signal?: AbortSignal) => Promise<Response>,
      fallbackMessage: string,
      requestTimeoutMs?: number,
    ): Promise<LaunchCommandResponse> =>
      executeRequestLaunchCommand({
        request,
        fallbackMessage,
        requestTimeoutMs,
        ensureToken,
        onConnectionIssue,
        buildApiError,
      }),
    [buildApiError, ensureToken, onConnectionIssue],
  );

  const runPaneCommand = useCallback(
    (
      paneId: string,
      fallbackMessage: string,
      request: (param: PaneParam, signal?: AbortSignal) => Promise<Response>,
      options?: {
        requestTimeoutMs?: number;
      },
    ): Promise<CommandResponse> => {
      const param = buildPaneParam(paneId);
      return requestCommand(
        paneId,
        (signal) => request(param, signal),
        fallbackMessage,
        options?.requestTimeoutMs,
      );
    },
    [requestCommand],
  );

  const runPaneMutation = useCallback(
    (paneId: string, fallbackMessage: string, request: (param: PaneParam) => Promise<Response>) => {
      return mutateSession(paneId, request(buildPaneParam(paneId)), fallbackMessage);
    },
    [mutateSession],
  );

  const actionRequests = useMemo(
    () =>
      createSessionActionRequests({
        apiClient,
        runPaneCommand,
        runPaneMutation,
        requestPaneField: requestPaneQueryField,
        requestPaneNoteField,
        runLaunchCommand: (fallbackMessage, request, options) =>
          requestLaunchCommand(request, fallbackMessage, options?.requestTimeoutMs),
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
      }),
    [
      apiClient,
      ensureToken,
      handleSessionMissing,
      onConnectionIssue,
      requestLaunchCommand,
      runPaneCommand,
      runPaneMutation,
      requestPaneQueryField,
      requestPaneNoteField,
    ],
  );

  // Domain-scoped return: the 7 Contexts in session-context.tsx are backed by
  // 5 namespaces here (core / branches / files / notes / launch) matching the
  // measured API-context split 1:1; Stream/Config are data-only contexts
  // assembled in session-context.tsx itself, not here. Each namespace is its
  // own useMemo so SessionRuntime's per-Context useMemo can depend on
  // `api.<namespace>` directly instead of re-listing every individual
  // function in its own dependency array (the prior "flat 24 functions"
  // duplication this replaces).
  const core = useMemo(
    () => ({
      refreshSessions,
      requestPromptCompletions: queryRequests.requestPromptCompletions,
      requestStateTimeline: queryRequests.requestStateTimeline,
      requestScreen,
      focusPane: actionRequests.focusPane,
      killPane: actionRequests.killPane,
      killWindow: actionRequests.killWindow,
      uploadImageAttachment: actionRequests.uploadImageAttachment,
      sendText: actionRequests.sendText,
      sendKeys: actionRequests.sendKeys,
      sendRaw: actionRequests.sendRaw,
      touchSession: actionRequests.touchSession,
      moveSessionToTop: actionRequests.moveSessionToTop,
      acknowledgeSessionView: actionRequests.acknowledgeSessionView,
      updateSessionTitle: actionRequests.updateSessionTitle,
      resetSessionTitle: actionRequests.resetSessionTitle,
    }),
    [refreshSessions, queryRequests, requestScreen, actionRequests],
  );

  const branches = useMemo(
    () => ({
      requestWorktrees: queryRequests.requestWorktrees,
      requestBranches: queryRequests.requestBranches,
      requestBranchCheckout: actionRequests.requestBranchCheckout,
      requestBranchCreate: actionRequests.requestBranchCreate,
      requestBranchDelete: actionRequests.requestBranchDelete,
      requestDiffSummary: queryRequests.requestDiffSummary,
      requestDiffFile: queryRequests.requestDiffFile,
      requestCommitLog: queryRequests.requestCommitLog,
      requestCommitDetail: queryRequests.requestCommitDetail,
      requestCommitFile: queryRequests.requestCommitFile,
    }),
    [queryRequests, actionRequests],
  );

  const files = useMemo(
    () => ({
      requestRepoFileTree: queryRequests.requestRepoFileTree,
      requestRepoFileSearch: queryRequests.requestRepoFileSearch,
      requestRepoFileContent: queryRequests.requestRepoFileContent,
      revokeRepoFilePreview: actionRequests.revokeRepoFilePreview,
    }),
    [queryRequests, actionRequests],
  );

  const notes = useMemo(
    () => ({
      requestRepoNotes: queryRequests.requestRepoNotes,
      createRepoNote: actionRequests.createRepoNote,
      updateRepoNote: actionRequests.updateRepoNote,
      deleteRepoNote: actionRequests.deleteRepoNote,
    }),
    [queryRequests, actionRequests],
  );

  const launch = useMemo(
    () => ({ launchAgentInSession: actionRequests.launchAgentInSession }),
    [actionRequests],
  );

  // The dep array lists only the 5 namespace references instead of all ~29
  // individual functions, eliminating the duplication. All namespace objects
  // are already memoized above.
  return useMemo(
    () => ({ core, branches, files, notes, launch }),
    [core, branches, files, notes, launch],
  );
};
