import { CancelledError, isCancelledError, useQueryClient } from "@tanstack/react-query";
import type { RepoFileSearchPage } from "@vde-monitor/shared";
import { useCallback } from "react";

import {
  extractLogReferenceLocation,
  normalizeLogReference,
} from "@/features/shared-session-ui/lib/log-file-reference";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import {
  type FilesLookupController,
  collectFilesLookupMatches,
  nextFilesLookupInvocation,
  rememberPositiveFilesLookup,
  scanFilesLookupPages,
} from "./session-files-lookup-runtime";
import {
  type FilesScopeIdentity,
  normalizeAbsoluteLogFilePath,
  normalizeFilesQuery,
  normalizeRepoFilePath,
} from "./session-files-query-runtime";

const LOG_FILE_RESOLVE_MATCH_LIMIT = 20;
const LOG_FILE_RESOLVE_PAGE_LIMIT = 100;
const LOG_FILE_RESOLVE_MAX_SEARCH_PAGES = 20;
const LOG_REFERENCE_LINKABLE_CACHE_MAX = 1000;

export type LogFileCandidateItem = Pick<
  RepoFileSearchPage["items"][number],
  "path" | "name" | "isIgnored"
>;
export type LogCandidateState = {
  reference: string;
  targetPaneId: string;
  targetRoot: string;
  line: number | null;
  items: LogFileCandidateItem[];
} | null;

type RequestRepoFileSearch = (
  paneId: string,
  query: string,
  options?: {
    cursor?: string;
    limit?: number;
    worktreePath?: string;
    exactReference?: boolean;
  },
  signal?: AbortSignal,
) => Promise<RepoFileSearchPage>;

type OpenFileModalByPath = (
  path: string,
  options: {
    paneId: string;
    targetRoot: string;
    targetWorktreePath: string | null;
    origin: "navigator" | "log";
    highlightLine?: number | null;
  },
) => void;

const treeScopeParams = (scope: FilesScopeIdentity) => ({
  resolvedRoot: scope.resolvedRoot,
  worktreePath: scope.worktreePath,
});

export const useSessionFilesLookupActions = ({
  connected,
  controller,
  paneId,
  scope,
  requestRepoFileSearch,
  openFileModalByPath,
  setResolutionState,
}: {
  connected: boolean;
  controller: FilesLookupController;
  paneId: string;
  scope: FilesScopeIdentity;
  requestRepoFileSearch: RequestRepoFileSearch;
  openFileModalByPath: OpenFileModalByPath;
  setResolutionState: (error: string | null, candidate: LogCandidateState) => void;
}) => {
  const queryClient = useQueryClient();
  const fetchLookupPage = useCallback(
    async ({
      targetPaneId,
      targetRoot,
      query,
      cursor,
      exactReference,
      generation,
    }: {
      targetPaneId: string;
      targetRoot: string;
      query: string;
      cursor: string | null;
      exactReference: boolean;
      generation: number;
    }) => {
      if (!connected || generation !== controller.generation) throw new CancelledError();
      const queryKey = sessionDetailQueryKeys.filesLookup(paneId, treeScopeParams(scope), {
        targetPaneId,
        targetRoot,
        query,
        cursor,
        limit: LOG_FILE_RESOLVE_PAGE_LIMIT,
        exactReference,
      });
      const page = await queryClient.fetchQuery({
        queryKey,
        queryFn: async ({ signal }) => {
          const response = await requestRepoFileSearch(
            targetPaneId,
            query,
            {
              ...(cursor == null ? {} : { cursor }),
              limit: LOG_FILE_RESOLVE_PAGE_LIMIT,
              worktreePath: targetRoot,
              exactReference,
            },
            signal,
          );
          if (signal.aborted || generation !== controller.generation || !connected) {
            throw new CancelledError();
          }
          if (normalizeFilesQuery(response.query) !== query) {
            throw new Error(API_ERROR_MESSAGES.fileSearch);
          }
          return response;
        },
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
        networkMode: "online",
      });
      if (generation !== controller.generation || !connected) throw new CancelledError();
      return page;
    },
    [connected, controller, paneId, queryClient, requestRepoFileSearch, scope],
  );
  const scanLookup = useCallback(
    async ({
      targetPaneId,
      targetRoot,
      query,
      exactReference,
      generation,
    }: {
      targetPaneId: string;
      targetRoot: string;
      query: string;
      exactReference: boolean;
      generation: number;
    }) =>
      scanFilesLookupPages({
        maxPages: LOG_FILE_RESOLVE_MAX_SEARCH_PAGES,
        fetchPage: (cursor) =>
          fetchLookupPage({
            targetPaneId,
            targetRoot,
            query,
            cursor,
            exactReference,
            generation,
          }),
      }),
    [fetchLookupPage],
  );
  const resolveReference = useCallback(
    async ({
      rawToken,
      sourcePaneId,
      sourceRepoRoot,
      open,
      invocation,
    }: {
      rawToken: string;
      sourcePaneId: string;
      sourceRepoRoot: string | null;
      open: boolean;
      invocation?: number;
    }) => {
      if (!connected || sourcePaneId.trim() === "" || sourceRepoRoot == null) {
        if (open) setResolutionState("Session context is unavailable.", null);
        return false;
      }
      const reference = normalizeLogReference(rawToken, { sourceRepoRoot });
      if (reference.kind === "unknown") return false;
      const location = extractLogReferenceLocation(rawToken);
      const generation = controller.generation;
      const assertCurrent = () => {
        if (
          generation !== controller.generation ||
          !connected ||
          (open && invocation !== controller.invocation)
        ) {
          throw new CancelledError();
        }
      };
      const tryExact = async (path: string) => {
        const normalizedPath = path.startsWith("/")
          ? normalizeAbsoluteLogFilePath(path)
          : normalizeRepoFilePath(path);
        if (normalizedPath == null) return { matched: false, incomplete: false, path: null };
        const result = await scanLookup({
          targetPaneId: sourcePaneId,
          targetRoot: sourceRepoRoot,
          query: normalizedPath,
          exactReference: true,
          generation,
        });
        assertCurrent();
        return {
          matched: result.items.some(
            (item) =>
              item.kind === "file" &&
              (normalizedPath.startsWith("/")
                ? normalizeAbsoluteLogFilePath(item.path)
                : normalizeRepoFilePath(item.path)) === normalizedPath,
          ),
          incomplete: result.incomplete,
          path: normalizedPath,
        };
      };
      try {
        const exactSubject = reference.normalizedPath ?? reference.filename;
        if (exactSubject != null) {
          const normalizedExactSubject = exactSubject.startsWith("/")
            ? normalizeAbsoluteLogFilePath(exactSubject)
            : normalizeRepoFilePath(exactSubject);
          if (normalizedExactSubject == null) {
            if (open) setResolutionState(`File not found: ${reference.display}`, null);
            return false;
          }
          const exact = await tryExact(normalizedExactSubject);
          if (exact.incomplete) throw new Error("File lookup is incomplete.");
          if (exact.matched && exact.path != null) {
            if (open) {
              openFileModalByPath(exact.path, {
                paneId: sourcePaneId,
                targetRoot: sourceRepoRoot,
                targetWorktreePath: sourceRepoRoot,
                origin: "log",
                highlightLine: location.line,
              });
            }
            return true;
          }
        }
        if (reference.filename == null || reference.normalizedPath?.startsWith("/")) {
          if (open) setResolutionState(`File not found: ${reference.display}`, null);
          return false;
        }
        const fallback = await scanLookup({
          targetPaneId: sourcePaneId,
          targetRoot: sourceRepoRoot,
          query: reference.filename,
          exactReference: false,
          generation,
        });
        assertCurrent();
        if (fallback.incomplete) throw new Error("File lookup is incomplete.");
        const matches = collectFilesLookupMatches(fallback.items, reference.filename);
        if (matches.length === 0) {
          if (open) setResolutionState(`No file matched: ${reference.filename}`, null);
          return false;
        }
        if (open && matches.length === 1 && matches[0] != null) {
          openFileModalByPath(matches[0].path, {
            paneId: sourcePaneId,
            targetRoot: sourceRepoRoot,
            targetWorktreePath: sourceRepoRoot,
            origin: "log",
            highlightLine: location.line,
          });
        } else if (open) {
          setResolutionState(null, {
            reference: reference.display,
            targetPaneId: sourcePaneId,
            targetRoot: sourceRepoRoot,
            line: location.line,
            items: matches.slice(0, LOG_FILE_RESOLVE_MATCH_LIMIT),
          });
        }
        return true;
      } catch (error) {
        if (
          !isCancelledError(error) &&
          open &&
          generation === controller.generation &&
          invocation === controller.invocation
        ) {
          setResolutionState(
            resolveUnknownErrorMessage(error, "Failed to resolve file reference."),
            null,
          );
        }
        return false;
      }
    },
    [connected, controller, openFileModalByPath, scanLookup, setResolutionState],
  );
  const isLogFileReferenceLinkable = useCallback(
    async (args: { rawToken: string; sourcePaneId: string; sourceRepoRoot: string | null }) => {
      const reference = normalizeLogReference(args.rawToken, {
        sourceRepoRoot: args.sourceRepoRoot,
      });
      if (reference.kind === "unknown" || args.sourceRepoRoot == null) return false;
      const cacheKey = `${args.sourcePaneId}:${args.sourceRepoRoot}:${reference.kind}:${reference.normalizedPath ?? reference.filename ?? reference.display}`;
      if (controller.positive.has(cacheKey)) return true;
      const generation = controller.generation;
      const inFlightKey = `${generation}:${cacheKey}`;
      const existing = controller.inFlight.get(inFlightKey);
      if (existing != null) return existing;
      const request = resolveReference({ ...args, open: false }).then((linkable) => {
        if (linkable && generation === controller.generation) {
          rememberPositiveFilesLookup(controller, cacheKey, LOG_REFERENCE_LINKABLE_CACHE_MAX);
        }
        return linkable;
      });
      controller.inFlight.set(inFlightKey, request);
      return request.finally(() => {
        if (controller.inFlight.get(inFlightKey) === request) {
          controller.inFlight.delete(inFlightKey);
        }
      });
    },
    [controller, resolveReference],
  );
  const onResolveLogFileReferenceCandidates = useCallback(
    async (args: { rawTokens: string[]; sourcePaneId: string; sourceRepoRoot: string | null }) => {
      if (args.sourceRepoRoot == null) return [];
      const unique = [...new Set(args.rawTokens.filter((token) => token.trim() !== ""))];
      const resolved = await Promise.all(
        unique.map(async (rawToken) =>
          (await isLogFileReferenceLinkable({ ...args, rawToken })) ? rawToken : null,
        ),
      );
      return resolved.filter((token): token is string => token != null);
    },
    [isLogFileReferenceLinkable],
  );
  const onResolveLogFileReference = useCallback(
    async (args: { rawToken: string; sourcePaneId: string; sourceRepoRoot: string | null }) => {
      const invocation = nextFilesLookupInvocation(controller);
      setResolutionState(null, null);
      await resolveReference({ ...args, open: true, invocation });
    },
    [controller, resolveReference, setResolutionState],
  );

  return { onResolveLogFileReference, onResolveLogFileReferenceCandidates };
};
