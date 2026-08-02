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
  request: (param: PaneParam) => Promise<Response>;
  field: K;
  fallbackMessage: string;
}) => Promise<NonNullable<T[K]>>;

type RequestPaneHashField = <T, K extends keyof T>(params: {
  paneId: string;
  hash: string;
  request: (param: PaneHashParam) => Promise<Response>;
  field: K;
  fallbackMessage: string;
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
  request: (param: PaneParam) => Promise<Response>;
};

type PaneHashQueryValueParams<T, K extends keyof T> = {
  paneId: string;
  hash: string;
  field: K;
  fallbackMessage: string;
  request: (param: PaneHashParam) => Promise<Response>;
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
  }: PaneQueryValueParams<T, K>) => {
    return requestPaneQueryField<T, K>({
      paneId,
      request,
      field,
      fallbackMessage,
    });
  };

  const requestPaneHashValue = <T, K extends keyof T>({
    paneId,
    hash,
    field,
    fallbackMessage,
    request,
  }: PaneHashQueryValueParams<T, K>) => {
    return requestPaneHashField<T, K>({
      paneId,
      hash,
      request,
      field,
      fallbackMessage,
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
  ) => {
    const query = buildDiffQuery(options);
    return requestPaneQueryValue<{ summary?: DiffSummary }, "summary">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].diff.$get({ param, query }),
      field: "summary",
      fallbackMessage: API_ERROR_MESSAGES.diffSummary,
    });
  };

  const requestPromptCompletions = async (
    paneId: string,
    trigger: PromptCompletionTrigger,
    queryValue = "",
  ): Promise<PromptCompletionResult> => {
    const query = { trigger, ...(queryValue ? { q: queryValue } : {}) };
    return requestPaneQueryValue<PromptCompletionResult, "items">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].completions.$get({ param, query }),
      field: "items",
      fallbackMessage: API_ERROR_MESSAGES.promptCompletions,
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
  ) => {
    const query = buildDiffFileQuery(filePath, rev, options);
    return requestPaneQueryValue<{ file?: DiffFile }, "file">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].diff.file.$get({ param, query }),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.diffFile,
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
  ) => {
    const query = buildCommitLogQuery(options);
    return requestPaneQueryValue<{ log?: CommitLog }, "log">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].commits.$get({ param, query }),
      field: "log",
      fallbackMessage: API_ERROR_MESSAGES.commitLog,
    });
  };

  const requestCommitDetail = async (
    paneId: string,
    hash: string,
    options?: { force?: boolean; worktreePath?: string },
  ) => {
    const query = buildForceQuery(options);
    return requestPaneHashValue<{ commit?: CommitDetail }, "commit">({
      paneId,
      hash,
      request: (param) => apiClient.sessions[":paneId"].commits[":hash"].$get({ param, query }),
      field: "commit",
      fallbackMessage: API_ERROR_MESSAGES.commitDetail,
    });
  };

  const requestCommitFile = async (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean; worktreePath?: string },
  ) => {
    const query = buildCommitFileQuery(path, options);
    return requestPaneHashValue<{ file?: CommitFileDiff }, "file">({
      paneId,
      hash,
      request: (param) =>
        apiClient.sessions[":paneId"].commits[":hash"].file.$get({ param, query }),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.commitFile,
    });
  };

  const requestStateTimeline = async (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
  ): Promise<SessionStateTimeline> => {
    const query = buildTimelineQuery(options);
    return requestPaneQueryValue<{ timeline?: SessionStateTimeline }, "timeline">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].timeline.$get({ param, query }),
      field: "timeline",
      fallbackMessage: API_ERROR_MESSAGES.timeline,
    });
  };

  const requestRepoNotes = async (paneId: string): Promise<RepoNote[]> => {
    return requestPaneQueryValue<{ notes?: RepoNote[] }, "notes">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].notes.$get({ param }),
      field: "notes",
      fallbackMessage: API_ERROR_MESSAGES.repoNotes,
    });
  };

  const requestRepoFileTree = async (
    paneId: string,
    options?: { path?: string; cursor?: string; limit?: number; worktreePath?: string },
  ): Promise<RepoFileTreePage> => {
    const query = buildRepoFileTreeQuery(options);
    return requestPaneQueryValue<{ tree?: RepoFileTreePage }, "tree">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].files.tree.$get({ param, query }),
      field: "tree",
      fallbackMessage: API_ERROR_MESSAGES.fileTree,
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
  ): Promise<RepoFileSearchPage> => {
    const query = buildRepoFileSearchQuery(queryValue, options);
    return requestPaneQueryValue<{ result?: RepoFileSearchPage }, "result">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].files.search.$get({ param, query }),
      field: "result",
      fallbackMessage: API_ERROR_MESSAGES.fileSearch,
    });
  };

  const requestRepoFileContent = async (
    paneId: string,
    path: string,
    options?: { maxBytes?: number; worktreePath?: string },
  ): Promise<RepoFileContent> => {
    const query = buildRepoFileContentQuery(path, options);
    return requestPaneQueryValue<{ file?: RepoFileContent }, "file">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].files.content.$get({ param, query }),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.fileContent,
    });
  };

  const requestWorktrees = async (paneId: string): Promise<WorktreeList> => {
    return requestPaneQueryValue<{ worktrees?: WorktreeList }, "worktrees">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].worktrees.$get({ param }),
      field: "worktrees",
      fallbackMessage: "Failed to load worktrees",
    });
  };

  const requestBranches = async (
    paneId: string,
    options?: { force?: boolean },
  ): Promise<BranchList> => {
    const query = buildForceQuery(options);
    return requestPaneQueryValue<{ branches?: BranchList }, "branches">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].branches.$get({ param, query }),
      field: "branches",
      fallbackMessage: "Failed to load branches",
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
