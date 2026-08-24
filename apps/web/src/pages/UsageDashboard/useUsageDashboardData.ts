import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UsageDashboardResponse } from "@vde-monitor/shared";
import { useCallback, useMemo } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  type UsageDashboardQueryScope,
  usageDashboardQueryKeys,
} from "./usage-dashboard-query-keys";

const DASHBOARD_POLL_INTERVAL_MS = 30_000;

type RequestUsageDashboard = (
  options: { refresh?: boolean },
  signal?: AbortSignal,
) => Promise<UsageDashboardResponse>;
type ResolveErrorMessage = (error: unknown, fallback: string) => string;

type DashboardRefreshSnapshot = {
  queryClient: QueryClient;
  queryKey: QueryKey;
  operationKey: string;
  requestUsageDashboard: RequestUsageDashboard;
  forceRefresh: boolean;
};

const refreshUsageDashboard = async ({
  queryClient,
  queryKey,
  requestUsageDashboard,
  forceRefresh,
}: DashboardRefreshSnapshot) => {
  await queryClient.cancelQueries({ queryKey, exact: true });
  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) => requestUsageDashboard({ refresh: forceRefresh }, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "always",
    });
  } catch {
    return undefined;
  }
};

export const useUsageDashboardData = ({
  canRequest,
  queryScope,
  requestUsageDashboard,
  resolveErrorMessage,
}: {
  canRequest: boolean;
  queryScope: UsageDashboardQueryScope;
  requestUsageDashboard: RequestUsageDashboard;
  resolveErrorMessage: ResolveErrorMessage;
}) => {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => usageDashboardQueryKeys.dashboard(queryScope), [queryScope]);
  const operationKey = JSON.stringify(queryKey);
  const {
    data: dashboardCore = null,
    error: queryError,
    isLoading,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestUsageDashboard({}, signal),
    enabled: canRequest,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "online",
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: DASHBOARD_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const dashboardRefresh = useMutation({
    mutationFn: refreshUsageDashboard,
    networkMode: "always",
    onSuccess: (_data, variables) => {
      void variables.queryClient.invalidateQueries({
        queryKey: variables.queryKey,
        exact: true,
        refetchType: "none",
      });
    },
  });
  const loadDashboard = useCallback(
    ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
      if (!canRequest) return Promise.resolve(undefined);
      return dashboardRefresh.mutateAsync({
        queryClient,
        queryKey,
        operationKey,
        requestUsageDashboard,
        forceRefresh,
      });
    },
    [canRequest, dashboardRefresh, operationKey, queryClient, queryKey, requestUsageDashboard],
  );

  return {
    dashboardCore,
    dashboardLoading: isLoading,
    dashboardRefreshing:
      dashboardRefresh.isPending && dashboardRefresh.variables.operationKey === operationKey,
    dashboardError: !canRequest
      ? API_ERROR_MESSAGES.missingToken
      : queryError == null
        ? null
        : resolveErrorMessage(queryError, API_ERROR_MESSAGES.usageDashboard),
    loadDashboard,
  };
};
