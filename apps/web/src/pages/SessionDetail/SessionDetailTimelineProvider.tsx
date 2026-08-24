import type {
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "@vde-monitor/shared";
import { type ReactNode, createContext, use, useMemo } from "react";

import { useSessionTimeline } from "./hooks/useSessionTimeline";
import { useSessionDetailContext } from "./SessionDetailProvider";

export type SessionDetailTimelineSectionProps = {
  state: {
    timeline: SessionStateTimeline | null;
    timelineScope: SessionStateTimelineScope;
    timelineRange: SessionStateTimelineRange;
    hasRepoTimeline: boolean;
    timelineError: string | null;
    timelineLoading: boolean;
    timelineExpanded: boolean;
  };
  actions: {
    onTimelineScopeChange: (scope: SessionStateTimelineScope) => void;
    onTimelineRangeChange: (range: SessionStateTimelineRange) => void;
    onTimelineRefresh: () => void;
    onToggleTimelineExpanded: () => void;
  };
};

const SessionDetailTimelineContext = createContext<SessionDetailTimelineSectionProps | null>(null);

export const SessionDetailTimelineProvider = ({ children }: { children: ReactNode }) => {
  const { base } = useSessionDetailContext();
  const repoRoot = base.session?.repoRoot ?? null;
  const {
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
  } = useSessionTimeline({
    paneId: base.paneId,
    repoRoot,
    connected: base.connected,
    requestStateTimeline: base.requestStateTimeline,
    hasRepoTimeline: repoRoot != null,
    mobileDefaultCollapsed: true,
  });
  const value = useMemo<SessionDetailTimelineSectionProps>(
    () => ({
      state: {
        timeline,
        timelineScope,
        timelineRange,
        hasRepoTimeline,
        timelineError,
        timelineLoading,
        timelineExpanded,
      },
      actions: {
        onTimelineScopeChange: setTimelineScope,
        onTimelineRangeChange: setTimelineRange,
        onTimelineRefresh: refreshTimeline,
        onToggleTimelineExpanded: toggleTimelineExpanded,
      },
    }),
    [
      hasRepoTimeline,
      refreshTimeline,
      setTimelineRange,
      setTimelineScope,
      timeline,
      timelineError,
      timelineExpanded,
      timelineLoading,
      timelineRange,
      timelineScope,
      toggleTimelineExpanded,
    ],
  );

  return (
    <SessionDetailTimelineContext.Provider value={value}>
      {children}
    </SessionDetailTimelineContext.Provider>
  );
};

export const useSessionDetailTimelineSectionProps = (): SessionDetailTimelineSectionProps => {
  const value = use(SessionDetailTimelineContext);
  if (!value) {
    throw new Error(
      "useSessionDetailTimelineSectionProps must be used within a SessionDetailTimelineProvider",
    );
  }
  return value;
};
