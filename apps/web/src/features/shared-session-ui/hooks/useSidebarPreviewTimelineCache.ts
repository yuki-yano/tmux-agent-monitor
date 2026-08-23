import type {
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
  SessionSummary,
} from "@vde-monitor/shared";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { prunePaneRecord } from "@/features/shared-session-ui/model/pane-record-utils";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { useLazyRef } from "@/lib/use-lazy-ref";

const TIMELINE_RANGE: SessionStateTimelineRange = "1h";
const TIMELINE_LIMIT = 200;

type TimelineCacheMap = Partial<Record<string, SessionStateTimeline>>;
type TimelineCacheState = {
  cache: Record<string, SessionStateTimeline>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
};

type TimelineCacheAction =
  | { type: "start"; paneId: string }
  | { type: "success"; paneId: string; timeline: SessionStateTimeline }
  | { type: "failure"; paneId: string; error: string }
  | { type: "finish"; paneId: string }
  | { type: "prune"; activePaneIds: Set<string> };

const initialTimelineCacheState: TimelineCacheState = {
  cache: {},
  loading: {},
  errors: {},
};

const timelineCacheReducer = (
  state: TimelineCacheState,
  action: TimelineCacheAction,
): TimelineCacheState => {
  switch (action.type) {
    case "start":
      return { ...state, loading: { ...state.loading, [action.paneId]: true } };
    case "success":
      return {
        ...state,
        cache: { ...state.cache, [action.paneId]: action.timeline },
        errors: { ...state.errors, [action.paneId]: null },
      };
    case "failure":
      return { ...state, errors: { ...state.errors, [action.paneId]: action.error } };
    case "finish":
      return { ...state, loading: { ...state.loading, [action.paneId]: false } };
    case "prune":
      return {
        cache: prunePaneRecord(state.cache, action.activePaneIds),
        loading: prunePaneRecord(state.loading, action.activePaneIds),
        errors: prunePaneRecord(state.errors, action.activePaneIds),
      };
  }
};

const resolveTimelineError = (err: unknown) =>
  resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.timeline);

const isPaneLoading = (paneId: string | null, loading: Record<string, boolean>) =>
  Boolean(paneId && loading[paneId]);

const pickPaneError = (paneId: string | null, errors: Record<string, string | null>) => {
  if (!paneId) {
    return null;
  }
  return errors[paneId] ?? null;
};

const pickPaneTimeline = (paneId: string | null, cache: TimelineCacheMap) => {
  if (!paneId) {
    return null;
  }
  return cache[paneId] ?? null;
};

export const useSidebarPreviewTimelineCache = ({
  hoveredPaneId,
  sessionIndex,
  requestStateTimeline,
}: {
  hoveredPaneId: string | null;
  sessionIndex: Map<string, SessionSummary>;
  requestStateTimeline?: (
    paneId: string,
    options?: {
      scope?: SessionStateTimelineScope;
      range?: SessionStateTimelineRange;
      limit?: number;
    },
  ) => Promise<SessionStateTimeline>;
}) => {
  const [state, dispatch] = useReducer(timelineCacheReducer, initialTimelineCacheState);
  const { cache: timelineCache, loading: timelineLoading, errors: timelineError } = state;
  const timelineCacheRef = useRef<Record<string, SessionStateTimeline>>({});
  const timelineInflightRef = useLazyRef(() => new Set<string>());

  const fetchTimeline = useCallback(
    async (paneId: string) => {
      if (!requestStateTimeline || !paneId) {
        return;
      }
      if (timelineCacheRef.current[paneId] || timelineInflightRef.current.has(paneId)) {
        return;
      }
      timelineInflightRef.current.add(paneId);
      dispatch({ type: "start", paneId });
      try {
        const timeline = await requestStateTimeline(paneId, {
          range: TIMELINE_RANGE,
          limit: TIMELINE_LIMIT,
        });
        timelineCacheRef.current = {
          ...timelineCacheRef.current,
          [paneId]: timeline,
        };
        dispatch({ type: "success", paneId, timeline });
      } catch (err) {
        dispatch({ type: "failure", paneId, error: resolveTimelineError(err) });
      } finally {
        timelineInflightRef.current.delete(paneId);
        dispatch({ type: "finish", paneId });
      }
    },
    [requestStateTimeline, timelineInflightRef],
  );

  useEffect(() => {
    const activePaneIds = new Set(sessionIndex.keys());
    timelineCacheRef.current = prunePaneRecord(timelineCacheRef.current, activePaneIds);
    dispatch({ type: "prune", activePaneIds });
  }, [sessionIndex]);

  return {
    hoveredTimeline: pickPaneTimeline(hoveredPaneId, timelineCache),
    hoveredTimelineLoading: isPaneLoading(hoveredPaneId, timelineLoading),
    hoveredTimelineError: pickPaneError(hoveredPaneId, timelineError),
    fetchTimeline,
  };
};
