import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RepoNote, sortNotesDesc } from "@vde-monitor/shared";
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";

type UseSessionRepoNotesParams = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  requestRepoNotes: (paneId: string, signal?: AbortSignal) => Promise<RepoNote[]>;
  createRepoNote: (
    paneId: string,
    input: { title?: string | null; body: string },
  ) => Promise<RepoNote>;
  updateRepoNote: (
    paneId: string,
    noteId: string,
    input: { title?: string | null; body: string },
  ) => Promise<RepoNote>;
  deleteRepoNote: (paneId: string, noteId: string) => Promise<string>;
};

type RefreshNotesOptions = {
  silent?: boolean;
};

type RepoNotesScope = {
  paneId: string;
  repoRoot: string | null;
  generation: number;
};

type RepoNotesMutationState = {
  paneId: string;
  repoRoot: string | null;
  generation: number;
  mutationError: string | null;
  mutationErrorDataUpdateCount: number | null;
  creatingNote: boolean;
  savingNoteId: string | null;
  deletingNoteId: string | null;
};

type RepoNotesMutationAction =
  | { type: "createStart"; paneId: string; repoRoot: string | null; generation: number }
  | { type: "createFinish" }
  | {
      type: "saveStart";
      paneId: string;
      repoRoot: string | null;
      generation: number;
      noteId: string;
    }
  | { type: "saveFinish"; noteId: string }
  | {
      type: "deleteStart";
      paneId: string;
      repoRoot: string | null;
      generation: number;
      noteId: string;
    }
  | { type: "deleteFinish"; noteId: string }
  | { type: "mutationFailure"; error: string; dataUpdateCount: number };

const createInitialMutationState = (
  paneId: string,
  repoRoot: string | null,
  generation = -1,
): RepoNotesMutationState => ({
  paneId,
  repoRoot,
  generation,
  mutationError: null,
  mutationErrorDataUpdateCount: null,
  creatingNote: false,
  savingNoteId: null,
  deletingNoteId: null,
});

const beginMutationInScope = (
  state: RepoNotesMutationState,
  paneId: string,
  repoRoot: string | null,
  generation: number,
) =>
  state.paneId === paneId && state.repoRoot === repoRoot && state.generation === generation
    ? { ...state, mutationError: null, mutationErrorDataUpdateCount: null }
    : createInitialMutationState(paneId, repoRoot, generation);

const repoNotesMutationReducer = (
  state: RepoNotesMutationState,
  action: RepoNotesMutationAction,
): RepoNotesMutationState => {
  switch (action.type) {
    case "createStart":
      return {
        ...beginMutationInScope(state, action.paneId, action.repoRoot, action.generation),
        creatingNote: true,
      };
    case "createFinish":
      return { ...state, creatingNote: false };
    case "saveStart":
      return {
        ...beginMutationInScope(state, action.paneId, action.repoRoot, action.generation),
        savingNoteId: action.noteId,
      };
    case "saveFinish":
      return {
        ...state,
        savingNoteId: state.savingNoteId === action.noteId ? null : state.savingNoteId,
      };
    case "deleteStart":
      return {
        ...beginMutationInScope(state, action.paneId, action.repoRoot, action.generation),
        deletingNoteId: action.noteId,
      };
    case "deleteFinish":
      return {
        ...state,
        deletingNoteId: state.deletingNoteId === action.noteId ? null : state.deletingNoteId,
      };
    case "mutationFailure":
      return {
        ...state,
        mutationError: action.error,
        mutationErrorDataUpdateCount: action.dataUpdateCount,
      };
  }
};

type NotesLoadingState = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  showColdLoading: boolean;
};

type InteractiveRefreshState = {
  scope: RepoNotesScope;
  refreshGeneration: number;
};

type NotesVisibleErrorState = {
  queryKey: readonly unknown[];
  error: unknown;
};

const OFFLINE_NOTES_MESSAGE = "Offline: waiting to load notes";

export const useSessionRepoNotes = ({
  paneId,
  repoRoot,
  connected,
  requestRepoNotes,
  createRepoNote,
  updateRepoNote,
  deleteRepoNote,
}: UseSessionRepoNotesParams) => {
  const queryClient = useQueryClient();
  const browserOnline = onlineManager.isOnline();
  const queryKey = useMemo(
    () => sessionDetailQueryKeys.notes(paneId, repoRoot),
    [paneId, repoRoot],
  );
  const {
    data: queryNotes,
    error: queryError,
    fetchStatus,
    isFetched,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => sortNotesDesc(await requestRepoNotes(paneId, signal)),
    enabled: Boolean(paneId) && Boolean(repoRoot) && connected,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
  const notes = queryNotes ?? [];
  const [loadingState, setLoadingState] = useState<NotesLoadingState>(() => ({
    paneId,
    repoRoot,
    connected,
    showColdLoading: connected && browserOnline,
  }));
  let currentLoadingState = loadingState;
  if (loadingState.paneId !== paneId || loadingState.repoRoot !== repoRoot) {
    currentLoadingState = {
      paneId,
      repoRoot,
      connected,
      showColdLoading: connected && browserOnline,
    };
    setLoadingState(currentLoadingState);
  } else if (loadingState.connected !== connected) {
    currentLoadingState = {
      ...loadingState,
      connected,
      showColdLoading: false,
    };
    setLoadingState(currentLoadingState);
  }

  const [scopeState, setScopeState] = useState<RepoNotesScope>({ paneId, repoRoot, generation: 0 });
  let currentScopeState = scopeState;
  if (scopeState.paneId !== paneId || scopeState.repoRoot !== repoRoot) {
    currentScopeState = { paneId, repoRoot, generation: scopeState.generation + 1 };
    setScopeState(currentScopeState);
  }
  const activeScopeRef = useRef<RepoNotesScope>(currentScopeState);
  const [mutationState, dispatch] = useReducer(
    repoNotesMutationReducer,
    createInitialMutationState(paneId, repoRoot),
  );
  const currentMutationState =
    mutationState.paneId === paneId &&
    mutationState.repoRoot === repoRoot &&
    mutationState.generation === currentScopeState.generation
      ? mutationState
      : createInitialMutationState(paneId, repoRoot);
  const interactiveRefreshGenerationRef = useRef(0);
  const [interactiveRefreshState, setInteractiveRefreshState] =
    useState<InteractiveRefreshState | null>(null);
  const currentInteractiveRefreshState =
    interactiveRefreshState?.scope === currentScopeState ? interactiveRefreshState : null;

  useLayoutEffect(() => {
    activeScopeRef.current = currentScopeState;
    interactiveRefreshGenerationRef.current += 1;
    return () => {
      if (activeScopeRef.current === currentScopeState) {
        activeScopeRef.current = {
          paneId: "",
          repoRoot: null,
          generation: currentScopeState.generation + 1,
        };
        interactiveRefreshGenerationRef.current += 1;
      }
    };
  }, [currentScopeState]);

  const isActiveScope = useCallback(
    (scope: RepoNotesScope) => activeScopeRef.current === scope,
    [],
  );

  const refreshNotes = useCallback(
    (options?: RefreshNotesOptions) => {
      if (!paneId || !repoRoot || !connected) {
        return;
      }
      if (options?.silent) {
        void queryClient.refetchQueries(
          { queryKey, exact: true, type: "active" },
          { cancelRefetch: false },
        );
        return;
      }

      const scope = activeScopeRef.current;
      const generation = interactiveRefreshGenerationRef.current + 1;
      interactiveRefreshGenerationRef.current = generation;
      setInteractiveRefreshState({ scope, refreshGeneration: generation });
      void (async () => {
        try {
          await queryClient.cancelQueries({ queryKey, exact: true });
          if (!isActiveScope(scope) || interactiveRefreshGenerationRef.current !== generation) {
            return;
          }
          await queryClient.refetchQueries({ queryKey, exact: true, type: "active" });
        } finally {
          setInteractiveRefreshState((current) =>
            current?.scope === scope && current.refreshGeneration === generation ? null : current,
          );
        }
      })();
    },
    [connected, isActiveScope, paneId, queryClient, queryKey, repoRoot],
  );

  const cancelListRequests = useCallback(
    () => queryClient.cancelQueries({ queryKey, exact: true }),
    [queryClient, queryKey],
  );
  const getQueryDataUpdateCount = useCallback(
    () => queryClient.getQueryState<RepoNote[]>(queryKey)?.dataUpdateCount ?? 0,
    [queryClient, queryKey],
  );

  const createNote = useCallback(
    async (input: { title?: string | null; body: string }) => {
      const scope = activeScopeRef.current;
      if (!scope.repoRoot) {
        dispatch({
          type: "mutationFailure",
          error: API_ERROR_MESSAGES.repoUnavailable,
          dataUpdateCount: getQueryDataUpdateCount(),
        });
        return null;
      }
      dispatch({
        type: "createStart",
        paneId: scope.paneId,
        repoRoot: scope.repoRoot,
        generation: scope.generation,
      });
      try {
        await cancelListRequests();
        if (!isActiveScope(scope)) {
          return null;
        }
        const created = await createRepoNote(scope.paneId, input);
        await cancelListRequests();
        if (!isActiveScope(scope)) {
          return null;
        }
        queryClient.setQueryData<RepoNote[]>(queryKey, (current = []) =>
          sortNotesDesc([...current.filter((note) => note.id !== created.id), created]),
        );
        return created;
      } catch (error) {
        if (isActiveScope(scope)) {
          dispatch({
            type: "mutationFailure",
            error: resolveUnknownErrorMessage(error, API_ERROR_MESSAGES.createRepoNote),
            dataUpdateCount: getQueryDataUpdateCount(),
          });
        }
        return null;
      } finally {
        if (isActiveScope(scope)) {
          dispatch({ type: "createFinish" });
        }
      }
    },
    [
      cancelListRequests,
      createRepoNote,
      getQueryDataUpdateCount,
      isActiveScope,
      queryClient,
      queryKey,
    ],
  );

  const saveNote = useCallback(
    async (noteId: string, input: { title?: string | null; body: string }) => {
      const scope = activeScopeRef.current;
      if (!scope.repoRoot) {
        dispatch({
          type: "mutationFailure",
          error: API_ERROR_MESSAGES.repoUnavailable,
          dataUpdateCount: getQueryDataUpdateCount(),
        });
        return false;
      }
      dispatch({
        type: "saveStart",
        paneId: scope.paneId,
        repoRoot: scope.repoRoot,
        generation: scope.generation,
        noteId,
      });
      try {
        await cancelListRequests();
        if (!isActiveScope(scope)) {
          return false;
        }
        const updated = await updateRepoNote(scope.paneId, noteId, input);
        await cancelListRequests();
        if (!isActiveScope(scope)) {
          return false;
        }
        queryClient.setQueryData<RepoNote[]>(queryKey, (current = []) =>
          sortNotesDesc([...current.filter((note) => note.id !== updated.id), updated]),
        );
        return true;
      } catch (error) {
        if (isActiveScope(scope)) {
          dispatch({
            type: "mutationFailure",
            error: resolveUnknownErrorMessage(error, API_ERROR_MESSAGES.updateRepoNote),
            dataUpdateCount: getQueryDataUpdateCount(),
          });
        }
        return false;
      } finally {
        if (isActiveScope(scope)) {
          dispatch({ type: "saveFinish", noteId });
        }
      }
    },
    [
      cancelListRequests,
      getQueryDataUpdateCount,
      isActiveScope,
      queryClient,
      queryKey,
      updateRepoNote,
    ],
  );

  const removeNote = useCallback(
    async (noteId: string) => {
      const scope = activeScopeRef.current;
      if (!scope.repoRoot) {
        dispatch({
          type: "mutationFailure",
          error: API_ERROR_MESSAGES.repoUnavailable,
          dataUpdateCount: getQueryDataUpdateCount(),
        });
        return false;
      }
      dispatch({
        type: "deleteStart",
        paneId: scope.paneId,
        repoRoot: scope.repoRoot,
        generation: scope.generation,
        noteId,
      });
      try {
        await cancelListRequests();
        if (!isActiveScope(scope)) {
          return false;
        }
        const removedNoteId = await deleteRepoNote(scope.paneId, noteId);
        await cancelListRequests();
        if (!isActiveScope(scope)) {
          return false;
        }
        queryClient.setQueryData<RepoNote[]>(queryKey, (current = []) =>
          current.filter((note) => note.id !== removedNoteId),
        );
        return true;
      } catch (error) {
        if (isActiveScope(scope)) {
          dispatch({
            type: "mutationFailure",
            error: resolveUnknownErrorMessage(error, API_ERROR_MESSAGES.deleteRepoNote),
            dataUpdateCount: getQueryDataUpdateCount(),
          });
        }
        return false;
      } finally {
        if (isActiveScope(scope)) {
          dispatch({ type: "deleteFinish", noteId });
        }
      }
    },
    [
      cancelListRequests,
      deleteRepoNote,
      getQueryDataUpdateCount,
      isActiveScope,
      queryClient,
      queryKey,
    ],
  );

  const [visibleErrorState, setVisibleErrorState] = useState<NotesVisibleErrorState>(() => ({
    queryKey,
    error: null,
  }));
  let currentVisibleErrorState = visibleErrorState;
  if (visibleErrorState.queryKey !== queryKey) {
    currentVisibleErrorState = { queryKey, error: null };
    setVisibleErrorState(currentVisibleErrorState);
  } else if (
    fetchStatus === "idle" &&
    queryError != null &&
    visibleErrorState.error !== queryError
  ) {
    currentVisibleErrorState = { queryKey, error: queryError };
    setVisibleErrorState(currentVisibleErrorState);
  } else if (
    fetchStatus === "idle" &&
    queryError == null &&
    queryNotes !== undefined &&
    visibleErrorState.error != null
  ) {
    currentVisibleErrorState = { queryKey, error: null };
    setVisibleErrorState(currentVisibleErrorState);
  }
  const queryErrorMessage =
    fetchStatus === "paused" && queryNotes === undefined
      ? OFFLINE_NOTES_MESSAGE
      : fetchStatus === "fetching" && currentInteractiveRefreshState != null
        ? null
        : currentVisibleErrorState.error == null
          ? null
          : resolveUnknownErrorMessage(
              currentVisibleErrorState.error,
              API_ERROR_MESSAGES.repoNotes,
            );
  const currentQueryDataUpdateCount =
    queryClient.getQueryState<RepoNote[]>(queryKey)?.dataUpdateCount ?? 0;
  const mutationErrorMessage =
    currentMutationState.mutationErrorDataUpdateCount != null &&
    currentQueryDataUpdateCount > currentMutationState.mutationErrorDataUpdateCount
      ? null
      : currentMutationState.mutationError;

  return {
    notes,
    notesLoading:
      currentInteractiveRefreshState != null ||
      (currentLoadingState.showColdLoading && browserOnline && !isFetched && isLoading),
    notesError: mutationErrorMessage ?? queryErrorMessage,
    creatingNote: currentMutationState.creatingNote,
    savingNoteId: currentMutationState.savingNoteId,
    deletingNoteId: currentMutationState.deletingNoteId,
    refreshNotes,
    createNote,
    saveNote,
    removeNote,
  };
};
