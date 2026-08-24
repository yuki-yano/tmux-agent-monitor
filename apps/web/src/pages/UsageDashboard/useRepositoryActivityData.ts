import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UsageRepositoryActivityResponse } from "@vde-monitor/shared";
import { useCallback, useMemo, useState } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import type { RepositoryActivityRange } from "./repository-activity-types";
import {
  type UsageDashboardQueryScope,
  usageDashboardQueryKeys,
} from "./usage-dashboard-query-keys";

const REPOSITORY_ACTIVITY_POLL_INTERVAL_MS = 15_000;
const DEFAULT_REPOSITORY_ACTIVITY_RANGE: RepositoryActivityRange = "24h";

type RequestRepositoryActivity = (
  options: {
    range: RepositoryActivityRange;
  },
  signal?: AbortSignal,
) => Promise<UsageRepositoryActivityResponse>;
type ResolveErrorMessage = (error: unknown, fallback: string) => string;

type RepositoryActivityRefreshSnapshot = {
  queryClient: QueryClient;
  queryKey: QueryKey;
  operationKey: string;
  requestRepositoryActivity: RequestRepositoryActivity;
  range: RepositoryActivityRange;
};

const requestActivity = async (
  requestRepositoryActivity: RequestRepositoryActivity,
  range: RepositoryActivityRange,
  signal?: AbortSignal,
) => {
  const response = await requestRepositoryActivity({ range }, signal);
  if (response.range !== range) throw new Error(API_ERROR_MESSAGES.invalidResponse);
  return response;
};

const refreshRepositoryActivity = async ({
  queryClient,
  queryKey,
  requestRepositoryActivity,
  range,
}: RepositoryActivityRefreshSnapshot) => {
  await queryClient.cancelQueries({ queryKey, exact: true });
  try {
    await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) => requestActivity(requestRepositoryActivity, range, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "always",
    });
  } catch {
    // Query state owns the visible error.
  }
};

export const useRepositoryActivityData = ({
  canRequest,
  queryScope,
  requestRepositoryActivity,
  resolveErrorMessage,
}: {
  canRequest: boolean;
  queryScope: UsageDashboardQueryScope;
  requestRepositoryActivity: RequestRepositoryActivity;
  resolveErrorMessage: ResolveErrorMessage;
}) => {
  const queryClient = useQueryClient();
  const [range, setRangeState] = useState<RepositoryActivityRange>(
    DEFAULT_REPOSITORY_ACTIVITY_RANGE,
  );
  const queryKey = useMemo(
    () => usageDashboardQueryKeys.repositoryActivity(queryScope, range),
    [queryScope, range],
  );
  const operationKey = JSON.stringify(queryKey);
  const requestCurrentRange = useCallback(
    (signal?: AbortSignal) => requestActivity(requestRepositoryActivity, range, signal),
    [range, requestRepositoryActivity],
  );
  const {
    data,
    error: queryError,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestCurrentRange(signal),
    enabled: canRequest,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: REPOSITORY_ACTIVITY_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const activityRefresh = useMutation({
    mutationFn: refreshRepositoryActivity,
    networkMode: "always",
    onSuccess: (_data, variables) => {
      void variables.queryClient.invalidateQueries({
        queryKey: variables.queryKey,
        exact: true,
        refetchType: "none",
      });
    },
  });
  const load = useCallback(() => {
    if (!canRequest) return Promise.resolve();
    return activityRefresh.mutateAsync({
      queryClient,
      queryKey,
      operationKey,
      requestRepositoryActivity,
      range,
    });
  }, [
    activityRefresh,
    canRequest,
    operationKey,
    queryClient,
    queryKey,
    range,
    requestRepositoryActivity,
  ]);

  const handleRangeChange = useCallback(
    (nextRange: RepositoryActivityRange) => {
      if (nextRange === range) return;
      queryClient.removeQueries({ queryKey, exact: true });
      setRangeState(nextRange);
    },
    [queryClient, queryKey, range],
  );
  const error = !canRequest
    ? API_ERROR_MESSAGES.missingToken
    : queryError == null
      ? null
      : resolveErrorMessage(queryError, API_ERROR_MESSAGES.usageRepositoryActivity);

  return {
    activity: error == null ? (data ?? null) : null,
    loading: isLoading,
    refreshing:
      activityRefresh.isPending && activityRefresh.variables.operationKey === operationKey,
    error,
    range,
    setRange: handleRangeChange,
    load,
  };
};
