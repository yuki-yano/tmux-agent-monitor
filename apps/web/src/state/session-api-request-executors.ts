import type {
  ApiEnvelope,
  ApiError,
  CommandResponse,
  ScreenResponse,
  SessionSummary,
} from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { expectField, extractErrorMessage, requestJson } from "@/lib/api-utils";

import { buildScreenErrorResponse, resolveUnknownErrorMessage } from "./session-api-utils";

type EnsureToken = () => void;
type OnConnectionIssue = (message: string | null) => void;
type HandleSessionMissing = (
  paneId: string,
  res: Response,
  data: ApiEnvelope<unknown> | null,
) => void;

type RequestSessionFieldParams<T, K extends keyof T> = {
  paneId: string;
  request: Promise<Response>;
  field: K;
  fallbackMessage: string;
  includeStatus?: boolean;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
  handleSessionMissing: HandleSessionMissing;
};

export const requestSessionField = async <T, K extends keyof T>({
  paneId,
  request,
  field,
  fallbackMessage,
  includeStatus,
  ensureToken,
  onConnectionIssue,
  handleSessionMissing,
}: RequestSessionFieldParams<T, K>): Promise<NonNullable<T[K]>> => {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    onConnectionIssue(message);
    throw error instanceof Error ? error : new Error(message);
  }
};

type MutateSessionParams = {
  paneId: string;
  request: Promise<Response>;
  fallbackMessage: string;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
  handleSessionMissing: HandleSessionMissing;
  onSessionUpdated: (session: SessionSummary) => void;
  refreshSessions: () => Promise<unknown>;
};

export const mutateSession = async ({
  paneId,
  request,
  fallbackMessage,
  ensureToken,
  onConnectionIssue,
  handleSessionMissing,
  onSessionUpdated,
  refreshSessions,
}: MutateSessionParams) => {
  ensureToken();
  const { res, data } = await requestJson<ApiEnvelope<{ session?: SessionSummary }>>(request);
  if (!res.ok) {
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
};

type RequestCommandParams = {
  paneId: string;
  request: Promise<Response>;
  fallbackMessage: string;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
  handleSessionMissing: HandleSessionMissing;
  buildApiError: (code: ApiError["code"], message: string) => ApiError;
  isPaneMissingError: (error?: ApiError | null) => boolean;
  onSessionRemoved: (paneId: string) => void;
};

export const requestCommand = async ({
  paneId,
  request,
  fallbackMessage,
  ensureToken,
  onConnectionIssue,
  handleSessionMissing,
  buildApiError,
  isPaneMissingError,
  onSessionRemoved,
}: RequestCommandParams): Promise<CommandResponse> => {
  ensureToken();
  try {
    const { res, data } = await requestJson<ApiEnvelope<{ command?: CommandResponse }>>(request);
    if (!res.ok) {
      const message = extractErrorMessage(res, data, fallbackMessage, { includeStatus: true });
      onConnectionIssue(message);
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
    if (isPaneMissingError(data.command.error)) {
      onSessionRemoved(paneId);
    }
    onConnectionIssue(null);
    return data.command;
  } catch (error) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    onConnectionIssue(message);
    return { ok: false, error: buildApiError("INTERNAL", message) };
  }
};

type RequestScreenResponseParams = {
  paneId: string;
  mode: "text" | "image";
  request: Promise<Response>;
  fallbackMessage: string;
  onConnectionIssue: OnConnectionIssue;
  handleSessionMissing: HandleSessionMissing;
  isPaneMissingError: (error?: ApiError | null) => boolean;
  onSessionRemoved: (paneId: string) => void;
  buildApiError: (code: ApiError["code"], message: string) => ApiError;
};

export const requestScreenResponse = async ({
  paneId,
  mode,
  request,
  fallbackMessage,
  onConnectionIssue,
  handleSessionMissing,
  isPaneMissingError,
  onSessionRemoved,
  buildApiError,
}: RequestScreenResponseParams): Promise<ScreenResponse> => {
  try {
    const { res, data } = await requestJson<ApiEnvelope<{ screen?: ScreenResponse }>>(request);
    if (!res.ok) {
      const message = extractErrorMessage(res, data, fallbackMessage, { includeStatus: true });
      onConnectionIssue(message);
      handleSessionMissing(paneId, res, data);
      return buildScreenErrorResponse({
        paneId,
        mode,
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
        mode,
        message,
        buildApiError,
      });
    }
    if (isPaneMissingError(data.screen.error)) {
      onSessionRemoved(paneId);
    }
    onConnectionIssue(null);
    return data.screen;
  } catch (error) {
    const message = resolveUnknownErrorMessage(error, fallbackMessage);
    onConnectionIssue(message);
    return buildScreenErrorResponse({
      paneId,
      mode,
      message,
      buildApiError,
    });
  }
};
