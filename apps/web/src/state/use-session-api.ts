import {
  type AllowedKey,
  type ApiEnvelope,
  type ApiError,
  type ClientConfig,
  type CommandResponse,
  type CommitDetail,
  type CommitFileDiff,
  type CommitLog,
  type DiffFile,
  type DiffSummary,
  encodePaneId,
  type HighlightCorrectionConfig,
  type RawItem,
  type ScreenResponse,
  type SessionSummary,
} from "@vde-monitor/shared";
import { hc } from "hono/client";
import { useCallback, useMemo, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { expectField, extractErrorMessage, requestJson } from "@/lib/api-utils";

import type { ApiAppType } from "../../../server/src/app";

type UseSessionApiParams = {
  token: string | null;
  onSessions: (sessions: SessionSummary[]) => void;
  onConnectionIssue: (message: string | null) => void;
  onReadOnly: () => void;
  onSessionUpdated: (session: SessionSummary) => void;
  onSessionRemoved: (paneId: string) => void;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
};

export type RefreshSessionsResult = {
  ok: boolean;
  status?: number;
  authError?: boolean;
  rateLimited?: boolean;
};

const buildRefreshFailureResult = (status: number): RefreshSessionsResult => ({
  ok: false,
  status,
  authError: status === 401 || status === 403,
  rateLimited: status === 429,
});

const resolveUnknownErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

const buildScreenErrorResponse = ({
  paneId,
  mode,
  message,
  apiError,
  buildApiError,
}: {
  paneId: string;
  mode: "text" | "image";
  message: string;
  apiError?: ApiError;
  buildApiError: (code: ApiError["code"], message: string) => ApiError;
}): ScreenResponse => ({
  ok: false,
  paneId,
  mode,
  capturedAt: new Date().toISOString(),
  error: apiError ?? buildApiError("INTERNAL", message),
});

const buildScreenRequestJson = (
  options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  normalizedMode: "text" | "image",
) => {
  const json: { mode?: "text" | "image"; lines?: number; cursor?: string } = {
    mode: options.mode,
    lines: options.lines,
  };
  if (normalizedMode !== "image" && options.cursor) {
    json.cursor = options.cursor;
  }
  return json;
};

const runCommandResponseSideEffects = ({
  response,
  onReadOnly,
  isPaneMissingError,
  onSessionRemoved,
  paneId,
}: {
  response: CommandResponse;
  onReadOnly: () => void;
  isPaneMissingError: (error?: ApiError | null) => boolean;
  onSessionRemoved: (paneId: string) => void;
  paneId: string;
}) => {
  if (response.error?.code === "READ_ONLY") {
    onReadOnly();
  }
  if (isPaneMissingError(response.error)) {
    onSessionRemoved(paneId);
  }
};

export const useSessionApi = ({
  token,
  onSessions,
  onConnectionIssue,
  onReadOnly,
  onSessionUpdated,
  onSessionRemoved,
  onHighlightCorrections,
}: UseSessionApiParams) => {
  const ensureToken = useCallback(() => {
    if (!token) {
      throw new Error(API_ERROR_MESSAGES.missingToken);
    }
  }, [token]);

  const notifyReadOnly = useCallback(
    (data: ApiEnvelope<unknown> | null) => {
      if (data?.error?.code === "READ_ONLY") {
        onReadOnly();
      }
    },
    [onReadOnly],
  );

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
  const apiClient = useMemo(
    () =>
      hc<ApiAppType>("/api", {
        headers: authHeaders,
      }),
    [authHeaders],
  );
  const screenInFlightRef = useRef(new Map<string, Promise<ScreenResponse>>());

  const refreshSessions = useCallback(async (): Promise<RefreshSessionsResult> => {
    if (!token) {
      return { ok: false, authError: true };
    }
    try {
      const { res, data } = await requestJson<
        ApiEnvelope<{ sessions?: SessionSummary[]; clientConfig?: ClientConfig }>
      >(apiClient.sessions.$get());
      if (!res.ok || !data?.sessions) {
        const fallback = res.ok
          ? API_ERROR_MESSAGES.invalidResponse
          : API_ERROR_MESSAGES.requestFailed;
        onConnectionIssue(extractErrorMessage(res, data, fallback, { includeStatus: !res.ok }));
        return buildRefreshFailureResult(res.status);
      }
      onSessions(data.sessions);
      const nextHighlight = data.clientConfig?.screen?.highlightCorrection;
      if (nextHighlight) {
        onHighlightCorrections(nextHighlight);
      }
      onConnectionIssue(null);
      return { ok: true, status: res.status };
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
    }): Promise<NonNullable<T[K]>> => {
      ensureToken();
      try {
        const { res, data } = await requestJson<ApiEnvelope<T>>(request);
        if (!res.ok) {
          handleSessionMissing(paneId, res, data);
          const message = extractErrorMessage(res, data, fallbackMessage, { includeStatus });
          throw new Error(message);
        }
        const value = expectField(res, data, field, fallbackMessage);
        onConnectionIssue(null);
        return value;
      } catch (err) {
        const message = err instanceof Error ? err.message : fallbackMessage;
        onConnectionIssue(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [ensureToken, handleSessionMissing, onConnectionIssue],
  );

  const mutateSession = useCallback(
    async (paneId: string, request: Promise<Response>, fallbackMessage: string) => {
      ensureToken();
      const { res, data } = await requestJson<ApiEnvelope<{ session?: SessionSummary }>>(request);
      if (!res.ok) {
        notifyReadOnly(data);
        const message = extractErrorMessage(res, data, fallbackMessage);
        onConnectionIssue(message);
        handleSessionMissing(paneId, res, data);
        throw new Error(message);
      }
      if (!data) {
        const message = fallbackMessage;
        onConnectionIssue(message);
        throw new Error(message);
      }
      if (data.session) {
        onSessionUpdated(data.session);
        onConnectionIssue(null);
        return data.session;
      }
      await refreshSessions();
      return null;
    },
    [
      ensureToken,
      handleSessionMissing,
      notifyReadOnly,
      onConnectionIssue,
      onSessionUpdated,
      refreshSessions,
    ],
  );

  const requestDiffSummary = useCallback(
    async (paneId: string, options?: { force?: boolean }) => {
      const param = { paneId: encodePaneId(paneId) };
      const query = options?.force ? { force: "1" } : {};
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
      const param = { paneId: encodePaneId(paneId) };
      const query: { path: string; rev?: string; force?: string } = { path: filePath };
      if (rev) {
        query.rev = rev;
      }
      if (options?.force) {
        query.force = "1";
      }
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
      const param = { paneId: encodePaneId(paneId), hash };
      const query = options?.force ? { force: "1" } : {};
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
      const param = { paneId: encodePaneId(paneId), hash };
      const query: { path: string; force?: string } = { path };
      if (options?.force) {
        query.force = "1";
      }
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

  const requestScreen = useCallback(
    async (
      paneId: string,
      options: { lines?: number; mode?: "text" | "image"; cursor?: string },
    ): Promise<ScreenResponse> => {
      ensureToken();
      const normalizedMode = options.mode ?? "text";
      const cursorKey = normalizedMode === "text" ? (options.cursor ?? "") : "";
      const linesKey = options.lines ?? "default";
      const requestKey = `${paneId}:${normalizedMode}:${linesKey}:${cursorKey}`;
      const fallbackKey =
        normalizedMode === "text" && cursorKey ? `${paneId}:${normalizedMode}:${linesKey}:` : null;
      const inflight =
        screenInFlightRef.current.get(requestKey) ??
        (fallbackKey ? screenInFlightRef.current.get(fallbackKey) : undefined);
      if (inflight) {
        return inflight;
      }

      const executeRequest = async (): Promise<ScreenResponse> => {
        const param = { paneId: encodePaneId(paneId) };
        const json = buildScreenRequestJson(options, normalizedMode);
        try {
          const { res, data } = await requestJson<ApiEnvelope<{ screen?: ScreenResponse }>>(
            apiClient.sessions[":paneId"].screen.$post({ param, json }),
          );
          if (!res.ok) {
            const message = extractErrorMessage(res, data, API_ERROR_MESSAGES.screenRequestFailed, {
              includeStatus: true,
            });
            onConnectionIssue(message);
            handleSessionMissing(paneId, res, data);
            return buildScreenErrorResponse({
              paneId,
              mode: normalizedMode,
              message,
              apiError: data?.error,
              buildApiError,
            });
          }
          if (!data?.screen) {
            const message = API_ERROR_MESSAGES.invalidResponse;
            onConnectionIssue(message);
            return buildScreenErrorResponse({
              paneId,
              mode: normalizedMode,
              message,
              buildApiError,
            });
          }
          if (isPaneMissingError(data.screen.error)) {
            onSessionRemoved(paneId);
          }
          onConnectionIssue(null);
          return data.screen;
        } catch (err) {
          const message = resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.screenRequestFailed);
          onConnectionIssue(message);
          return buildScreenErrorResponse({
            paneId,
            mode: normalizedMode,
            message,
            buildApiError,
          });
        }
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
    ): Promise<CommandResponse> => {
      ensureToken();
      try {
        const { res, data } =
          await requestJson<ApiEnvelope<{ command?: CommandResponse }>>(request);
        if (!res.ok) {
          const message = extractErrorMessage(res, data, fallbackMessage, { includeStatus: true });
          onConnectionIssue(message);
          notifyReadOnly(data);
          handleSessionMissing(paneId, res, data);
          return {
            ok: false,
            error: data?.error ?? buildApiError("INTERNAL", message),
          };
        }
        if (!data?.command) {
          const message = API_ERROR_MESSAGES.invalidResponse;
          onConnectionIssue(message);
          return { ok: false, error: buildApiError("INTERNAL", message) };
        }
        runCommandResponseSideEffects({
          response: data.command,
          onReadOnly,
          isPaneMissingError,
          onSessionRemoved,
          paneId,
        });
        onConnectionIssue(null);
        return data.command;
      } catch (err) {
        const message = resolveUnknownErrorMessage(err, fallbackMessage);
        onConnectionIssue(message);
        return { ok: false, error: buildApiError("INTERNAL", message) };
      }
    },
    [
      buildApiError,
      ensureToken,
      handleSessionMissing,
      isPaneMissingError,
      notifyReadOnly,
      onConnectionIssue,
      onReadOnly,
      onSessionRemoved,
    ],
  );

  const sendText = useCallback(
    async (paneId: string, text: string, enter = true): Promise<CommandResponse> => {
      const param = { paneId: encodePaneId(paneId) };
      return requestCommand(
        paneId,
        apiClient.sessions[":paneId"].send.text.$post({ param, json: { text, enter } }),
        API_ERROR_MESSAGES.sendText,
      );
    },
    [apiClient, requestCommand],
  );

  const sendKeys = useCallback(
    async (paneId: string, keys: AllowedKey[]): Promise<CommandResponse> => {
      const param = { paneId: encodePaneId(paneId) };
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
      const param = { paneId: encodePaneId(paneId) };
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
          param: { paneId: encodePaneId(paneId) },
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
          param: { paneId: encodePaneId(paneId) },
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
    requestScreen,
    sendText,
    sendKeys,
    sendRaw,
    updateSessionTitle,
    touchSession,
  };
};
