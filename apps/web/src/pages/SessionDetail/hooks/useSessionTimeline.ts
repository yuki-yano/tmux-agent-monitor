import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "@vde-monitor/shared";
import { useCallback, useMemo, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";

type UseSessionTimelineParams = {
  paneId: string;
  repoRoot: string | null;
  connected: boolean;
  requestStateTimeline: (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
    signal?: AbortSignal,
  ) => Promise<SessionStateTimeline>;
  hasRepoTimeline: boolean;
  mobileDefaultCollapsed: boolean;
  limit?: number;
};

const DEFAULT_RANGE: SessionStateTimelineRange = "1h";
const DEFAULT_SCOPE: SessionStateTimelineScope = "pane";
const TIMELINE_POLL_INTERVAL_MS = 5000;
const OFFLINE_TIMELINE_MESSAGE = "Offline: waiting to load timeline";

const resolveTimelineError = (err: unknown) =>
  resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.timeline);

type TimelineUiState = {
  paneStateKey: string;
  repoRoot: string | null;
  connected: boolean;
  hasRepoTimeline: boolean;
  timelineScope: SessionStateTimelineScope;
  timelineRange: SessionStateTimelineRange;
  timelineExpanded: boolean;
  showColdLoading: boolean;
};

type TimelineVisibleErrorState = {
  queryKey: readonly unknown[];
  error: unknown;
};

const buildTimelineUiState = ({
  paneId,
  repoRoot,
  connected,
  hasRepoTimeline,
  mobileDefaultCollapsed,
}: Pick<
  UseSessionTimelineParams,
  "paneId" | "repoRoot" | "connected" | "hasRepoTimeline" | "mobileDefaultCollapsed"
>): TimelineUiState => ({
  paneStateKey: `${paneId}\0${mobileDefaultCollapsed}`,
  repoRoot,
  connected,
  hasRepoTimeline,
  timelineScope: DEFAULT_SCOPE,
  timelineRange: DEFAULT_RANGE,
  timelineExpanded: !mobileDefaultCollapsed,
  showColdLoading: connected && onlineManager.isOnline(),
});

export const useSessionTimeline = ({
  paneId,
  repoRoot,
  connected,
  requestStateTimeline,
  hasRepoTimeline,
  mobileDefaultCollapsed,
  limit,
}: UseSessionTimelineParams) => {
  const queryClient = useQueryClient();
  const [uiState, setUiState] = useState(() =>
    buildTimelineUiState({ paneId, repoRoot, connected, hasRepoTimeline, mobileDefaultCollapsed }),
  );
  const paneStateKey = `${paneId}\0${mobileDefaultCollapsed}`;
  let currentUiState = uiState;

  // Production pane changes remount SessionDetailProvider. Keep the direct-prop fallback used by
  // isolated consumers/tests, and permanently downgrade repo scope when its repository disappears.
  if (uiState.paneStateKey !== paneStateKey) {
    currentUiState = buildTimelineUiState({
      paneId,
      repoRoot,
      connected,
      hasRepoTimeline,
      mobileDefaultCollapsed,
    });
    setUiState(currentUiState);
  } else if (
    uiState.repoRoot !== repoRoot ||
    uiState.connected !== connected ||
    uiState.hasRepoTimeline !== hasRepoTimeline
  ) {
    const appConnectionChanged = uiState.connected !== connected;
    const repositoryChanged = uiState.repoRoot !== repoRoot;
    currentUiState = {
      ...uiState,
      repoRoot,
      connected,
      hasRepoTimeline,
      timelineScope: hasRepoTimeline ? uiState.timelineScope : DEFAULT_SCOPE,
      showColdLoading: appConnectionChanged
        ? false
        : repositoryChanged
          ? connected && onlineManager.isOnline()
          : uiState.showColdLoading,
    };
    setUiState(currentUiState);
  }

  const { timelineRange, timelineExpanded } = currentUiState;
  const timelineScope: SessionStateTimelineScope =
    currentUiState.timelineScope === "repo" && hasRepoTimeline ? "repo" : DEFAULT_SCOPE;
  const queryKey = useMemo(
    () =>
      sessionDetailQueryKeys.timeline(paneId, {
        repoRoot,
        scope: timelineScope,
        range: timelineRange,
        limit,
      }),
    [limit, paneId, repoRoot, timelineRange, timelineScope],
  );
  const {
    data: timeline = null,
    error: queryError,
    fetchStatus,
    isFetched,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      requestStateTimeline(
        paneId,
        {
          ...(timelineScope === "repo" ? { scope: timelineScope } : {}),
          range: timelineRange,
          ...(limit == null ? {} : { limit }),
        },
        signal,
      ),
    enabled: Boolean(paneId) && connected,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchOnMount: "always",
    refetchInterval: TIMELINE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const [manualRefreshGeneration, setManualRefreshGeneration] = useState<number | null>(null);
  const nextManualRefreshGenerationRef = useRef(0);
  const [visibleErrorState, setVisibleErrorState] = useState<TimelineVisibleErrorState>(() => ({
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
    timeline != null &&
    visibleErrorState.error != null
  ) {
    currentVisibleErrorState = { queryKey, error: null };
    setVisibleErrorState(currentVisibleErrorState);
  }
  const timelineError =
    fetchStatus === "paused" && timeline == null
      ? OFFLINE_TIMELINE_MESSAGE
      : fetchStatus === "fetching" && manualRefreshGeneration != null
        ? null
        : currentVisibleErrorState.error == null
          ? null
          : resolveTimelineError(currentVisibleErrorState.error);
  const timelineLoading =
    manualRefreshGeneration != null || (currentUiState.showColdLoading && !isFetched && isLoading);

  const toggleTimelineExpanded = useCallback(() => {
    setUiState((current) => ({ ...current, timelineExpanded: !current.timelineExpanded }));
  }, []);

  const refreshTimeline = useCallback(async () => {
    const generation = nextManualRefreshGenerationRef.current + 1;
    nextManualRefreshGenerationRef.current = generation;
    setManualRefreshGeneration(generation);
    try {
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (nextManualRefreshGenerationRef.current !== generation) {
        return;
      }
      await queryClient.refetchQueries({ queryKey, exact: true, type: "active" });
    } finally {
      setManualRefreshGeneration((current) => (current === generation ? null : current));
    }
  }, [queryClient, queryKey]);

  const setTimelineScope = useCallback(
    (scope: SessionStateTimelineScope) => {
      setUiState((current) => ({
        ...current,
        timelineScope: scope === "repo" && !hasRepoTimeline ? DEFAULT_SCOPE : scope,
        showColdLoading: connected && onlineManager.isOnline(),
      }));
    },
    [connected, hasRepoTimeline],
  );

  const setTimelineRange = useCallback(
    (range: SessionStateTimelineRange) => {
      setUiState((current) => ({
        ...current,
        timelineRange: range,
        showColdLoading: connected && onlineManager.isOnline(),
      }));
    },
    [connected],
  );

  return {
    timeline,
    timelineScope,
    timelineRange,
    hasRepoTimeline,
    timelineError,
    timelineLoading,
    timelineExpanded,
    setTimelineScope,
    setTimelineRange,
    toggleTimelineExpanded,
    refreshTimeline,
  };
};
