import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageRepositoryActivityResponse } from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import type { RepositoryActivityRange } from "./repository-activity-types";

const REPOSITORY_ACTIVITY_POLL_INTERVAL_MS = 15_000;
const DEFAULT_REPOSITORY_ACTIVITY_RANGE: RepositoryActivityRange = "24h";

type RequestRepositoryActivity = (options: {
  range: RepositoryActivityRange;
}) => Promise<UsageRepositoryActivityResponse>;

type ResolveErrorMessage = (error: unknown, fallback: string) => string;

export const useRepositoryActivityData = ({
  canRequest,
  requestRepositoryActivity,
  resolveErrorMessage,
}: {
  canRequest: boolean;
  requestRepositoryActivity: RequestRepositoryActivity;
  resolveErrorMessage: ResolveErrorMessage;
}) => {
  const [activity, setActivity] = useState<UsageRepositoryActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RepositoryActivityRange>(DEFAULT_REPOSITORY_ACTIVITY_RANGE);
  const requestIdRef = useRef(0);
  const rangeRef = useRef<RepositoryActivityRange>(DEFAULT_REPOSITORY_ACTIVITY_RANGE);
  const visibleLoadingRef = useRef(false);

  const setVisibleLoading = useCallback((next: boolean) => {
    visibleLoadingRef.current = next;
    setLoading(next);
  }, []);

  const load = useCallback(
    async ({
      silent = false,
      requestedRange,
    }: { silent?: boolean; requestedRange?: RepositoryActivityRange } = {}) => {
      const resolvedRange = requestedRange ?? rangeRef.current;
      const requestId = ++requestIdRef.current;
      if (!canRequest) {
        setActivity(null);
        setVisibleLoading(false);
        setError(API_ERROR_MESSAGES.missingToken);
        return;
      }
      if (!silent) {
        setVisibleLoading(true);
        setActivity(null);
      }
      try {
        const next = await requestRepositoryActivity({ range: resolvedRange });
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (next.range !== resolvedRange) {
          throw new Error(API_ERROR_MESSAGES.invalidResponse);
        }
        setActivity(next);
        setError(null);
      } catch (nextError) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setActivity(null);
        setError(resolveErrorMessage(nextError, API_ERROR_MESSAGES.usageRepositoryActivity));
      } finally {
        if (requestId === requestIdRef.current && visibleLoadingRef.current) {
          setVisibleLoading(false);
        }
      }
    },
    [canRequest, requestRepositoryActivity, resolveErrorMessage, setVisibleLoading],
  );

  useEffect(() => {
    // This is lifecycle data loading, not live child state forwarded to a parent callback.
    /* oxlint-disable react/set-state-in-effect -- Range changes start a guarded lifecycle request. */
    // react-doctor-disable-next-line no-pass-live-state-to-parent
    void load({ requestedRange: range });
    /* oxlint-enable react/set-state-in-effect */
  }, [load, range]);

  const handleRangeChange = useCallback(
    (nextRange: RepositoryActivityRange) => {
      if (nextRange === range) {
        return;
      }
      rangeRef.current = nextRange;
      requestIdRef.current += 1;
      setActivity(null);
      setError(null);
      setVisibleLoading(true);
      setRange(nextRange);
    },
    [range, setVisibleLoading],
  );

  useVisibilityPolling({
    enabled: canRequest,
    intervalMs: REPOSITORY_ACTIVITY_POLL_INTERVAL_MS,
    onTick: () => {
      void load({ silent: true });
    },
    onResume: () => {
      void load({ silent: true });
    },
  });

  return {
    activity,
    loading,
    error,
    range,
    setRange: handleRangeChange,
    load,
  };
};
