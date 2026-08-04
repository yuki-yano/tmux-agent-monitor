import type { CommitDetail, CommitFileDiff, CommitLog } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

import { commitStateAtom } from "../atoms/commitAtoms";
import { AUTO_REFRESH_INTERVAL_MS, buildCommitLogSnapshot } from "../sessionDetailUtils";
import { type CommitAction, commitReducer } from "./commit-state-machine";
import { runScopedRequest } from "./session-request-guard";
import { useScopeGuard } from "./useScopeGuard";

type UseSessionCommitsParams = {
  paneId: string;
  connected: boolean;
  worktreePath?: string | null;
  branch?: string | null;
  requestCommitLog: (
    paneId: string,
    options?: {
      limit?: number;
      skip?: number;
      force?: boolean;
      worktreePath?: string;
      branch?: string;
    },
  ) => Promise<CommitLog>;
  requestCommitDetail: (
    paneId: string,
    hash: string,
    options?: { force?: boolean; worktreePath?: string },
  ) => Promise<CommitDetail>;
  requestCommitFile: (
    paneId: string,
    hash: string,
    path: string,
    options?: { force?: boolean; worktreePath?: string },
  ) => Promise<CommitFileDiff>;
};

type CommitDispatch = (action: CommitAction) => void;

const resolveCommitLogError = (err: unknown) =>
  resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.commitLog);

const dispatchCommitLogError = (dispatch: CommitDispatch, append: boolean, err: unknown) => {
  if (append) {
    return;
  }
  dispatch({ type: "setCommitError", error: resolveCommitLogError(err) });
};

const resolveCommitLogLoadOptions = (options?: { append?: boolean; force?: boolean }) => ({
  append: options?.append ?? false,
  force: options?.force,
});

const resolveCommitLogSkip = (append: boolean, commitLog: CommitLog | null) => {
  if (!append) {
    return 0;
  }
  return commitLog?.commits.length ?? 0;
};

export const useSessionCommits = ({
  paneId,
  connected,
  worktreePath = null,
  branch = null,
  requestCommitLog,
  requestCommitDetail,
  requestCommitFile,
}: UseSessionCommitsParams) => {
  const commitPageSize = 10;
  const [state, setState] = useAtom(commitStateAtom);
  const dispatch = useCallback(
    (action: CommitAction) => {
      setState((prev) => commitReducer(prev, action));
    },
    [setState],
  );
  const {
    commitLog,
    commitError,
    commitLoading,
    commitLoadingMore,
    commitHasMore,
    commitDetails,
    commitFileDetails,
    commitFileOpen,
    commitFileLoading,
    commitOpen,
    commitLoadingDetails,
    copiedHash,
  } = state;

  const commitLogRef = useRef<CommitLog | null>(null);
  const commitSnapshotRef = useRef<string | null>(null);
  const commitCopyTimeoutRef = useRef<number | null>(null);
  const onReconnectRef = useRef<() => void>(() => {});
  const pollTickRef = useRef<() => void>(() => {});
  const { scopeKey: requestScopeKey, activeScopeRef } = useScopeGuard({
    paneId,
    worktreePath,
    branch,
    connected,
    onReconnectRef,
    pollTickRef,
    pollIntervalMs: AUTO_REFRESH_INTERVAL_MS,
  });
  const commitLogRequestIdRef = useRef(0);

  const commitLogScopeOptions = useMemo(
    () => (branch ? { branch } : worktreePath ? { worktreePath } : {}),
    [branch, worktreePath],
  );

  const applyCommitLog = useCallback(
    (log: CommitLog, options: { append: boolean; updateSignature: boolean }) => {
      dispatch({ type: "applyCommitLog", log, append: options.append, pageSize: commitPageSize });
      if (options.updateSignature) {
        commitSnapshotRef.current = buildCommitLogSnapshot(log);
      }
    },
    [commitPageSize, dispatch],
  );

  const loadCommitLog = useCallback(
    async (options?: { append?: boolean; force?: boolean }) => {
      if (!paneId) return;
      const targetScopeKey = requestScopeKey;
      const { append, force } = resolveCommitLogLoadOptions(options);
      dispatch({ type: "startLogLoad", append });
      dispatch({ type: "setCommitError", error: null });
      await runScopedRequest({
        requestIdRef: commitLogRequestIdRef,
        activeScopeRef,
        scopeKey: targetScopeKey,
        run: () => {
          const skip = resolveCommitLogSkip(append, commitLogRef.current);
          return requestCommitLog(paneId, {
            limit: commitPageSize,
            skip,
            force,
            ...commitLogScopeOptions,
          });
        },
        onSuccess: (log) => {
          applyCommitLog(log, { append, updateSignature: !append });
        },
        onError: (err) => {
          dispatchCommitLogError(dispatch, append, err);
        },
        onSettled: ({ isCurrent }) => {
          if (isCurrent()) {
            dispatch({ type: "finishLogLoad", append });
          }
        },
      });
    },
    [
      activeScopeRef,
      applyCommitLog,
      commitLogScopeOptions,
      commitPageSize,
      dispatch,
      paneId,
      requestCommitLog,
      requestScopeKey,
    ],
  );

  const loadCommitDetail = useCallback(
    async (hash: string) => {
      if (!paneId || commitLoadingDetails[hash]) return;
      const targetScopeKey = requestScopeKey;
      dispatch({ type: "setCommitLoadingDetails", hash, loading: true });
      try {
        const detail = await requestCommitDetail(
          paneId,
          hash,
          worktreePath ? { force: true, worktreePath } : { force: true },
        );
        if (activeScopeRef.current !== targetScopeKey) {
          return;
        }
        dispatch({ type: "setCommitDetail", hash, detail });
      } catch (err) {
        if (activeScopeRef.current !== targetScopeKey) {
          return;
        }
        dispatch({
          type: "setCommitError",
          error: resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.commitDetail),
        });
      } finally {
        if (activeScopeRef.current === targetScopeKey) {
          dispatch({ type: "setCommitLoadingDetails", hash, loading: false });
        }
      }
    },
    [
      activeScopeRef,
      commitLoadingDetails,
      dispatch,
      paneId,
      requestCommitDetail,
      requestScopeKey,
      worktreePath,
    ],
  );

  const loadCommitFile = useCallback(
    async (hash: string, path: string) => {
      if (!paneId) return;
      const key = `${hash}:${path}`;
      if (commitFileLoading[key]) return;
      const targetScopeKey = requestScopeKey;
      dispatch({ type: "setCommitFileLoading", key, loading: true });
      try {
        const file = await requestCommitFile(
          paneId,
          hash,
          path,
          worktreePath ? { force: true, worktreePath } : { force: true },
        );
        if (activeScopeRef.current !== targetScopeKey) {
          return;
        }
        dispatch({ type: "setCommitFileDetail", key, file });
      } catch (err) {
        if (activeScopeRef.current !== targetScopeKey) {
          return;
        }
        dispatch({
          type: "setCommitError",
          error: resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.commitFile),
        });
      } finally {
        if (activeScopeRef.current === targetScopeKey) {
          dispatch({ type: "setCommitFileLoading", key, loading: false });
        }
      }
    },
    [
      activeScopeRef,
      commitFileLoading,
      dispatch,
      paneId,
      requestCommitFile,
      requestScopeKey,
      worktreePath,
    ],
  );

  const pollCommitLog = useCallback(async () => {
    if (!paneId) return;
    const targetScopeKey = requestScopeKey;
    await runScopedRequest({
      requestIdRef: commitLogRequestIdRef,
      activeScopeRef,
      scopeKey: targetScopeKey,
      run: () =>
        requestCommitLog(paneId, {
          limit: commitPageSize,
          skip: 0,
          force: true,
          ...commitLogScopeOptions,
        }),
      onSuccess: (log) => {
        const snapshot = buildCommitLogSnapshot(log);
        if (snapshot === commitSnapshotRef.current) {
          return;
        }
        dispatch({ type: "setCommitError", error: null });
        applyCommitLog(log, { append: false, updateSignature: true });
      },
    });
  }, [
    activeScopeRef,
    applyCommitLog,
    commitLogScopeOptions,
    commitPageSize,
    dispatch,
    paneId,
    requestCommitLog,
    requestScopeKey,
  ]);
  const pollCommitLogTick = useCallback(() => {
    void pollCommitLog();
  }, [pollCommitLog]);

  useLayoutEffect(() => {
    onReconnectRef.current = () => {
      void loadCommitLog({ force: true });
    };
    pollTickRef.current = pollCommitLogTick;
  }, [loadCommitLog, pollCommitLogTick]);

  const toggleCommit = useCallback(
    (hash: string) => {
      const nextOpen = !commitOpen[hash];
      dispatch({ type: "setCommitOpen", hash, open: nextOpen });
      if (nextOpen && !commitDetails[hash]) {
        void loadCommitDetail(hash);
      }
    },
    [commitDetails, commitOpen, dispatch, loadCommitDetail],
  );

  const toggleCommitFile = useCallback(
    (hash: string, path: string) => {
      const key = `${hash}:${path}`;
      const nextOpen = !commitFileOpen[key];
      dispatch({ type: "setCommitFileOpen", key, open: nextOpen });
      if (nextOpen && !commitFileDetails[key]) {
        void loadCommitFile(hash, path);
      }
    },
    [commitFileDetails, commitFileOpen, dispatch, loadCommitFile],
  );

  const copyHash = useCallback(
    async (hash: string) => {
      const copied = await copyToClipboard(hash);
      if (!copied) return;
      dispatch({ type: "setCopiedHash", hash });
      if (commitCopyTimeoutRef.current) {
        window.clearTimeout(commitCopyTimeoutRef.current);
      }
      commitCopyTimeoutRef.current = window.setTimeout(() => {
        dispatch({ type: "clearCopiedHash", hash });
      }, 1200);
    },
    [dispatch],
  );

  useEffect(() => {
    commitLogRef.current = commitLog;
  }, [commitLog]);

  useEffect(() => {
    dispatch({ type: "reset" });
    commitSnapshotRef.current = null;
    commitLogRef.current = null;
    if (commitCopyTimeoutRef.current) {
      window.clearTimeout(commitCopyTimeoutRef.current);
      commitCopyTimeoutRef.current = null;
    }
  }, [branch, dispatch, paneId, worktreePath]);

  // False positive: commit log loading is lifecycle IO keyed by pane/worktree,
  // and moving it to render or a user event would skip the initial load.
  useEffect(() => {
    // react-doctor-disable-next-line no-pass-data-to-parent
    loadCommitLog({ force: true });
  }, [loadCommitLog]);

  useEffect(() => {
    return () => {
      if (commitCopyTimeoutRef.current) {
        window.clearTimeout(commitCopyTimeoutRef.current);
      }
    };
  }, []);

  return {
    commitLog,
    commitError,
    commitLoading,
    commitLoadingMore,
    commitHasMore,
    commitDetails,
    commitFileDetails,
    commitFileOpen,
    commitFileLoading,
    commitOpen,
    commitLoadingDetails,
    copiedHash,
    refreshCommitLog: () => loadCommitLog({ force: true }),
    loadMoreCommits: () => loadCommitLog({ append: true, force: true }),
    toggleCommit,
    toggleCommitFile,
    copyHash,
  };
};
