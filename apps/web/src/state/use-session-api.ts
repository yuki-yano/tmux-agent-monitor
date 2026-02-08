import {
  type AllowedKey,
  type ApiEnvelope,
  type ApiError,
  type CommandResponse,
  type CommitDetail,
  type CommitFileDiff,
  type CommitLog,
  type DiffFile,
  type DiffSummary,
  encodePaneId,
  type HighlightCorrectionConfig,
  type ImageAttachment,
  imageAttachmentSchema,
  type RawItem,
  type ScreenResponse,
  type SessionStateTimeline,
  type SessionStateTimelineRange,
  type SessionSummary,
} from "@vde-monitor/shared";
import { useCallback, useMemo, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { requestJson } from "@/lib/api-utils";

import { createApiClient } from "./session-api-contract";
import {
  mutateSession as executeMutateSession,
  requestCommand as executeRequestCommand,
  requestScreenResponse as executeRequestScreenResponse,
  requestSessionField as executeRequestSessionField,
} from "./session-api-request-executors";
import {
  applyRefreshSessionsFailure,
  applyRefreshSessionsSuccess,
  buildCommitFileQuery,
  buildCommitLogQuery,
  buildDiffFileQuery,
  buildForceQuery,
  buildScreenRequestJson,
  buildScreenRequestKeys,
  type RefreshSessionsResult,
  resolveInflightScreenRequest,
  resolveScreenMode,
  resolveUnknownErrorMessage,
  type SessionsResponseEnvelope,
} from "./session-api-utils";

type UseSessionApiParams = {
  token: string | null;
  apiBaseUrl?: string | null;
  onSessions: (sessions: SessionSummary[]) => void;
  onConnectionIssue: (message: string | null) => void;
  onSessionUpdated: (session: SessionSummary) => void;
  onSessionRemoved: (paneId: string) => void;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
};

const buildPaneParam = (paneId: string) => ({ paneId: encodePaneId(paneId) });
const buildPaneHashParam = (paneId: string, hash: string) => ({
  paneId: encodePaneId(paneId),
  hash,
});

export type { RefreshSessionsResult } from "./session-api-utils";

export const useSessionApi = ({
  token,
  apiBaseUrl,
  onSessions,
  onConnectionIssue,
  onSessionUpdated,
  onSessionRemoved,
  onHighlightCorrections,
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
  const screenInFlightRef = useRef(new Map<string, Promise<ScreenResponse>>());

  const refreshSessions = useCallback(async (): Promise<RefreshSessionsResult> => {
    if (!token) {
      return { ok: false, authError: true };
    }
    try {
      const { res, data } = await requestJson<SessionsResponseEnvelope>(apiClient.sessions.$get());
      if (!res.ok || !data?.sessions) {
        return applyRefreshSessionsFailure({ res, data, onConnectionIssue });
      }
      return applyRefreshSessionsSuccess({
        res,
        data,
        onSessions,
        onHighlightCorrections,
        onConnectionIssue,
      });
    } catch (err) {
      onConnectionIssue(resolveUnknownErrorMessage(err, "Network error. Reconnecting..."));
      return { ok: false };
    }
  }, [apiClient, onConnectionIssue, onHighlightCorrections, onSessions, token]);

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

  const requestDiffSummary = useCallback(
    async (paneId: string, options?: { force?: boolean }) => {
      const param = buildPaneParam(paneId);
      const query = buildForceQuery(options);
      return requestSessionField<{ summary?: DiffSummary }, "summary">({
        paneId,
        request: apiClient.sessions[":paneId"].diff.$get({ param, query }),
        field: "summary",
        fallbackMessage: API_ERROR_MESSAGES.diffSummary,
        includeStatus: true,
      });
    },
    [apiClient, requestSessionField],
  );

  const requestDiffFile = useCallback(
    async (
      paneId: string,
      filePath: string,
      rev?: string | null,
      options?: { force?: boolean },
    ) => {
      const param = buildPaneParam(paneId);
      const query = buildDiffFileQuery(filePath, rev, options);
      return requestSessionField<{ file?: DiffFile }, "file">({
        paneId,
        request: apiClient.sessions[":paneId"].diff.file.$get({ param, query }),
        field: "file",
        fallbackMessage: API_ERROR_MESSAGES.diffFile,
        includeStatus: true,
      });
    },
    [apiClient, requestSessionField],
  );

  const requestCommitLog = useCallback(
    async (paneId: string, options?: { limit?: number; skip?: number; force?: boolean }) => {
      const param = buildPaneParam(paneId);
      const query = buildCommitLogQuery(options);
      return requestSessionField<{ log?: CommitLog }, "log">({
        paneId,
        request: apiClient.sessions[":paneId"].commits.$get({ param, query }),
        field: "log",
        fallbackMessage: API_ERROR_MESSAGES.commitLog,
        includeStatus: true,
      });
    },
    [apiClient, requestSessionField],
  );

  const requestCommitDetail = useCallback(
    async (paneId: string, hash: string, options?: { force?: boolean }) => {
      const param = buildPaneHashParam(paneId, hash);
      const query = buildForceQuery(options);
      return requestSessionField<{ commit?: CommitDetail }, "commit">({
        paneId,
        request: apiClient.sessions[":paneId"].commits[":hash"].$get({ param, query }),
        field: "commit",
        fallbackMessage: API_ERROR_MESSAGES.commitDetail,
        includeStatus: true,
      });
    },
    [apiClient, requestSessionField],
  );

  const requestCommitFile = useCallback(
    async (paneId: string, hash: string, path: string, options?: { force?: boolean }) => {
      const param = buildPaneHashParam(paneId, hash);
      const query = buildCommitFileQuery(path, options);
      return requestSessionField<{ file?: CommitFileDiff }, "file">({
        paneId,
        request: apiClient.sessions[":paneId"].commits[":hash"].file.$get({
          param,
          query,
        }),
        field: "file",
        fallbackMessage: API_ERROR_MESSAGES.commitFile,
        includeStatus: true,
      });
    },
    [apiClient, requestSessionField],
  );

  const requestStateTimeline = useCallback(
    async (
      paneId: string,
      options?: { range?: SessionStateTimelineRange; limit?: number },
    ): Promise<SessionStateTimeline> => {
      const param = buildPaneParam(paneId);
      const query: { range?: SessionStateTimelineRange; limit?: string } = {};
      if (options?.range) {
        query.range = options.range;
      }
      if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
        query.limit = String(Math.max(1, Math.floor(options.limit)));
      }
      return requestSessionField<{ timeline?: SessionStateTimeline }, "timeline">({
        paneId,
        request: apiClient.sessions[":paneId"].timeline.$get({ param, query }),
        field: "timeline",
        fallbackMessage: API_ERROR_MESSAGES.timeline,
        includeStatus: true,
      });
    },
    [apiClient, requestSessionField],
  );

  const requestScreen = useCallback(
    async (
      paneId: string,
      options: { lines?: number; mode?: "text" | "image"; cursor?: string },
    ): Promise<ScreenResponse> => {
      ensureToken();
      const normalizedMode = resolveScreenMode(options);
      const { requestKey, fallbackKey } = buildScreenRequestKeys({
        paneId,
        normalizedMode,
        lines: options.lines,
        cursor: options.cursor,
      });
      const inflight = resolveInflightScreenRequest({
        inFlightMap: screenInFlightRef.current,
        requestKey,
        fallbackKey,
      });
      if (inflight) {
        return inflight;
      }

      const executeRequest = async (): Promise<ScreenResponse> => {
        const param = buildPaneParam(paneId);
        const json = buildScreenRequestJson(options, normalizedMode);
        return executeRequestScreenResponse({
          paneId,
          mode: normalizedMode,
          request: apiClient.sessions[":paneId"].screen.$post({ param, json }),
          fallbackMessage: API_ERROR_MESSAGES.screenRequestFailed,
          onConnectionIssue,
          handleSessionMissing,
          isPaneMissingError,
          onSessionRemoved,
          buildApiError,
        });
      };

      const promise = executeRequest();
      screenInFlightRef.current.set(requestKey, promise);
      try {
        return await promise;
      } finally {
        screenInFlightRef.current.delete(requestKey);
      }
    },
    [
      apiClient,
      buildApiError,
      ensureToken,
      handleSessionMissing,
      isPaneMissingError,
      onConnectionIssue,
      onSessionRemoved,
      screenInFlightRef,
    ],
  );

  const requestCommand = useCallback(
    async (
      paneId: string,
      request: Promise<Response>,
      fallbackMessage: string,
    ): Promise<CommandResponse> =>
      executeRequestCommand({
        paneId,
        request,
        fallbackMessage,
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

  const sendText = useCallback(
    async (paneId: string, text: string, enter = true): Promise<CommandResponse> => {
      const param = buildPaneParam(paneId);
      return requestCommand(
        paneId,
        apiClient.sessions[":paneId"].send.text.$post({ param, json: { text, enter } }),
        API_ERROR_MESSAGES.sendText,
      );
    },
    [apiClient, requestCommand],
  );

  const focusPane = useCallback(
    async (paneId: string): Promise<CommandResponse> => {
      const param = buildPaneParam(paneId);
      return requestCommand(
        paneId,
        apiClient.sessions[":paneId"].focus.$post({ param }),
        API_ERROR_MESSAGES.focusPane,
      );
    },
    [apiClient, requestCommand],
  );

  const uploadImageAttachment = useCallback(
    async (paneId: string, file: File): Promise<ImageAttachment> => {
      const param = buildPaneParam(paneId);
      const attachment = await requestSessionField<{ attachment?: unknown }, "attachment">({
        paneId,
        request: apiClient.sessions[":paneId"].attachments.image.$post({
          param,
          form: { image: file },
        }),
        field: "attachment",
        fallbackMessage: API_ERROR_MESSAGES.uploadImage,
        includeStatus: true,
      });
      const parsed = imageAttachmentSchema.safeParse(attachment);
      if (!parsed.success) {
        const message = API_ERROR_MESSAGES.invalidResponse;
        onConnectionIssue(message);
        throw new Error(message);
      }
      return parsed.data;
    },
    [apiClient, onConnectionIssue, requestSessionField],
  );

  const sendKeys = useCallback(
    async (paneId: string, keys: AllowedKey[]): Promise<CommandResponse> => {
      const param = buildPaneParam(paneId);
      return requestCommand(
        paneId,
        apiClient.sessions[":paneId"].send.keys.$post({ param, json: { keys } }),
        API_ERROR_MESSAGES.sendKeys,
      );
    },
    [apiClient, requestCommand],
  );

  const sendRaw = useCallback(
    async (paneId: string, items: RawItem[], unsafe = false): Promise<CommandResponse> => {
      const param = buildPaneParam(paneId);
      return requestCommand(
        paneId,
        apiClient.sessions[":paneId"].send.raw.$post({ param, json: { items, unsafe } }),
        API_ERROR_MESSAGES.sendRaw,
      );
    },
    [apiClient, requestCommand],
  );

  const updateSessionTitle = useCallback(
    async (paneId: string, title: string | null) => {
      await mutateSession(
        paneId,
        apiClient.sessions[":paneId"].title.$put({
          param: buildPaneParam(paneId),
          json: { title },
        }),
        API_ERROR_MESSAGES.updateTitle,
      );
    },
    [apiClient, mutateSession],
  );

  const touchSession = useCallback(
    async (paneId: string) => {
      await mutateSession(
        paneId,
        apiClient.sessions[":paneId"].touch.$post({
          param: buildPaneParam(paneId),
        }),
        API_ERROR_MESSAGES.updateActivity,
      );
    },
    [apiClient, mutateSession],
  );

  return {
    refreshSessions,
    requestDiffSummary,
    requestDiffFile,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
    requestStateTimeline,
    requestScreen,
    sendText,
    focusPane,
    uploadImageAttachment,
    sendKeys,
    sendRaw,
    updateSessionTitle,
    touchSession,
  };
};
