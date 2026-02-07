import type {
  ApiEnvelope,
  ApiError,
  ClientConfig,
  CommandResponse,
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionSummary,
} from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { extractErrorMessage } from "@/lib/api-utils";

import type {
  CommitFileQuery,
  CommitLogQuery,
  DiffFileQuery,
  ForceQuery,
  ScreenRequestJson,
} from "./session-api-contract";

export type RefreshSessionsResult = {
  ok: boolean;
  status?: number;
  authError?: boolean;
  rateLimited?: boolean;
};

export type SessionsResponseEnvelope = ApiEnvelope<{
  sessions?: SessionSummary[];
  clientConfig?: ClientConfig;
}>;

export const buildRefreshFailureResult = (status: number): RefreshSessionsResult => ({
  ok: false,
  status,
  authError: status === 401 || status === 403,
  rateLimited: status === 429,
});

export const resolveUnknownErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export const buildScreenErrorResponse = ({
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

export const buildScreenRequestJson = (
  options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  normalizedMode: "text" | "image",
): ScreenRequestJson => {
  const json: ScreenRequestJson = {
    mode: options.mode,
    lines: options.lines,
  };
  if (normalizedMode !== "image" && options.cursor) {
    json.cursor = options.cursor;
  }
  return json;
};

export const runCommandResponseSideEffects = ({
  response,
  isPaneMissingError,
  onSessionRemoved,
  paneId,
}: {
  response: CommandResponse;
  isPaneMissingError: (error?: ApiError | null) => boolean;
  onSessionRemoved: (paneId: string) => void;
  paneId: string;
}) => {
  if (isPaneMissingError(response.error)) {
    onSessionRemoved(paneId);
  }
};

export const applyRefreshSessionsSuccess = ({
  res,
  data,
  onSessions,
  onHighlightCorrections,
  onConnectionIssue,
}: {
  res: Response;
  data: SessionsResponseEnvelope;
  onSessions: (sessions: SessionSummary[]) => void;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
  onConnectionIssue: (message: string | null) => void;
}): RefreshSessionsResult => {
  onSessions(data.sessions ?? []);
  const nextHighlight = data.clientConfig?.screen?.highlightCorrection;
  if (nextHighlight) {
    onHighlightCorrections(nextHighlight);
  }
  onConnectionIssue(null);
  return { ok: true, status: res.status };
};

export const applyRefreshSessionsFailure = ({
  res,
  data,
  onConnectionIssue,
}: {
  res: Response;
  data: SessionsResponseEnvelope | null;
  onConnectionIssue: (message: string | null) => void;
}): RefreshSessionsResult => {
  const fallback = res.ok ? API_ERROR_MESSAGES.invalidResponse : API_ERROR_MESSAGES.requestFailed;
  onConnectionIssue(extractErrorMessage(res, data, fallback, { includeStatus: !res.ok }));
  return buildRefreshFailureResult(res.status);
};

export const resolveScreenMode = (options: { mode?: "text" | "image" }) => options.mode ?? "text";

export const buildScreenRequestKeys = ({
  paneId,
  normalizedMode,
  lines,
  cursor,
}: {
  paneId: string;
  normalizedMode: "text" | "image";
  lines?: number;
  cursor?: string;
}) => {
  const cursorKey = normalizedMode === "text" ? (cursor ?? "") : "";
  const linesKey = lines ?? "default";
  const requestKey = `${paneId}:${normalizedMode}:${linesKey}:${cursorKey}`;
  const fallbackKey =
    normalizedMode === "text" && cursorKey ? `${paneId}:${normalizedMode}:${linesKey}:` : null;
  return { requestKey, fallbackKey };
};

export const resolveInflightScreenRequest = <T>({
  inFlightMap,
  requestKey,
  fallbackKey,
}: {
  inFlightMap: Map<string, Promise<T>>;
  requestKey: string;
  fallbackKey: string | null;
}): Promise<T> | null => {
  const direct = inFlightMap.get(requestKey);
  if (direct) {
    return direct;
  }
  if (!fallbackKey) {
    return null;
  }
  return inFlightMap.get(fallbackKey) ?? null;
};

export const buildForceQuery = (options?: { force?: boolean }): ForceQuery =>
  options?.force ? { force: "1" } : {};

export const buildDiffFileQuery = (
  path: string,
  rev?: string | null,
  options?: { force?: boolean },
): DiffFileQuery => {
  const query: DiffFileQuery = { path };
  if (rev) {
    query.rev = rev;
  }
  if (options?.force) {
    query.force = "1";
  }
  return query;
};

export const buildCommitLogQuery = (options?: {
  limit?: number;
  skip?: number;
  force?: boolean;
}): CommitLogQuery => {
  const query: CommitLogQuery = {};
  if (options?.limit) {
    query.limit = String(options.limit);
  }
  if (options?.skip) {
    query.skip = String(options.skip);
  }
  if (options?.force) {
    query.force = "1";
  }
  return query;
};

export const buildCommitFileQuery = (
  path: string,
  options?: { force?: boolean },
): CommitFileQuery => {
  const query: CommitFileQuery = { path };
  if (options?.force) {
    query.force = "1";
  }
  return query;
};
