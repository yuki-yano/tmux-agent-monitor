import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BranchList, SessionSummary } from "@vde-monitor/shared";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";

import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { AUTO_REFRESH_INTERVAL_MS } from "../sessionDetailUtils";

type BranchMutationKind = "checkout" | "create" | "delete";

type ActiveResourceContext = {
  paneId: string;
  repoRoot: string | null;
  generation: number;
};

type BranchesMutationState = {
  paneId: string;
  repoRoot: string | null;
  mutating: { kind: BranchMutationKind; name: string } | null;
  mutationError: string | null;
};

type BranchesMutationAction =
  | {
      type: "mutationStart";
      paneId: string;
      repoRoot: string | null;
      kind: BranchMutationKind;
      name: string;
    }
  | { type: "mutationFailure"; error: string }
  | { type: "mutationFinish" }
  | { type: "clearMutationError" };

const createInitialMutationState = (
  paneId: string,
  repoRoot: string | null,
): BranchesMutationState => ({
  paneId,
  repoRoot,
  mutating: null,
  mutationError: null,
});

const branchesMutationReducer = (
  state: BranchesMutationState,
  action: BranchesMutationAction,
): BranchesMutationState => {
  switch (action.type) {
    case "mutationStart":
      return {
        paneId: action.paneId,
        repoRoot: action.repoRoot,
        mutating: { kind: action.kind, name: action.name },
        mutationError: null,
      };
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
  requestBranches: (
    paneId: string,
    options?: { force?: boolean },
    signal?: AbortSignal,
  ) => Promise<BranchList>;
  requestBranchCheckout: (paneId: string, branch: string) => Promise<void>;
  requestBranchCreate: (paneId: string, name: string, base?: string) => Promise<void>;
  requestBranchDelete: (
    paneId: string,
    name: string,
    options?: { force?: boolean },
  ) => Promise<void>;
};

const OFFLINE_BRANCHES_MESSAGE = "Offline: waiting to load branches";

const subscribeBrowserOnline = (onStoreChange: () => void) =>
  onlineManager.subscribe(onStoreChange);
const getBrowserOnlineSnapshot = () => onlineManager.isOnline();
const getServerBrowserOnlineSnapshot = () => true;

export const useSessionBranches = ({
  paneId,
  connected,
  session,
  requestBranches,
  requestBranchCheckout,
  requestBranchCreate,
  requestBranchDelete,
}: UseSessionBranchesArgs) => {
  const queryClient = useQueryClient();
  const browserOnline = useSyncExternalStore(
    subscribeBrowserOnline,
    getBrowserOnlineSnapshot,
    getServerBrowserOnlineSnapshot,
  );
  const repoRoot = session?.repoRoot ?? null;
  const queryKey = useMemo(
    () => sessionDetailQueryKeys.branches(paneId, repoRoot),
    [paneId, repoRoot],
  );
  const {
    data: branchList = null,
    error: queryError,
    fetchStatus,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestBranches(paneId, undefined, signal),
    enabled: Boolean(paneId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    refetchInterval: connected && browserOnline ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const [mutationState, dispatch] = useReducer(
    branchesMutationReducer,
    createInitialMutationState(paneId, repoRoot),
  );
  const activeResourceRef = useRef<ActiveResourceContext>({ paneId, repoRoot, generation: 0 });
  const refreshGenerationRef = useRef(0);
  const currentMutationState =
    mutationState.paneId === paneId && mutationState.repoRoot === repoRoot
      ? mutationState
      : createInitialMutationState(paneId, repoRoot);

  useLayoutEffect(() => {
    if (
      activeResourceRef.current.paneId !== paneId ||
      activeResourceRef.current.repoRoot !== repoRoot
    ) {
      activeResourceRef.current = {
        paneId,
        repoRoot,
        generation: activeResourceRef.current.generation + 1,
      };
      refreshGenerationRef.current += 1;
    }
    const activeResource = activeResourceRef.current;
    return () => {
      if (activeResourceRef.current === activeResource) {
        activeResourceRef.current = {
          paneId: "",
          repoRoot: null,
          generation: activeResource.generation + 1,
        };
        refreshGenerationRef.current += 1;
      }
    };
  }, [paneId, repoRoot]);

  const forceRefreshBranches = useCallback(async () => {
    const targetPaneId = paneId;
    const targetRepoRoot = repoRoot;
    const targetResourceContext = activeResourceRef.current;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    const isCurrentResourceGeneration = () =>
      activeResourceRef.current === targetResourceContext &&
      targetResourceContext.paneId === targetPaneId &&
      targetResourceContext.repoRoot === targetRepoRoot &&
      refreshGenerationRef.current === generation;

    await queryClient.cancelQueries({ queryKey, exact: true });
    if (!isCurrentResourceGeneration()) {
      return;
    }
    try {
      await queryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => requestBranches(targetPaneId, { force: true }, signal),
        staleTime: 0,
        gcTime: 0,
        retry: false,
        networkMode: "online",
      });
    } catch {
      // Keep the resource error in Query state, but preserve the non-rejecting refresh contract.
    }
  }, [paneId, queryClient, queryKey, repoRoot, requestBranches]);

  const runMutation = useCallback(
    async (
      kind: BranchMutationKind,
      name: string,
      targetPaneId: string,
      targetRepoRoot: string | null,
      mutate: () => Promise<void>,
    ) => {
      const targetResourceContext = activeResourceRef.current;
      const isCurrentResourceGeneration = () =>
        activeResourceRef.current === targetResourceContext &&
        targetResourceContext.paneId === targetPaneId &&
        targetResourceContext.repoRoot === targetRepoRoot;
      if (!isCurrentResourceGeneration()) {
        return false;
      }
      dispatch({
        type: "mutationStart",
        paneId: targetPaneId,
        repoRoot: targetRepoRoot,
        kind,
        name,
      });
      try {
        await mutate();
        if (!isCurrentResourceGeneration()) {
          return false;
        }
        await forceRefreshBranches();
        return isCurrentResourceGeneration();
      } catch (err) {
        if (!isCurrentResourceGeneration()) {
          return false;
        }
        dispatch({
          type: "mutationFailure",
          error: resolveUnknownErrorMessage(err, `Failed to ${kind} branch`),
        });
        return false;
      } finally {
        if (isCurrentResourceGeneration()) {
          dispatch({ type: "mutationFinish" });
        }
      }
    },
    [forceRefreshBranches],
  );

  const checkoutBranch = useCallback(
    (name: string) =>
      runMutation("checkout", name, paneId, repoRoot, () => requestBranchCheckout(paneId, name)),
    [paneId, repoRoot, requestBranchCheckout, runMutation],
  );
  const createBranch = useCallback(
    (name: string, base?: string) =>
      runMutation("create", name, paneId, repoRoot, () => requestBranchCreate(paneId, name, base)),
    [paneId, repoRoot, requestBranchCreate, runMutation],
  );
  const deleteBranch = useCallback(
    (name: string, options?: { force?: boolean }) =>
      runMutation("delete", name, paneId, repoRoot, () =>
        requestBranchDelete(paneId, name, options),
      ),
    [paneId, repoRoot, requestBranchDelete, runMutation],
  );

  const branches = useMemo(() => branchList?.entries ?? [], [branchList]);
  const branchesError =
    fetchStatus === "paused" && branchList == null
      ? OFFLINE_BRANCHES_MESSAGE
      : fetchStatus === "fetching" || queryError == null
        ? null
        : resolveUnknownErrorMessage(queryError, "Failed to load branches");

  return {
    branchList,
    branches,
    defaultBranch: branchList?.defaultBranch ?? null,
    currentBranch: branchList?.currentBranch ?? null,
    branchesLoading: isLoading,
    branchesError,
    mutating: currentMutationState.mutating,
    mutationError: currentMutationState.mutationError,
    clearMutationError: useCallback(() => dispatch({ type: "clearMutationError" }), []),
    refreshBranches: forceRefreshBranches,
    checkoutBranch,
    createBranch,
    deleteBranch,
  };
};
