import type { SessionStateTimelineRange, UsageGlobalTimelineResponse } from "@vde-monitor/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

const TIMELINE_POLL_INTERVAL_MS = 15_000;
const TIMELINE_DEFAULT_RANGE: SessionStateTimelineRange = "24h";
const COMPACT_ONLY_TIMELINE_RANGES = new Set<SessionStateTimelineRange>(["3d", "7d", "14d", "30d"]);

type RequestUsageGlobalTimeline = (options: {
  range?: SessionStateTimelineRange;
}) => Promise<UsageGlobalTimelineResponse>;

type ResolveErrorMessage = (error: unknown, fallback: string) => string;

export const useUsageTimelineData = ({
  canRequest,
  requestUsageGlobalTimeline,
  resolveErrorMessage,
}: {
  canRequest: boolean;
  requestUsageGlobalTimeline: RequestUsageGlobalTimeline;
  resolveErrorMessage: ResolveErrorMessage;
}) => {
  const [timeline, setTimeline] = useState<UsageGlobalTimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineRange, setTimelineRange] =
    useState<SessionStateTimelineRange>(TIMELINE_DEFAULT_RANGE);
  const [compactTimeline, setCompactTimeline] = useState(true);
  const timelineRequestIdRef = useRef(0);

  const loadTimeline = useCallback(
    async ({
      silent = false,
      range,
    }: {
      silent?: boolean;
      range?: SessionStateTimelineRange;
    } = {}) => {
      const requestId = ++timelineRequestIdRef.current;
      if (!canRequest) {
        setTimeline(null);
        setTimelineError(API_ERROR_MESSAGES.missingToken);
        return;
      }
      const nextRange = range ?? timelineRange;
      if (!silent) {
        setTimelineLoading(true);
      }
      try {
        const next = await requestUsageGlobalTimeline({ range: nextRange });
        if (requestId !== timelineRequestIdRef.current) {
          return;
        }
        setTimeline(next);
        setTimelineError(null);
      } catch (error) {
        if (requestId !== timelineRequestIdRef.current) {
          return;
        }
        setTimelineError(resolveErrorMessage(error, API_ERROR_MESSAGES.usageGlobalTimeline));
      } finally {
        if (!silent && requestId === timelineRequestIdRef.current) {
          // The loading flag is intentionally reset on the finally path for both outcomes.
          // react-doctor-disable-next-line no-loading-flag-reset-outside-finally
          setTimelineLoading(false);
        }
      }
    },
    [canRequest, requestUsageGlobalTimeline, resolveErrorMessage, timelineRange],
  );

  // Reload whenever the user switches range.
  useEffect(() => {
    // This is lifecycle data loading, not live child state forwarded to a parent callback.
    // react-doctor-disable-next-line no-pass-live-state-to-parent
    void loadTimeline({ range: timelineRange });
  }, [loadTimeline, timelineRange]);

  const handleTimelineRangeChange = useCallback((nextRange: SessionStateTimelineRange) => {
    setTimelineRange(nextRange);
    if (COMPACT_ONLY_TIMELINE_RANGES.has(nextRange)) {
      setCompactTimeline(true);
    }
  }, []);

  useVisibilityPolling({
    enabled: canRequest,
    intervalMs: TIMELINE_POLL_INTERVAL_MS,
    onTick: () => {
      void loadTimeline({ silent: true });
    },
    onResume: () => {
      void loadTimeline({ silent: true });
    },
  });

  return {
    timeline,
    timelineLoading,
    timelineError,
    timelineRange,
    setTimelineRange: handleTimelineRangeChange,
    compactTimeline,
    setCompactTimeline,
    loadTimeline,
  };
};
