import type {
  BranchList,
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffMode,
  DiffSummary,
  PromptCompletionResult,
  PromptCompletionTrigger,
  RepoFileContent,
  RepoFileSearchPage,
  RepoFileTreePage,
  RepoNote,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
  WorktreeList,
} from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import type { ApiClientContract, PaneHashParam, PaneParam } from "./session-api-contract";
import {
  buildCommitFileQuery,
  buildCommitLogQuery,
  buildDiffFileQuery,
  buildDiffQuery,
  buildForceQuery,
  buildRepoFileContentQuery,
  buildRepoFileSearchQuery,
  buildRepoFileTreeQuery,
  buildTimelineQuery,
} from "./session-api-utils";

type RequestPaneQueryField = <T, K extends keyof T>(params: {
  paneId: string;
  request: (param: PaneParam, signal?: AbortSignal) => Promise<Response>;
  field: K;
  fallbackMessage: string;
  signal?: AbortSignal;
}) => Promise<NonNullable<T[K]>>;

type RequestPaneHashField = <T, K extends keyof T>(params: {
  paneId: string;
  hash: string;
  request: (param: PaneHashParam, signal?: AbortSignal) => Promise<Response>;
  field: K;
  fallbackMessage: string;
  signal?: AbortSignal;
}) => Promise<NonNullable<T[K]>>;

type CreateSessionQueryRequestsParams = {
  apiClient: ApiClientContract;
  requestPaneQueryField: RequestPaneQueryField;
  requestPaneHashField: RequestPaneHashField;
};

type PaneQueryValueParams<T, K extends keyof T> = {
  paneId: string;
  field: K;
  fallbackMessage: string;
  request: (param: PaneParam, signal?: AbortSignal) => Promise<Response>;
  signal?: AbortSignal;
};

type PaneHashQueryValueParams<T, K extends keyof T> = {
  paneId: string;
  hash: string;
  field: K;
  fallbackMessage: string;
  request: (param: PaneHashParam, signal?: AbortSignal) => Promise<Response>;
  signal?: AbortSignal;
};

export const createSessionQueryRequests = ({
  apiClient,
  requestPaneQueryField,
  requestPaneHashField,
}: CreateSessionQueryRequestsParams) => {
  const requestPaneQueryValue = <T, K extends keyof T>({
    paneId,
    field,
    fallbackMessage,
    request,
    signal,
  }: PaneQueryValueParams<T, K>) => {
    return requestPaneQueryField<T, K>({
      paneId,
      request,
      field,
      fallbackMessage,
      signal,
    });
  };

  const requestPaneHashValue = <T, K extends keyof T>({
    paneId,
    hash,
    field,
    fallbackMessage,
    request,
    signal,
  }: PaneHashQueryValueParams<T, K>) => {
    return requestPaneHashField<T, K>({
      paneId,
      hash,
      request,
      field,
      fallbackMessage,
      signal,
    });
  };

  const requestDiffSummary = async (
    paneId: string,
    options: {
      mode: DiffMode;
      force?: boolean;
      worktreePath?: string;
      branch?: string;
    },
    signal?: AbortSignal,
  ) => {
    const query = buildDiffQuery(options);
    return requestPaneQueryValue<{ summary?: DiffSummary }, "summary">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].diff.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "summary",
      fallbackMessage: API_ERROR_MESSAGES.diffSummary,
      signal,
    });
  };

  const requestPromptCompletions = async (
    paneId: string,
    trigger: PromptCompletionTrigger,
    queryValue = "",
    signal?: AbortSignal,
  ): Promise<PromptCompletionResult> => {
    const query = { trigger, ...(queryValue ? { q: queryValue } : {}) };
    return requestPaneQueryValue<PromptCompletionResult, "items">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].completions.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "items",
      fallbackMessage: API_ERROR_MESSAGES.promptCompletions,
      signal,
    }).then((items) => ({ items }));
  };

  const requestDiffFile = async (
    paneId: string,
    filePath: string,
    rev: string | null | undefined,
    options: {
      mode: DiffMode;
      force?: boolean;
      worktreePath?: string;
      branch?: string;
    },
    signal?: AbortSignal,
  ) => {
    const query = buildDiffFileQuery(filePath, rev, options);
    return requestPaneQueryValue<{ file?: DiffFile }, "file">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].diff.file.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.diffFile,
      signal,
    });
  };

  const requestCommitLog = async (
    paneId: string,
    options?: {
      limit?: number;
      skip?: number;
      force?: boolean;
      worktreePath?: string;
      branch?: string;
    },
    signal?: AbortSignal,
  ) => {
    const query = buildCommitLogQuery(options);
    return requestPaneQueryValue<{ log?: CommitLog }, "log">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].commits.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "log",
      fallbackMessage: API_ERROR_MESSAGES.commitLog,
      signal,
    });
  };

  const requestCommitDetail = async (
    paneId: string,
    hash: string,
    options?: { force?: boolean; worktreePath?: string },
    signal?: AbortSignal,
  ) => {
    const query = buildForceQuery(options);
    return requestPaneHashValue<{ commit?: CommitDetail }, "commit">({
      paneId,
      hash,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].commits[":hash"].$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "commit",
      fallbackMessage: API_ERROR_MESSAGES.commitDetail,
      signal,
    });
  };

  const requestCommitFile = async (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean; worktreePath?: string },
    signal?: AbortSignal,
  ) => {
    const query = buildCommitFileQuery(path, options);
    return requestPaneHashValue<{ file?: CommitFileDiff }, "file">({
      paneId,
      hash,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].commits[":hash"].file.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.commitFile,
      signal,
    });
  };

  const requestStateTimeline = async (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<SessionStateTimeline> => {
    const query = buildTimelineQuery(options);
    return requestPaneQueryValue<{ timeline?: SessionStateTimeline }, "timeline">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].timeline.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "timeline",
      fallbackMessage: API_ERROR_MESSAGES.timeline,
      signal,
    });
  };

  const requestRepoNotes = async (paneId: string, signal?: AbortSignal): Promise<RepoNote[]> => {
    return requestPaneQueryValue<{ notes?: RepoNote[] }, "notes">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].notes.$get({ param }, { init: { signal: requestSignal } }),
      field: "notes",
      fallbackMessage: API_ERROR_MESSAGES.repoNotes,
      signal,
    });
  };

  const requestRepoFileTree = async (
    paneId: string,
    options?: { path?: string; cursor?: string; limit?: number; worktreePath?: string },
    signal?: AbortSignal,
  ): Promise<RepoFileTreePage> => {
    const query = buildRepoFileTreeQuery(options);
    return requestPaneQueryValue<{ tree?: RepoFileTreePage }, "tree">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].files.tree.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "tree",
      fallbackMessage: API_ERROR_MESSAGES.fileTree,
      signal,
    });
  };

  const requestRepoFileSearch = async (
    paneId: string,
    queryValue: string,
    options?: {
      cursor?: string;
      limit?: number;
      worktreePath?: string;
      exactReference?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<RepoFileSearchPage> => {
    const query = buildRepoFileSearchQuery(queryValue, options);
    return requestPaneQueryValue<{ result?: RepoFileSearchPage }, "result">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].files.search.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "result",
      fallbackMessage: API_ERROR_MESSAGES.fileSearch,
      signal,
    });
  };

  const requestRepoFileContent = async (
    paneId: string,
    path: string,
    options?: { maxBytes?: number; worktreePath?: string },
    signal?: AbortSignal,
  ): Promise<RepoFileContent> => {
    const query = buildRepoFileContentQuery(path, options);
    return requestPaneQueryValue<{ file?: RepoFileContent }, "file">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].files.content.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.fileContent,
      signal,
    });
  };

  const requestWorktrees = async (paneId: string, signal?: AbortSignal): Promise<WorktreeList> => {
    return requestPaneQueryValue<{ worktrees?: WorktreeList }, "worktrees">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].worktrees.$get(
          { param },
          { init: { signal: requestSignal } },
        ),
      field: "worktrees",
      fallbackMessage: "Failed to load worktrees",
      signal,
    });
  };

  const requestBranches = async (
    paneId: string,
    options?: { force?: boolean },
    signal?: AbortSignal,
  ): Promise<BranchList> => {
    const query = buildForceQuery(options);
    return requestPaneQueryValue<{ branches?: BranchList }, "branches">({
      paneId,
      request: (param, requestSignal) =>
        apiClient.sessions[":paneId"].branches.$get(
          { param, query },
          { init: { signal: requestSignal } },
        ),
      field: "branches",
      fallbackMessage: "Failed to load branches",
      signal,
    });
  };

  return {
    requestPromptCompletions,
    requestWorktrees,
    requestBranches,
    requestDiffSummary,
    requestDiffFile,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
    requestStateTimeline,
    requestRepoNotes,
    requestRepoFileTree,
    requestRepoFileSearch,
    requestRepoFileContent,
  };
};
