import { describe, expect, it, vi } from "vitest";

import type { ApiClientContract, PaneHashParam, PaneParam } from "./session-api-contract";
import { createSessionQueryRequests } from "./session-api-query-requests";

type EndpointArgs = [args: unknown, options?: { init?: RequestInit }];

const createEndpoint = () =>
  vi.fn(async (..._args: EndpointArgs) => new Response(null, { status: 200 }));

describe("createSessionQueryRequests", () => {
  it("passes the caller AbortSignal to every Hono read request", async () => {
    const endpoints = {
      completions: createEndpoint(),
      diffSummary: createEndpoint(),
      diffFile: createEndpoint(),
      commitLog: createEndpoint(),
      commitDetail: createEndpoint(),
      commitFile: createEndpoint(),
      timeline: createEndpoint(),
      notes: createEndpoint(),
      fileTree: createEndpoint(),
      fileSearch: createEndpoint(),
      fileContent: createEndpoint(),
      worktrees: createEndpoint(),
      branches: createEndpoint(),
    };
    const apiClient = {
      sessions: {
        ":paneId": {
          completions: { $get: endpoints.completions },
          diff: { $get: endpoints.diffSummary, file: { $get: endpoints.diffFile } },
          commits: {
            $get: endpoints.commitLog,
            ":hash": { $get: endpoints.commitDetail, file: { $get: endpoints.commitFile } },
          },
          timeline: { $get: endpoints.timeline },
          notes: { $get: endpoints.notes },
          files: {
            tree: { $get: endpoints.fileTree },
            search: { $get: endpoints.fileSearch },
            content: { $get: endpoints.fileContent },
          },
          worktrees: { $get: endpoints.worktrees },
          branches: { $get: endpoints.branches },
        },
      },
    } as unknown as ApiClientContract;
    const requestPaneQueryField = async <T, K extends keyof T>(params: {
      paneId: string;
      request: (param: PaneParam, signal?: AbortSignal) => Promise<Response>;
      field: K;
      fallbackMessage: string;
      signal?: AbortSignal;
    }) => {
      await params.request({ paneId: params.paneId }, params.signal);
      return undefined as unknown as NonNullable<T[K]>;
    };
    const requestPaneHashField = async <T, K extends keyof T>(params: {
      paneId: string;
      hash: string;
      request: (param: PaneHashParam, signal?: AbortSignal) => Promise<Response>;
      field: K;
      fallbackMessage: string;
      signal?: AbortSignal;
    }) => {
      await params.request({ paneId: params.paneId, hash: params.hash }, params.signal);
      return undefined as unknown as NonNullable<T[K]>;
    };
    const requests = createSessionQueryRequests({
      apiClient,
      requestPaneQueryField,
      requestPaneHashField,
    });
    const signal = new AbortController().signal;

    await Promise.all([
      requests.requestPromptCompletions("pane-1", "at", "query", signal),
      requests.requestDiffSummary("pane-1", { mode: "total" }, signal),
      requests.requestDiffFile("pane-1", "file.ts", "rev-1", { mode: "total" }, signal),
      requests.requestCommitLog("pane-1", undefined, signal),
      requests.requestCommitDetail("pane-1", "hash-1", undefined, signal),
      requests.requestCommitFile("pane-1", "hash-1", "file.ts", undefined, signal),
      requests.requestStateTimeline("pane-1", undefined, signal),
      requests.requestRepoNotes("pane-1", signal),
      requests.requestRepoFileTree("pane-1", undefined, signal),
      requests.requestRepoFileSearch("pane-1", "query", undefined, signal),
      requests.requestRepoFileContent("pane-1", "file.ts", undefined, signal),
      requests.requestWorktrees("pane-1", signal),
      requests.requestBranches("pane-1", undefined, signal),
    ]);

    for (const endpoint of Object.values(endpoints)) {
      expect(endpoint).toHaveBeenCalledTimes(1);
      expect(endpoint.mock.calls[0]?.[1]).toEqual({ init: { signal } });
    }
  });
});
