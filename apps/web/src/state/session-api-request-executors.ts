import {
  ApiEnvelope,
  ApiError,
  ClientCapabilities,
  ClientFileNavigatorConfig,
  CommandResponse,
  HighlightCorrectionConfig,
  ImageAttachment,
  LaunchCommandResponse,
  LaunchConfig,
  ScreenResponse,
  SessionSummary,
  WorkspaceTabsDisplayMode,
  imageAttachmentSchema,
} from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import {
  expectField,
  extractErrorMessage,
  isAbortError,
  requestJson,
  toErrorWithFallback,
} from "@/lib/api-utils";

import {
  type RefreshSessionsResult,
  type SessionsResponseEnvelope,
  applyRefreshSessionsFailure,
  applyRefreshSessionsSuccess,
  buildScreenErrorResponse,
  resolveUnknownErrorMessage,
} from "./session-api-utils";

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
    if (isAbortError(error)) {
      throw error;
    }
    const message = resolveUnknownErrorMessage(error, fallbackMessage);
    onConnectionIssue(message);
    throw toErrorWithFallback(error, fallbackMessage);
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
  request: (signal?: AbortSignal) => Promise<Response>;
  fallbackMessage: string;
  requestTimeoutMs?: number;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
  handleSessionMissing: HandleSessionMissing;
  buildApiError: (code: ApiError["code"], message: string) => ApiError;
  isPaneMissingError: (error?: ApiError | null) => boolean;
  onSessionRemoved: (paneId: string) => void;
};

type CommandEnvelope<TCommand> = ApiEnvelope<{ command?: TCommand }>;

type RequestCommandEnvelopeParams = {
  request: (signal?: AbortSignal) => Promise<Response>;
  fallbackMessage: string;
  requestTimeoutMs?: number;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
};

type RequestCommandEnvelopeResult<TCommand> =
  | { ok: true; command: TCommand }
  | {
      ok: false;
      message: string;
      res?: Response;
      data?: CommandEnvelope<TCommand> | null;
    };

const requestCommandEnvelope = async <TCommand>({
  request,
  fallbackMessage,
  requestTimeoutMs,
  ensureToken,
  onConnectionIssue,
}: RequestCommandEnvelopeParams): Promise<RequestCommandEnvelopeResult<TCommand>> => {
  ensureToken();
  try {
    const { res, data } = await requestJson<CommandEnvelope<TCommand>>(request, {
      timeoutMs: requestTimeoutMs,
      timeoutMessage: API_ERROR_MESSAGES.requestTimeout,
    });
    if (!res.ok) {
      const message = extractErrorMessage(res, data, fallbackMessage, { includeStatus: true });
      onConnectionIssue(message);
      return { ok: false, message, res, data };
    }
    if (!data?.command) {
      const message = API_ERROR_MESSAGES.invalidResponse;
      onConnectionIssue(message);
      return { ok: false, message, res, data };
    }
    onConnectionIssue(null);
    return { ok: true, command: data.command };
  } catch (error) {
    const message = resolveUnknownErrorMessage(error, fallbackMessage);
    onConnectionIssue(message);
    return { ok: false, message };
  }
};

export const requestCommand = async ({
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
}: RequestCommandParams): Promise<CommandResponse> => {
  const result = await requestCommandEnvelope<CommandResponse>({
    request,
    fallbackMessage,
    requestTimeoutMs,
    ensureToken,
    onConnectionIssue,
  });
  if (!result.ok) {
    if (result.res) {
      handleSessionMissing(paneId, result.res, result.data ?? null);
    }
    return {
      ok: false,
      error: result.data?.error ?? buildApiError("INTERNAL", result.message),
    };
  }
  if (isPaneMissingError(result.command.error)) {
    onSessionRemoved(paneId);
  }
  return result.command;
};

type RequestLaunchCommandParams = {
  request: (signal?: AbortSignal) => Promise<Response>;
  fallbackMessage: string;
  requestTimeoutMs?: number;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
  buildApiError: (code: ApiError["code"], message: string) => ApiError;
};

export const requestLaunchCommand = async ({
  request,
  fallbackMessage,
  requestTimeoutMs,
  ensureToken,
  onConnectionIssue,
  buildApiError,
}: RequestLaunchCommandParams): Promise<LaunchCommandResponse> => {
  const result = await requestCommandEnvelope<LaunchCommandResponse>({
    request,
    fallbackMessage,
    requestTimeoutMs,
    ensureToken,
    onConnectionIssue,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.data?.error ?? buildApiError("INTERNAL", result.message),
      rollback: { attempted: false, ok: true },
    };
  }
  return result.command;
};

type RequestScreenResponseParams = {
  paneId: string;
  mode: "text" | "image";
  request: (signal?: AbortSignal) => Promise<Response>;
  requestTimeoutMs?: number;
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
  requestTimeoutMs,
  fallbackMessage,
  onConnectionIssue,
  handleSessionMissing,
  isPaneMissingError,
  onSessionRemoved,
  buildApiError,
}: RequestScreenResponseParams): Promise<ScreenResponse> => {
  try {
    const { res, data } = await requestJson<ApiEnvelope<{ screen?: ScreenResponse }>>(request, {
      timeoutMs: requestTimeoutMs,
      timeoutMessage: API_ERROR_MESSAGES.requestTimeout,
    });
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

type RequestImageAttachmentParams = {
  paneId: string;
  request: Promise<Response>;
  ensureToken: EnsureToken;
  onConnectionIssue: OnConnectionIssue;
  handleSessionMissing: HandleSessionMissing;
};

export const requestImageAttachment = async ({
  paneId,
  request,
  ensureToken,
  onConnectionIssue,
  handleSessionMissing,
}: RequestImageAttachmentParams): Promise<ImageAttachment> => {
  const attachment = await requestSessionField<{ attachment?: unknown }, "attachment">({
    paneId,
    request,
    field: "attachment",
    fallbackMessage: API_ERROR_MESSAGES.uploadImage,
    includeStatus: true,
    ensureToken,
    onConnectionIssue,
    handleSessionMissing,
  });
  const parsed = imageAttachmentSchema.safeParse(attachment);
  if (!parsed.success) {
    const message = API_ERROR_MESSAGES.invalidResponse;
    onConnectionIssue(message);
    throw new Error(message);
  }
  return parsed.data;
};

type RefreshSessionsParams = {
  token: string | null;
  request: Promise<Response>;
  onSessions: (sessions: SessionSummary[]) => void;
  onConnectionIssue: OnConnectionIssue;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
  onFileNavigatorConfig: (config: ClientFileNavigatorConfig) => void;
  onWorkspaceTabsDisplayMode?: (displayMode: WorkspaceTabsDisplayMode) => void;
  onLaunchConfig?: (config: LaunchConfig) => void;
  onCapabilities?: (capabilities: ClientCapabilities) => void;
};

export const refreshSessions = async ({
  token,
  request,
  onSessions,
  onConnectionIssue,
  onHighlightCorrections,
  onFileNavigatorConfig,
  onWorkspaceTabsDisplayMode,
  onLaunchConfig,
  onCapabilities,
}: RefreshSessionsParams): Promise<RefreshSessionsResult> => {
  if (!token) {
    return { ok: false, authError: true };
  }
  try {
    const { res, data } = await requestJson<SessionsResponseEnvelope>(request);
    if (!res.ok || !data?.sessions) {
      return applyRefreshSessionsFailure({ res, data, onConnectionIssue });
    }
    return applyRefreshSessionsSuccess({
      res,
      data,
      onSessions,
      onHighlightCorrections,
      onFileNavigatorConfig,
      onWorkspaceTabsDisplayMode,
      onLaunchConfig,
      onCapabilities,
      onConnectionIssue,
    });
  } catch (error) {
    onConnectionIssue(resolveUnknownErrorMessage(error, "Network error. Reconnecting..."));
    return { ok: false };
  }
};
