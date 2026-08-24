import type { BranchList, SessionSummary } from "@vde-monitor/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";

import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { AUTO_REFRESH_INTERVAL_MS } from "../sessionDetailUtils";
import { createNextRequestId, isCurrentRequest } from "./session-request-guard";

type BranchMutationKind = "checkout" | "create" | "delete";

type ActivePaneContext = {
  paneId: string;
  generation: number;
};

type BranchesState = {
  paneId: string;
  branchList: BranchList | null;
  loading: boolean;
  error: string | null;
  mutating: { kind: BranchMutationKind; name: string } | null;
  mutationError: string | null;
};

type BranchesAction =
  | { type: "fetchStart"; paneId: string; resetEntries: boolean; showLoading: boolean }
  | { type: "fetchSuccess"; branchList: BranchList; showLoading: boolean }
  | { type: "fetchFailure"; error: string; resetEntries: boolean; showLoading: boolean }
  | { type: "mutationStart"; kind: BranchMutationKind; name: string }
  | { type: "mutationFailure"; error: string }
  | { type: "mutationFinish" }
  | { type: "clearMutationError" };

const createInitialBranchesState = (paneId: string): BranchesState => ({
  paneId,
  branchList: null,
  loading: false,
  error: null,
  mutating: null,
  mutationError: null,
});

const branchesReducer = (state: BranchesState, action: BranchesAction): BranchesState => {
  switch (action.type) {
    case "fetchStart":
      if (state.paneId !== action.paneId) {
        state = createInitialBranchesState(action.paneId);
      }
      return {
        ...state,
        branchList: action.resetEntries ? null : state.branchList,
        loading: action.showLoading ? true : state.loading,
        error: null,
      };
    case "fetchSuccess":
      return {
        ...state,
        branchList: action.branchList,
        loading: action.showLoading ? false : state.loading,
        error: null,
      };
    case "fetchFailure":
      return {
        ...state,
        branchList: action.resetEntries || action.showLoading ? null : state.branchList,
        loading: action.showLoading ? false : state.loading,
        error: action.error,
      };
    case "mutationStart":
      return { ...state, mutating: { kind: action.kind, name: action.name }, mutationError: null };
    case "mutationFailure":
      return { ...state, mutationError: action.error };
    case "mutationFinish":
      return { ...state, mutating: null };
    case "clearMutationError":
      return { ...state, mutationError: null };
  }
};

type UseSessionBranchesArgs = {
  paneId: string;
  connected: boolean;
  session: SessionSummary | null;
  requestBranches: (paneId: string, options?: { force?: boolean }) => Promise<BranchList>;
  requestBranchCheckout: (paneId: string, branch: string) => Promise<void>;
  requestBranchCreate: (paneId: string, name: string, base?: string) => Promise<void>;
  requestBranchDelete: (
    paneId: string,
    name: string,
    options?: { force?: boolean },
  ) => Promise<void>;
};

export const useSessionBranches = ({
  paneId,
  connected,
  session,
  requestBranches,
  requestBranchCheckout,
  requestBranchCreate,
  requestBranchDelete,
}: UseSessionBranchesArgs) => {
  const [state, dispatch] = useReducer(branchesReducer, paneId, createInitialBranchesState);
  const latestRequestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const activePaneRef = useRef<ActivePaneContext>({ paneId, generation: 0 });
  const currentState = state.paneId === paneId ? state : createInitialBranchesState(paneId);
  const { branchList, loading, error, mutating, mutationError } = currentState;

  useLayoutEffect(() => {
    if (activePaneRef.current.paneId !== paneId) {
      activePaneRef.current = {
        paneId,
        generation: activePaneRef.current.generation + 1,
      };
    }
    const activePane = activePaneRef.current;
    return () => {
      if (activePaneRef.current === activePane) {
        activePaneRef.current = {
          paneId: "",
          generation: activePane.generation + 1,
        };
        latestRequestIdRef.current += 1;
      }
    };
  }, [paneId]);

  const fetchBranches = useCallback(
    async (options?: { resetEntries?: boolean; force?: boolean }) => {
      const targetPaneId = paneId;
      const targetPaneContext = activePaneRef.current;
      const requestId = createNextRequestId(latestRequestIdRef);
      const shouldReset = options?.resetEntries === true;
      const shouldShowLoading = shouldReset || !hasLoadedRef.current;
      if (shouldReset) {
        hasLoadedRef.current = false;
      }
      dispatch({
        type: "fetchStart",
        paneId: targetPaneId,
        resetEntries: shouldReset,
        showLoading: shouldShowLoading,
      });
      try {
        // False positive: request freshness is checked immediately after the fetch resolves.
        // react-doctor-disable-next-line async-defer-await
        const next = await requestBranches(
          targetPaneId,
          options?.force === true ? { force: true } : undefined,
        );
        if (
          activePaneRef.current !== targetPaneContext ||
          targetPaneContext.paneId !== targetPaneId ||
          !isCurrentRequest(latestRequestIdRef, requestId)
        ) {
          return;
        }
        hasLoadedRef.current = true;
        dispatch({ type: "fetchSuccess", branchList: next, showLoading: shouldShowLoading });
      } catch (nextError) {
        if (
          activePaneRef.current !== targetPaneContext ||
          targetPaneContext.paneId !== targetPaneId ||
          !isCurrentRequest(latestRequestIdRef, requestId)
        ) {
          return;
        }
        dispatch({
          type: "fetchFailure",
          error: resolveUnknownErrorMessage(nextError, "Failed to load branches"),
          resetEntries: shouldReset,
          showLoading: shouldShowLoading,
        });
      }
    },
    [paneId, requestBranches],
  );

  useEffect(() => {
    void fetchBranches({ resetEntries: true });
  }, [fetchBranches, session?.repoRoot]);

  useVisibilityPolling({
    enabled: Boolean(paneId) && connected,
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    onTick: useCallback(() => {
      void fetchBranches();
    }, [fetchBranches]),
  });

  const runMutation = useCallback(
    async (
      kind: BranchMutationKind,
      name: string,
      targetPaneId: string,
      mutate: () => Promise<void>,
    ) => {
      const targetPaneContext = activePaneRef.current;
      const isCurrentPaneGeneration = () =>
        activePaneRef.current === targetPaneContext && targetPaneContext.paneId === targetPaneId;
      if (!isCurrentPaneGeneration()) {
        return false;
      }
      dispatch({ type: "mutationStart", kind, name });
      try {
        await mutate();
        if (!isCurrentPaneGeneration()) {
          return false;
        }
        await fetchBranches({ force: true });
        return isCurrentPaneGeneration();
      } catch (err) {
        if (!isCurrentPaneGeneration()) {
          return false;
        }
        dispatch({
          type: "mutationFailure",
          error: resolveUnknownErrorMessage(err, `Failed to ${kind} branch`),
        });
        return false;
      } finally {
        if (isCurrentPaneGeneration()) {
          dispatch({ type: "mutationFinish" });
        }
      }
    },
    [fetchBranches],
  );

  const checkoutBranch = useCallback(
    (name: string) =>
      runMutation("checkout", name, paneId, () => requestBranchCheckout(paneId, name)),
    [paneId, requestBranchCheckout, runMutation],
  );
  const createBranch = useCallback(
    (name: string, base?: string) =>
      runMutation("create", name, paneId, () => requestBranchCreate(paneId, name, base)),
    [paneId, requestBranchCreate, runMutation],
  );
  const deleteBranch = useCallback(
    (name: string, options?: { force?: boolean }) =>
      runMutation("delete", name, paneId, () => requestBranchDelete(paneId, name, options)),
    [paneId, requestBranchDelete, runMutation],
  );

  const branches = useMemo(() => branchList?.entries ?? [], [branchList]);

  return {
    branchList,
    branches,
    defaultBranch: branchList?.defaultBranch ?? null,
    currentBranch: branchList?.currentBranch ?? null,
    branchesLoading: loading,
    branchesError: error,
    mutating,
    mutationError,
    clearMutationError: useCallback(() => dispatch({ type: "clearMutationError" }), []),
    refreshBranches: useCallback(() => fetchBranches({ force: true }), [fetchBranches]),
    checkoutBranch,
    createBranch,
    deleteBranch,
  };
};
