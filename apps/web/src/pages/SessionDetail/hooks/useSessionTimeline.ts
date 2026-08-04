import type {
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "@vde-monitor/shared";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { runPaneRequest } from "./session-request-guard";

type UseSessionTimelineParams = {
  paneId: string;
  connected: boolean;
  requestStateTimeline: (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
  ) => Promise<SessionStateTimeline>;
  hasRepoTimeline: boolean;
  mobileDefaultCollapsed: boolean;
};

type LoadTimelineOptions = {
  silent?: boolean;
};

const DEFAULT_RANGE: SessionStateTimelineRange = "1h";
const DEFAULT_SCOPE: SessionStateTimelineScope = "pane";
const TIMELINE_POLL_INTERVAL_MS = 5000;

const resolveTimelineError = (err: unknown) =>
  resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.timeline);

type TimelineState = {
  timeline: SessionStateTimeline | null;
  timelineScope: SessionStateTimelineScope;
  timelineRange: SessionStateTimelineRange;
  timelineError: string | null;
  timelineLoading: boolean;
  timelineExpanded: boolean;
};

type TimelineAction =
  | { type: "resetPane"; expanded: boolean }
  | { type: "loadStart"; silent: boolean }
  | { type: "loadSuccess"; timeline: SessionStateTimeline }
  | { type: "loadFailure"; error: string }
  | { type: "loadFinish"; silent: boolean; loading: boolean }
  | { type: "setScope"; scope: SessionStateTimelineScope }
  | { type: "setRange"; range: SessionStateTimelineRange }
  | { type: "toggleExpanded" };

const buildTimelineInitialState = (expanded: boolean): TimelineState => ({
  timeline: null,
  timelineScope: DEFAULT_SCOPE,
  timelineRange: DEFAULT_RANGE,
  timelineError: null,
  timelineLoading: false,
  timelineExpanded: expanded,
});

const timelineReducer = (state: TimelineState, action: TimelineAction): TimelineState => {
  switch (action.type) {
    case "resetPane":
      return buildTimelineInitialState(action.expanded);
    case "loadStart":
      return {
        ...state,
        timelineLoading: action.silent ? state.timelineLoading : true,
      };
    case "loadSuccess":
      return { ...state, timeline: action.timeline, timelineError: null };
    case "loadFailure":
      return { ...state, timelineError: action.error };
    case "loadFinish":
      return {
        ...state,
        timelineLoading: action.silent ? state.timelineLoading : action.loading,
      };
    case "setScope":
      return { ...state, timelineScope: action.scope };
    case "setRange":
      return { ...state, timelineRange: action.range };
    case "toggleExpanded":
      return { ...state, timelineExpanded: !state.timelineExpanded };
  }
};

export const useSessionTimeline = ({
  paneId,
  connected,
  requestStateTimeline,
  hasRepoTimeline,
  mobileDefaultCollapsed,
}: UseSessionTimelineParams) => {
  const [state, dispatch] = useReducer(
    timelineReducer,
    !mobileDefaultCollapsed,
    buildTimelineInitialState,
  );
  const {
    timeline,
    timelineScope: storedTimelineScope,
    timelineRange,
    timelineError,
    timelineLoading,
    timelineExpanded,
  } = state;
  const previousConnectedRef = useRef<boolean | null>(null);
  const activePaneIdRef = useRef(paneId);
  const timelineRequestIdRef = useRef(0);
  const pendingInteractiveLoadsRef = useRef(0);
  const [scopeAvailability, setScopeAvailability] = useState(() => ({
    paneId,
    hasRepoTimeline,
    downgraded: storedTimelineScope === "repo" && !hasRepoTimeline,
  }));
  let currentScopeAvailability = scopeAvailability;
  if (
    scopeAvailability.paneId !== paneId ||
    scopeAvailability.hasRepoTimeline !== hasRepoTimeline
  ) {
    currentScopeAvailability = {
      paneId,
      hasRepoTimeline,
      downgraded:
        scopeAvailability.paneId === paneId && scopeAvailability.downgraded
          ? true
          : storedTimelineScope === "repo" && !hasRepoTimeline,
    };
    setScopeAvailability(currentScopeAvailability);
  }
  useLayoutEffect(() => {
    activePaneIdRef.current = paneId;
  }, [paneId]);
  const timelineScope = currentScopeAvailability.downgraded ? DEFAULT_SCOPE : storedTimelineScope;

  const loadTimeline = useCallback(
    async ({ silent = false }: LoadTimelineOptions = {}) => {
      if (!paneId) {
        return;
      }
      const targetPaneId = paneId;
      if (!silent) {
        pendingInteractiveLoadsRef.current += 1;
      }
      dispatch({ type: "loadStart", silent });
      await runPaneRequest({
        requestIdRef: timelineRequestIdRef,
        activePaneIdRef,
        paneId: targetPaneId,
        run: async () => {
          const requestedScope =
            timelineScope === "repo" && hasRepoTimeline ? ("repo" as const) : undefined;
          return requestStateTimeline(targetPaneId, {
            scope: requestedScope,
            range: timelineRange,
          });
        },
        onSuccess: (nextTimeline) => {
          dispatch({ type: "loadSuccess", timeline: nextTimeline });
        },
        onError: (err) => {
          dispatch({ type: "loadFailure", error: resolveTimelineError(err) });
        },
        onSettled: () => {
          if (silent) {
            return;
          }
          pendingInteractiveLoadsRef.current = Math.max(0, pendingInteractiveLoadsRef.current - 1);
          if (activePaneIdRef.current === targetPaneId) {
            dispatch({
              type: "loadFinish",
              silent,
              loading: pendingInteractiveLoadsRef.current > 0,
            });
          }
        },
      });
    },
    [hasRepoTimeline, paneId, requestStateTimeline, timelineRange, timelineScope],
  );

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  useEffect(() => {
    if (previousConnectedRef.current === false && connected) {
      void loadTimeline({ silent: true });
    }
    previousConnectedRef.current = connected;
  }, [connected, loadTimeline]);

  useEffect(() => {
    pendingInteractiveLoadsRef.current = 0;
    dispatch({ type: "resetPane", expanded: !mobileDefaultCollapsed });
  }, [mobileDefaultCollapsed, paneId]);

  const pollTimeline = useCallback(() => {
    void loadTimeline({ silent: true });
  }, [loadTimeline]);

  useVisibilityPolling({
    enabled: Boolean(paneId) && connected,
    intervalMs: TIMELINE_POLL_INTERVAL_MS,
    onTick: pollTimeline,
    onResume: pollTimeline,
  });

  const toggleTimelineExpanded = useCallback(() => {
    dispatch({ type: "toggleExpanded" });
  }, []);

  const refreshTimeline = useCallback(() => {
    void loadTimeline();
  }, [loadTimeline]);

  const setTimelineScope = useCallback(
    (scope: SessionStateTimelineScope) => {
      setScopeAvailability({ paneId, hasRepoTimeline, downgraded: false });
      dispatch({ type: "setScope", scope: scope === "repo" && !hasRepoTimeline ? "pane" : scope });
    },
    [hasRepoTimeline, paneId],
  );

  const setTimelineRange = useCallback((range: SessionStateTimelineRange) => {
    dispatch({ type: "setRange", range });
  }, []);

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
