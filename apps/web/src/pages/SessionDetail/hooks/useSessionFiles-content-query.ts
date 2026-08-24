import { type UseQueryOptions, useQueries } from "@tanstack/react-query";
import type { RepoFileContent } from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  type CommittedFilesLifetimeRef,
  type ContentTarget,
  type FilesScopeIdentity,
  type PreviewLeaseController,
  normalizeAbsoluteLogFilePath,
  normalizeRepoFilePath,
} from "./session-files-query-runtime";

export const useSessionFilesContentQuery = ({
  connected,
  contentTarget,
  contentQueryKey,
  maxBytes,
  scope,
  committedLifetimeRef,
  previewLeases,
  requestRepoFileContent,
}: {
  connected: boolean;
  contentTarget: ContentTarget | null;
  contentQueryKey: readonly unknown[] | null;
  maxBytes: number;
  scope: FilesScopeIdentity;
  committedLifetimeRef: CommittedFilesLifetimeRef;
  previewLeases: PreviewLeaseController;
  requestRepoFileContent: (
    paneId: string,
    path: string,
    options?: { maxBytes?: number; worktreePath?: string },
    signal?: AbortSignal,
  ) => Promise<RepoFileContent>;
}) => {
  const queryOptions: UseQueryOptions<RepoFileContent, Error>[] =
    contentTarget == null || contentQueryKey == null
      ? []
      : [
          {
            queryKey: contentQueryKey,
            queryFn: async ({ signal }: { signal: AbortSignal }) => {
              const file = await requestRepoFileContent(
                contentTarget.targetPaneId,
                contentTarget.path,
                { maxBytes, worktreePath: contentTarget.targetRoot },
                signal,
              );
              const token = file.preview?.token;
              previewLeases.register(contentTarget.targetPaneId, token);
              try {
                committedLifetimeRef.assertContent(scope, contentTarget, signal);
              } catch (error) {
                previewLeases.releaseToken(contentTarget.targetPaneId, token);
                throw error;
              }
              const returnedPath = contentTarget.path.startsWith("/")
                ? normalizeAbsoluteLogFilePath(file.path)
                : normalizeRepoFilePath(file.path);
              if (returnedPath !== contentTarget.path) {
                previewLeases.releaseToken(contentTarget.targetPaneId, token);
                throw new Error(API_ERROR_MESSAGES.fileContent);
              }
              return file;
            },
            enabled: connected,
            staleTime: Infinity,
            gcTime: 0,
            retry: false,
            networkMode: "online",
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        ];
  return useQueries({ queries: queryOptions })[0];
};
