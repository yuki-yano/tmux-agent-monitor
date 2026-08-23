import type { DiffFile, DiffMode, DiffSummary } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import {
  diffErrorAtom,
  diffFilesAtom,
  diffLoadingAtom,
  diffLoadingFilesAtom,
  diffOpenAtom,
  diffSummaryAtom,
} from "../atoms/diffAtoms";
import { AUTO_REFRESH_INTERVAL_MS, buildDiffSummarySnapshot } from "../sessionDetailUtils";
import { runScopedRequest } from "./session-request-guard";
import { useScopeGuard } from "./useScopeGuard";

type UseSessionDiffsParams = {
  paneId: string;
  connected: boolean;
  worktreePath?: string | null;
  branch?: string | null;
  requestDiffSummary: (
    paneId: string,
    options: { mode: DiffMode; force?: boolean; worktreePath?: string; branch?: string },
  ) => Promise<DiffSummary>;
  requestDiffFile: (
    paneId: string,
    path: string,
    rev: string | null | undefined,
    options: { mode: DiffMode; force?: boolean; worktreePath?: string; branch?: string },
  ) => Promise<DiffFile>;
};

// ---------------------------------------------------------------------------
// Module-level diff file cache (replaces TanStack Query cache)
// Key: `${paneId}\x00${worktreePath|__default__}:${branch|__no_branch__}:${mode}\x00${rev|unknown}\x00${path}`
// ---------------------------------------------------------------------------

const diffFileCache = new Map<string, DiffFile>();

const buildDiffFileCacheKey = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
) =>
  `${paneId}\x00${worktreePath ?? "__default__"}:${branch ?? "__no_branch__"}:${mode}\x00${rev ?? "unknown"}\x00${path}`;

const buildDiffFileCacheKeyPrefix = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
) => `${paneId}\x00${worktreePath ?? "__default__"}:${branch ?? "__no_branch__"}:${mode}\x00`;

const buildInFlightDiffFileKey = (
  scopeKey: string,
  generation: number,
  rev: string | null,
  path: string,
) => `${scopeKey}\x00${generation}\x00${rev ?? "unknown"}\x00${path}`;

const getDiffFileFromCache = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
): DiffFile | undefined =>
  diffFileCache.get(buildDiffFileCacheKey(paneId, worktreePath, branch, mode, rev, path));

const setDiffFileInCache = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
  file: DiffFile,
) => diffFileCache.set(buildDiffFileCacheKey(paneId, worktreePath, branch, mode, rev, path), file);

const clearDiffFileCacheForPane = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
) => {
  const prefix = buildDiffFileCacheKeyPrefix(paneId, worktreePath, branch, mode);
  for (const key of diffFileCache.keys()) {
    if (key.startsWith(prefix)) {
      diffFileCache.delete(key);
    }
  }
};

// Entries for stale revs are never read again (lookups always use the current
// summary rev), so drop them when the rev advances to keep the cache bounded.
const pruneDiffFileCacheToRev = (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
) => {
  const prefix = buildDiffFileCacheKeyPrefix(paneId, worktreePath, branch, mode);
  const keepPrefix = `${prefix}${rev ?? "unknown"}\x00`;
  for (const key of diffFileCache.keys()) {
    if (key.startsWith(prefix) && !key.startsWith(keepPrefix)) {
      diffFileCache.delete(key);
    }
  }
};

// Cache writes happen only after the caller confirms that the scope/revision
// generation that started the request is still current.
const fetchCurrentDiffFileWithCache = async (
  paneId: string,
  worktreePath: string | null,
  branch: string | null,
  mode: DiffMode,
  rev: string | null,
  path: string,
  inFlightRequests: Map<string, Promise<DiffFile>>,
  inFlightKey: string,
  isCurrent: () => boolean,
  queryFn: () => Promise<DiffFile>,
): Promise<DiffFile | null> => {
  const cached = getDiffFileFromCache(paneId, worktreePath, branch, mode, rev, path);
  if (cached) {
    return isCurrent() ? cached : null;
  }
  let request = inFlightRequests.get(inFlightKey);
  if (!request) {
    request = queryFn();
    inFlightRequests.set(inFlightKey, request);
  }
  try {
    const file = await request;
    if (!isCurrent()) {
      return null;
    }
    setDiffFileInCache(paneId, worktreePath, branch, mode, rev, path, file);
    return file;
  } finally {
    if (inFlightRequests.get(inFlightKey) === request) {
      inFlightRequests.delete(inFlightKey);
    }
  }
};

export const useSessionDiffs = ({
  paneId,
  connected,
  worktreePath = null,
  branch = null,
  requestDiffSummary,
  requestDiffFile,
}: UseSessionDiffsParams) => {
  const [worktreeDiffMode, setWorktreeDiffMode] = useState<DiffMode>("total");
  const diffMode: DiffMode = branch == null ? worktreeDiffMode : "committed";
  const [diffSummary, setDiffSummary] = useAtom(diffSummaryAtom);
  const [diffError, setDiffError] = useAtom(diffErrorAtom);
  const [diffLoading, setDiffLoading] = useAtom(diffLoadingAtom);
  const [diffFiles, setDiffFiles] = useAtom(diffFilesAtom);
  const [diffOpen, setDiffOpen] = useAtom(diffOpenAtom);
  const [diffLoadingFiles, setDiffLoadingFiles] = useAtom(diffLoadingFilesAtom);

  const diffOpenRef = useRef<Record<string, boolean>>({});
  const diffSnapshotRef = useRef<string | null>(null);
  const diffSummaryRevRef = useRef<string | null>(null);
  const diffScopeGenerationRef = useRef(0);
  const [inFlightDiffFiles] = useState(() => new Map<string, Promise<DiffFile>>());
  const onReconnectRef = useRef<() => void>(() => {});
  const pollTickRef = useRef<() => void>(() => {});
  const { scopeKey: requestScopeKey, activeScopeRef } = useScopeGuard({
    paneId,
    worktreePath,
    branch,
    variant: diffMode,
    connected,
    onReconnectRef,
    pollTickRef,
    pollIntervalMs: AUTO_REFRESH_INTERVAL_MS,
  });
  const summaryRequestIdRef = useRef(0);

  useLayoutEffect(() => {
    diffScopeGenerationRef.current += 1;
    diffSnapshotRef.current = null;
    diffSummaryRevRef.current = null;
  }, [requestScopeKey]);

  const requestOptions = useMemo(
    () =>
      branch
        ? ({ force: true, branch, mode: "committed" } as const)
        : worktreePath
          ? ({ force: true, worktreePath, mode: diffMode } as const)
          : ({ force: true, mode: diffMode } as const),
    [branch, diffMode, worktreePath],
  );

  const applyDiffSummary = useCallback(
    (summary: DiffSummary, refreshOpenFiles: boolean, targetScopeKey: string) => {
      const targetSnapshot = buildDiffSummarySnapshot(summary);
      const snapshotChanged = diffSnapshotRef.current !== targetSnapshot;
      if (snapshotChanged) {
        diffScopeGenerationRef.current += 1;
        setDiffLoadingFiles({});
        clearDiffFileCacheForPane(paneId, worktreePath, branch, diffMode);
      }
      diffSummaryRevRef.current = summary.rev;
      diffSnapshotRef.current = targetSnapshot;
      const targetGeneration = diffScopeGenerationRef.current;
      const isCurrentRevision = () =>
        activeScopeRef.current === targetScopeKey &&
        diffScopeGenerationRef.current === targetGeneration &&
        diffSummaryRevRef.current === summary.rev &&
        diffSnapshotRef.current === targetSnapshot;
      pruneDiffFileCacheToRev(paneId, worktreePath, branch, diffMode, summary.rev);
      setDiffSummary(summary);
      const fileSet = new Set(summary.files.map((file) => file.path));
      setDiffOpen((prev) => {
        if (!summary.files.length) {
          return {};
        }
        const next: Record<string, boolean> = {};
        Object.entries(prev).forEach(([key, value]) => {
          if (fileSet.has(key)) {
            next[key] = value;
          }
        });
        return next;
      });
      const openTargets = Object.entries(diffOpenRef.current).filter(
        ([path, value]) => value && fileSet.has(path),
      );
      const cachedFiles = openTargets.reduce<Record<string, DiffFile>>((acc, [path]) => {
        const cached = getDiffFileFromCache(
          paneId,
          worktreePath,
          branch,
          diffMode,
          summary.rev,
          path,
        );
        if (cached) {
          acc[path] = cached;
        }
        return acc;
      }, {});
      setDiffFiles(cachedFiles);
      if (openTargets.length > 0 && refreshOpenFiles) {
        void Promise.all(
          openTargets.map(async ([path]) => {
            const cacheMiss = cachedFiles[path] == null;
            if (cacheMiss) {
              setDiffLoadingFiles((prev) => ({ ...prev, [path]: true }));
            }
            try {
              const file = await fetchCurrentDiffFileWithCache(
                paneId,
                worktreePath,
                branch,
                diffMode,
                summary.rev,
                path,
                inFlightDiffFiles,
                buildInFlightDiffFileKey(targetScopeKey, targetGeneration, summary.rev, path),
                isCurrentRevision,
                () => requestDiffFile(paneId, path, summary.rev, requestOptions),
              );
              if (file == null) {
                return;
              }
              setDiffFiles((prev) => ({ ...prev, [path]: file }));
            } catch (err) {
              if (!isCurrentRevision()) {
                return;
              }
              setDiffError(resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.diffFile));
            } finally {
              if (cacheMiss && isCurrentRevision()) {
                setDiffLoadingFiles((prev) => ({ ...prev, [path]: false }));
              }
            }
          }),
        );
      }
    },
    [
      activeScopeRef,
      branch,
      diffMode,
      inFlightDiffFiles,
      paneId,
      requestDiffFile,
      requestOptions,
      setDiffError,
      setDiffFiles,
      setDiffLoadingFiles,
      setDiffOpen,
      setDiffSummary,
      worktreePath,
    ],
  );

  const loadDiffSummary = useCallback(async () => {
    if (!paneId) return;
    const targetScopeKey = requestScopeKey;
    setDiffLoading(true);
    setDiffError(null);
    await runScopedRequest({
      requestIdRef: summaryRequestIdRef,
      activeScopeRef,
      scopeKey: targetScopeKey,
      run: () => requestDiffSummary(paneId, requestOptions),
      onSuccess: (summary) => {
        applyDiffSummary(summary, true, targetScopeKey);
        setDiffLoading(false);
      },
      onError: (err) => {
        setDiffError(resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.diffSummary));
        setDiffLoading(false);
      },
      onSettled: ({ isCurrent }) => {
        if (isCurrent()) {
          setDiffLoading(false);
        }
      },
    });
  }, [
    activeScopeRef,
    applyDiffSummary,
    paneId,
    requestDiffSummary,
    requestOptions,
    requestScopeKey,
    setDiffError,
    setDiffLoading,
  ]);

  const pollDiffSummary = useCallback(async () => {
    if (!paneId) return;
    const targetScopeKey = requestScopeKey;
    await runScopedRequest({
      requestIdRef: summaryRequestIdRef,
      activeScopeRef,
      scopeKey: targetScopeKey,
      run: () => requestDiffSummary(paneId, requestOptions),
      onSuccess: (summary) => {
        setDiffLoading(false);
        const snapshot = buildDiffSummarySnapshot(summary);
        if (snapshot === diffSnapshotRef.current) {
          return;
        }
        setDiffError(null);
        applyDiffSummary(summary, true, targetScopeKey);
      },
      onSettled: ({ isCurrent }) => {
        if (isCurrent()) {
          setDiffLoading(false);
        }
      },
    });
  }, [
    activeScopeRef,
    applyDiffSummary,
    paneId,
    requestDiffSummary,
    requestOptions,
    requestScopeKey,
    setDiffError,
    setDiffLoading,
  ]);
  const pollDiffSummaryTick = useCallback(() => {
    void pollDiffSummary();
  }, [pollDiffSummary]);

  // Keep scope-guard callbacks current before its passive reconnect/polling
  // effects can run, without mutating refs during render.
  useLayoutEffect(() => {
    onReconnectRef.current = () => {
      void loadDiffSummary();
    };
    pollTickRef.current = pollDiffSummaryTick;
  }, [loadDiffSummary, onReconnectRef, pollDiffSummaryTick, pollTickRef]);

  const diffSummaryRev = diffSummary?.rev ?? null;
  const loadDiffFile = useCallback(
    async (path: string) => {
      if (!paneId || !diffSummaryRev || diffSnapshotRef.current == null) return;
      if (diffLoadingFiles[path]) return;
      const cached = getDiffFileFromCache(
        paneId,
        worktreePath,
        branch,
        diffMode,
        diffSummaryRev,
        path,
      );
      if (cached) {
        setDiffFiles((prev) => ({ ...prev, [path]: cached }));
        return;
      }
      const targetScopeKey = requestScopeKey;
      const targetRev = diffSummaryRev;
      const targetGeneration = diffScopeGenerationRef.current;
      const targetSnapshot = diffSnapshotRef.current;
      const isCurrentRevision = () =>
        activeScopeRef.current === targetScopeKey &&
        diffScopeGenerationRef.current === targetGeneration &&
        diffSummaryRevRef.current === targetRev &&
        diffSnapshotRef.current === targetSnapshot;
      setDiffLoadingFiles((prev) => ({ ...prev, [path]: true }));
      try {
        // False positive: the scope/request guard depends on the resolved file.
        // react-doctor-disable-next-line async-defer-await
        const file = await fetchCurrentDiffFileWithCache(
          paneId,
          worktreePath,
          branch,
          diffMode,
          targetRev,
          path,
          inFlightDiffFiles,
          buildInFlightDiffFileKey(targetScopeKey, targetGeneration, targetRev, path),
          isCurrentRevision,
          () => requestDiffFile(paneId, path, targetRev, requestOptions),
        );
        if (file == null) {
          return;
        }
        setDiffFiles((prev) => ({ ...prev, [path]: file }));
      } catch (err) {
        if (!isCurrentRevision()) {
          return;
        }
        setDiffError(resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.diffFile));
      } finally {
        if (isCurrentRevision()) {
          setDiffLoadingFiles((prev) => ({ ...prev, [path]: false }));
        }
      }
    },
    [
      activeScopeRef,
      branch,
      diffMode,
      diffLoadingFiles,
      diffSummaryRev,
      inFlightDiffFiles,
      paneId,
      requestScopeKey,
      requestDiffFile,
      requestOptions,
      setDiffError,
      setDiffFiles,
      setDiffLoadingFiles,
      worktreePath,
    ],
  );

  const toggleDiff = useCallback(
    (path: string) => {
      setDiffOpen((prev) => {
        const nextOpen = !prev[path];
        if (nextOpen) {
          void loadDiffFile(path);
        }
        return { ...prev, [path]: nextOpen };
      });
    },
    [loadDiffFile, setDiffOpen],
  );

  // False positive: diff summary loading is lifecycle IO keyed by pane/worktree,
  // and moving it to render or a user event would skip the initial load.
  useEffect(() => {
    // react-doctor-disable-next-line no-pass-data-to-parent
    void loadDiffSummary();
  }, [loadDiffSummary]);

  useEffect(() => {
    setDiffSummary(null);
    setDiffFiles({});
    setDiffOpen({});
    setDiffLoadingFiles({});
    setDiffError(null);
    return () => {
      clearDiffFileCacheForPane(paneId, worktreePath, branch, diffMode);
    };
  }, [
    branch,
    diffMode,
    paneId,
    setDiffError,
    setDiffFiles,
    setDiffLoadingFiles,
    setDiffOpen,
    setDiffSummary,
    worktreePath,
  ]);

  useEffect(() => {
    diffOpenRef.current = diffOpen;
  }, [diffOpen]);

  return {
    diffSummary,
    diffError,
    diffLoading,
    diffFiles,
    diffOpen,
    diffLoadingFiles,
    refreshDiff: loadDiffSummary,
    diffMode,
    setDiffMode: setWorktreeDiffMode,
    toggleDiff,
    ensureDiffFile: loadDiffFile,
  };
};
