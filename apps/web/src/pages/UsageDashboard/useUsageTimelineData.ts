import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SessionStateTimelineRange, UsageGlobalTimelineResponse } from "@vde-monitor/shared";
import { useCallback, useMemo, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  type UsageDashboardQueryScope,
  usageDashboardQueryKeys,
} from "./usage-dashboard-query-keys";

const TIMELINE_POLL_INTERVAL_MS = 15_000;
const TIMELINE_DEFAULT_RANGE: SessionStateTimelineRange = "24h";
const COMPACT_ONLY_TIMELINE_RANGES = new Set<SessionStateTimelineRange>(["3d", "7d", "14d", "30d"]);

type RequestUsageGlobalTimeline = (
  options: {
    range?: SessionStateTimelineRange;
  },
  signal?: AbortSignal,
) => Promise<UsageGlobalTimelineResponse>;
type ResolveErrorMessage = (error: unknown, fallback: string) => string;

type TimelineRefreshSnapshot = {
  queryClient: QueryClient;
  queryKey: QueryKey;
  operationKey: string;
  requestUsageGlobalTimeline: RequestUsageGlobalTimeline;
  range: SessionStateTimelineRange;
};

const requestTimeline = async (
  requestUsageGlobalTimeline: RequestUsageGlobalTimeline,
  range: SessionStateTimelineRange,
  signal?: AbortSignal,
) => {
  const response = await requestUsageGlobalTimeline({ range }, signal);
  if (response.timeline.range !== range) throw new Error(API_ERROR_MESSAGES.invalidResponse);
  return response;
};

const refreshUsageTimeline = async ({
  queryClient,
  queryKey,
  requestUsageGlobalTimeline,
  range,
}: TimelineRefreshSnapshot) => {
  await queryClient.cancelQueries({ queryKey, exact: true });
  try {
    await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) => requestTimeline(requestUsageGlobalTimeline, range, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "always",
    });
  } catch {
    // Query state owns the visible error.
  }
};

export const useUsageTimelineData = ({
  canRequest,
  queryScope,
  requestUsageGlobalTimeline,
  resolveErrorMessage,
}: {
  canRequest: boolean;
  queryScope: UsageDashboardQueryScope;
  requestUsageGlobalTimeline: RequestUsageGlobalTimeline;
  resolveErrorMessage: ResolveErrorMessage;
}) => {
  const queryClient = useQueryClient();
  const [timelineRange, setTimelineRangeState] =
    useState<SessionStateTimelineRange>(TIMELINE_DEFAULT_RANGE);
  const [compactTimeline, setCompactTimeline] = useState(true);
  const queryKey = useMemo(
    () => usageDashboardQueryKeys.timeline(queryScope, timelineRange),
    [queryScope, timelineRange],
  );
  const operationKey = JSON.stringify(queryKey);
  const requestCurrentTimeline = useCallback(
    (signal?: AbortSignal) => requestTimeline(requestUsageGlobalTimeline, timelineRange, signal),
    [requestUsageGlobalTimeline, timelineRange],
  );
  const {
    data: timeline = null,
    error: queryError,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestCurrentTimeline(signal),
    enabled: canRequest,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: TIMELINE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const timelineRefresh = useMutation({
    mutationFn: refreshUsageTimeline,
    networkMode: "always",
    onSuccess: (_data, variables) => {
      void variables.queryClient.invalidateQueries({
        queryKey: variables.queryKey,
        exact: true,
        refetchType: "none",
      });
    },
  });
  const loadTimeline = useCallback(() => {
    if (!canRequest) return Promise.resolve();
    return timelineRefresh.mutateAsync({
      queryClient,
      queryKey,
      operationKey,
      requestUsageGlobalTimeline,
      range: timelineRange,
    });
  }, [
    canRequest,
    operationKey,
    queryClient,
    queryKey,
    requestUsageGlobalTimeline,
    timelineRefresh,
    timelineRange,
  ]);

  const handleTimelineRangeChange = useCallback(
    (nextRange: SessionStateTimelineRange) => {
      if (nextRange === timelineRange) return;
      queryClient.removeQueries({ queryKey, exact: true });
      setTimelineRangeState(nextRange);
      if (COMPACT_ONLY_TIMELINE_RANGES.has(nextRange)) setCompactTimeline(true);
    },
    [queryClient, queryKey, timelineRange],
  );

  return {
    timeline,
    timelineLoading: isLoading,
    timelineRefreshing:
      timelineRefresh.isPending && timelineRefresh.variables.operationKey === operationKey,
    timelineError: !canRequest
      ? API_ERROR_MESSAGES.missingToken
      : queryError == null
        ? null
        : resolveErrorMessage(queryError, API_ERROR_MESSAGES.usageGlobalTimeline),
    timelineRange,
    setTimelineRange: handleTimelineRangeChange,
    compactTimeline,
    setCompactTimeline,
    loadTimeline,
  };
};
