import type {
  ApiEnvelope,
  ApiError,
  ClientCapabilities,
  ClientConfig,
  ClientFileNavigatorConfig,
  DiffMode,
  HighlightCorrectionConfig,
  LaunchConfig,
  ScreenResponse,
  SessionSummary,
  WorkspaceTabsDisplayMode,
} from "@vde-monitor/shared";
import { encodePaneId } from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { extractErrorMessage } from "@/lib/api-utils";

import type {
  CommitFileQuery,
  CommitLogQuery,
  DiffFileQuery,
  DiffQuery,
  ForceQuery,
  LaunchAgentJson,
  NoteIdParam,
  PaneHashParam,
  PaneParam,
  RepoFileContentQuery,
  RepoFileSearchQuery,
  RepoFileTreeQuery,
  RepoNotePayloadJson,
  ScreenRequestJson,
  SendKeysJson,
  SendRawJson,
  SendTextJson,
  SessionTitleJson,
  TimelineQuery,
  UploadImageForm,
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
}> & {
  errorCause?: string;
};

export { resolveUnknownErrorMessage } from "@/lib/api-utils";

export const buildRefreshFailureResult = (status: number): RefreshSessionsResult => ({
  ok: false,
  status,
  authError: status === 401 || status === 403,
  rateLimited: status === 429,
});

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

export const buildSendTextJson = (
  text: string,
  enter: boolean,
  requestId?: string,
): SendTextJson => {
  const json: SendTextJson = {
    text,
    enter,
  };
  if (requestId) {
    json.requestId = requestId;
  }
  return json;
};

export const buildSendKeysJson = (keys: SendKeysJson["keys"]): SendKeysJson => ({
  keys,
});

export const buildSendRawJson = (items: SendRawJson["items"], unsafe: boolean): SendRawJson => ({
  items,
  unsafe,
});

export const buildLaunchAgentJson = ({
  sessionName,
  agent,
  requestId,
  windowName,
  cwd,
  agentOptions,
  worktreePath,
  worktreeBranch,
  worktreeCreateIfMissing,
  resumeSessionId,
  resumeFromPaneId,
  resumePolicy,
  resumeTarget,
}: {
  sessionName: string;
  agent: "codex" | "claude";
  requestId: string;
  windowName?: string;
  cwd?: string;
  agentOptions?: string[];
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeCreateIfMissing?: boolean;
  resumeSessionId?: string;
  resumeFromPaneId?: string;
  resumePolicy?: "required" | "best_effort";
  resumeTarget?: "pane" | "window";
}): LaunchAgentJson => {
  if (cwd && (worktreePath || worktreeBranch || worktreeCreateIfMissing)) {
    throw new Error("cwd cannot be combined with worktreePath/worktreeBranch");
  }
  if (worktreeCreateIfMissing && worktreePath) {
    throw new Error("worktreePath cannot be combined with worktreeCreateIfMissing");
  }
  if (worktreeCreateIfMissing && !worktreeBranch) {
    throw new Error("worktreeBranch is required when worktreeCreateIfMissing is true");
  }
  if (!resumeSessionId && !resumeFromPaneId && resumePolicy) {
    throw new Error("resumePolicy requires resumeSessionId or resumeFromPaneId");
  }
  if (resumeTarget === "window" && !resumeFromPaneId) {
    throw new Error("resumeFromPaneId is required when resumeTarget is window");
  }

  const json: LaunchAgentJson = {
    sessionName,
    agent,
    requestId,
  };
  if (windowName) {
    json.windowName = windowName;
  }
  if (cwd) {
    json.cwd = cwd;
  }
  if (agentOptions) {
    json.agentOptions = agentOptions;
  }
  if (worktreePath) {
    json.worktreePath = worktreePath;
  }
  if (worktreeBranch) {
    json.worktreeBranch = worktreeBranch;
  }
  if (worktreeCreateIfMissing) {
    json.worktreeCreateIfMissing = true;
  }
  if (resumeSessionId) {
    json.resumeSessionId = resumeSessionId;
  }
  if (resumeFromPaneId) {
    json.resumeFromPaneId = resumeFromPaneId;
  }
  if (resumePolicy) {
    json.resumePolicy = resumePolicy;
  }
  if (resumeTarget) {
    json.resumeTarget = resumeTarget;
  }
  return json;
};

export const buildSessionTitleJson = (title: string | null): SessionTitleJson => ({
  title,
});

export const buildRepoNotePayloadJson = (
  title: string | null | undefined,
  body: string,
): RepoNotePayloadJson => ({
  title: title ?? null,
  body,
});

export const buildUploadImageForm = (file: File): UploadImageForm => ({
  image: file,
});

export const applyRefreshSessionsSuccess = ({
  res,
  data,
  onSessions,
  onHighlightCorrections,
  onFileNavigatorConfig,
  onWorkspaceTabsDisplayMode,
  onLaunchConfig,
  onCapabilities,
  onConnectionIssue,
}: {
  res: Response;
  data: SessionsResponseEnvelope;
  onSessions: (sessions: SessionSummary[]) => void;
  onHighlightCorrections: (config: HighlightCorrectionConfig) => void;
  onFileNavigatorConfig: (config: ClientFileNavigatorConfig) => void;
  onWorkspaceTabsDisplayMode?: (displayMode: WorkspaceTabsDisplayMode) => void;
  onLaunchConfig?: (config: LaunchConfig) => void;
  onCapabilities?: (capabilities: ClientCapabilities) => void;
  onConnectionIssue: (message: string | null) => void;
}): RefreshSessionsResult => {
  onSessions(data.sessions ?? []);
  const nextHighlight = data.clientConfig?.screen?.highlightCorrection;
  if (nextHighlight) {
    onHighlightCorrections(nextHighlight);
  }
  const nextFileNavigator = data.clientConfig?.fileNavigator;
  if (nextFileNavigator) {
    onFileNavigatorConfig(nextFileNavigator);
  }
  const nextWorkspaceTabs = data.clientConfig?.workspaceTabs?.displayMode;
  if (nextWorkspaceTabs && onWorkspaceTabsDisplayMode) {
    onWorkspaceTabsDisplayMode(nextWorkspaceTabs);
  }
  const nextLaunchConfig = data.clientConfig?.launch;
  if (nextLaunchConfig && onLaunchConfig) {
    onLaunchConfig(nextLaunchConfig);
  }
  const nextCapabilities = data.clientConfig?.capabilities;
  if (nextCapabilities && onCapabilities) {
    onCapabilities(nextCapabilities);
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
  const refreshErrorCause =
    res.status === 500 && typeof data?.errorCause === "string" ? data.errorCause.trim() : "";
  if (refreshErrorCause.length > 0) {
    onConnectionIssue(
      `${API_ERROR_MESSAGES.requestFailed} (${res.status})\nError cause: ${refreshErrorCause}`,
    );
    return buildRefreshFailureResult(res.status);
  }
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

export const executeInflightRequest = async <T>({
  inFlightMap,
  requestKey,
  fallbackKey,
  execute,
}: {
  inFlightMap: Map<string, Promise<T>>;
  requestKey: string;
  fallbackKey: string | null;
  execute: () => Promise<T>;
}): Promise<T> => {
  const inflight = resolveInflightScreenRequest({
    inFlightMap,
    requestKey,
    fallbackKey,
  });
  if (inflight) {
    return inflight;
  }

  const promise = execute();
  inFlightMap.set(requestKey, promise);
  try {
    return await promise;
  } finally {
    inFlightMap.delete(requestKey);
  }
};

export const buildPaneParam = (paneId: string): PaneParam => ({
  paneId: encodePaneId(paneId),
});

export const buildPaneHashParam = (paneId: string, hash: string): PaneHashParam => ({
  paneId: encodePaneId(paneId),
  hash,
});

export const buildPaneNoteParam = (paneId: string, noteId: string): NoteIdParam => ({
  paneId: encodePaneId(paneId),
  noteId,
});

const applyForceQuery = <T extends { force?: string }>(query: T, force?: boolean): T => {
  if (force) {
    query.force = "1";
  }
  return query;
};

const applyWorktreePathQuery = <T extends { worktreePath?: string }>(
  query: T,
  worktreePath?: string,
): T => {
  const normalized = worktreePath?.trim();
  if (normalized) {
    query.worktreePath = normalized;
  }
  return query;
};

const applyBranchQuery = <T extends { branch?: string }>(query: T, branch?: string): T => {
  if (branch) {
    query.branch = branch;
  }
  return query;
};

const assignNumberAsStringIfTruthy = <T extends object, K extends keyof T>(
  query: T,
  key: K,
  value?: number,
) => {
  if (value) {
    query[key] = String(value) as T[K];
  }
};

export const buildForceQuery = (options?: {
  force?: boolean;
  worktreePath?: string;
  branch?: string;
}): ForceQuery =>
  applyBranchQuery(
    applyWorktreePathQuery(applyForceQuery({}, options?.force), options?.worktreePath),
    options?.branch,
  );

export const buildDiffQuery = (options: {
  mode: DiffMode;
  force?: boolean;
  worktreePath?: string;
  branch?: string;
}): DiffQuery => ({ ...buildForceQuery(options), mode: options.mode });

export const buildDiffFileQuery = (
  path: string,
  rev: string | null | undefined,
  options: {
    mode: DiffMode;
    force?: boolean;
    worktreePath?: string;
    branch?: string;
  },
): DiffFileQuery => {
  const query: DiffFileQuery = { path, mode: options.mode };
  if (rev) {
    query.rev = rev;
  }
  return applyBranchQuery(
    applyWorktreePathQuery(applyForceQuery(query, options?.force), options?.worktreePath),
    options?.branch,
  );
};

export const buildCommitLogQuery = (options?: {
  limit?: number;
  skip?: number;
  force?: boolean;
  worktreePath?: string;
  branch?: string;
}): CommitLogQuery => {
  const query: CommitLogQuery = {};
  assignNumberAsStringIfTruthy(query, "limit", options?.limit);
  assignNumberAsStringIfTruthy(query, "skip", options?.skip);
  return applyBranchQuery(
    applyWorktreePathQuery(applyForceQuery(query, options?.force), options?.worktreePath),
    options?.branch,
  );
};

export const buildCommitFileQuery = (
  path: string,
  options?: { force?: boolean; worktreePath?: string },
): CommitFileQuery => {
  const query: CommitFileQuery = { path };
  return applyWorktreePathQuery(applyForceQuery(query, options?.force), options?.worktreePath);
};

export const buildTimelineQuery = (options?: {
  scope?: TimelineQuery["scope"];
  range?: TimelineQuery["range"];
  limit?: number;
}) => {
  const query: TimelineQuery = {};
  if (options?.scope) {
    query.scope = options.scope;
  }
  if (options?.range) {
    query.range = options.range;
  }
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    query.limit = String(Math.max(1, Math.floor(options.limit)));
  }
  return query;
};

export const buildRepoFileTreeQuery = (options?: {
  path?: string;
  cursor?: string;
  limit?: number;
  worktreePath?: string;
}): RepoFileTreeQuery => {
  const query: RepoFileTreeQuery = {};
  if (options?.path) {
    query.path = options.path;
  }
  if (options?.cursor) {
    query.cursor = options.cursor;
  }
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    query.limit = String(Math.max(1, Math.floor(options.limit)));
  }
  return applyWorktreePathQuery(query, options?.worktreePath);
};

export const buildRepoFileSearchQuery = (
  queryValue: string,
  options?: {
    cursor?: string;
    limit?: number;
    worktreePath?: string;
    exactReference?: boolean;
  },
): RepoFileSearchQuery => {
  const query: RepoFileSearchQuery = {
    q: queryValue,
  };
  if (options?.cursor) {
    query.cursor = options.cursor;
  }
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    query.limit = String(Math.max(1, Math.floor(options.limit)));
  }
  if (options?.exactReference) {
    query.exactReference = "1";
  }
  return applyWorktreePathQuery(query, options?.worktreePath);
};

export const buildRepoFileContentQuery = (
  path: string,
  options?: {
    maxBytes?: number;
    worktreePath?: string;
  },
): RepoFileContentQuery => {
  const query: RepoFileContentQuery = {
    path,
  };
  if (typeof options?.maxBytes === "number" && Number.isFinite(options.maxBytes)) {
    query.maxBytes = String(Math.max(1, Math.floor(options.maxBytes)));
  }
  return applyWorktreePathQuery(query, options?.worktreePath);
};
