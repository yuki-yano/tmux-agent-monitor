import type {
  CommitDetail,
  CommitFileDiff,
  CommitLog,
  DiffFile,
  DiffSummary,
  SessionStateTimeline,
  SessionStateTimelineRange,
} from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import type { ApiClientContract, PaneHashParam, PaneParam } from "./session-api-contract";
import {
  buildCommitFileQuery,
  buildCommitLogQuery,
  buildDiffFileQuery,
  buildForceQuery,
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

export const createSessionQueryRequests = ({
  apiClient,
  requestPaneQueryField,
  requestPaneHashField,
}: CreateSessionQueryRequestsParams) => {
  const requestDiffSummary = async (paneId: string, options?: { force?: boolean }) => {
    const query = buildForceQuery(options);
    return requestPaneQueryField<{ summary?: DiffSummary }, "summary">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].diff.$get({ param, query }),
      field: "summary",
      fallbackMessage: API_ERROR_MESSAGES.diffSummary,
    });
  };

  const requestDiffFile = async (
    paneId: string,
    filePath: string,
    rev?: string | null,
    options?: { force?: boolean },
  ) => {
    const query = buildDiffFileQuery(filePath, rev, options);
    return requestPaneQueryField<{ file?: DiffFile }, "file">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].diff.file.$get({ param, query }),
      field: "file",
      fallbackMessage: API_ERROR_MESSAGES.diffFile,
    });
  };

  const requestCommitLog = async (
    paneId: string,
    options?: { limit?: number; skip?: number; force?: boolean },
  ) => {
    const query = buildCommitLogQuery(options);
    return requestPaneQueryField<{ log?: CommitLog }, "log">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].commits.$get({ param, query }),
      field: "log",
      fallbackMessage: API_ERROR_MESSAGES.commitLog,
    });
  };

  const requestCommitDetail = async (
    paneId: string,
    hash: string,
    options?: { force?: boolean },
  ) => {
    const query = buildForceQuery(options);
    return requestPaneHashField<{ commit?: CommitDetail }, "commit">({
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
    options?: { force?: boolean },
  ) => {
    const query = buildCommitFileQuery(path, options);
    return requestPaneHashField<{ file?: CommitFileDiff }, "file">({
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
    options?: { range?: SessionStateTimelineRange; limit?: number },
  ): Promise<SessionStateTimeline> => {
    const query = buildTimelineQuery(options);
    return requestPaneQueryField<{ timeline?: SessionStateTimeline }, "timeline">({
      paneId,
      request: (param) => apiClient.sessions[":paneId"].timeline.$get({ param, query }),
      field: "timeline",
      fallbackMessage: API_ERROR_MESSAGES.timeline,
    });
  };

  return {
    requestDiffSummary,
    requestDiffFile,
    requestCommitLog,
    requestCommitDetail,
    requestCommitFile,
    requestStateTimeline,
  };
};
