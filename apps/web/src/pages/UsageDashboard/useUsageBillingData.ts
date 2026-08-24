import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  UsageDashboardResponse,
  UsageIssue,
  UsageProviderSnapshot,
} from "@vde-monitor/shared";
import { useCallback, useMemo, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  type UsageDashboardQueryScope,
  usageDashboardQueryKeys,
} from "./usage-dashboard-query-keys";

const BILLING_POLL_INTERVAL_MS = 180_000;
const BILLING_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  networkMode: "online" as const,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  refetchOnReconnect: "always" as const,
  refetchInterval: BILLING_POLL_INTERVAL_MS,
  refetchIntervalInBackground: false,
};

export type BillingProviderId = "codex" | "claude";
export const FALLBACK_BILLING_PROVIDERS: BillingProviderId[] = ["codex", "claude"];

export const mergeIssues = (current: UsageIssue[], next: UsageIssue[]): UsageIssue[] => {
  if (next.length === 0) return current;
  const merged = [...current];
  for (const issue of next) {
    if (!merged.some((item) => item.code === issue.code && item.message === issue.message)) {
      merged.push(issue);
    }
  }
  return merged;
};

const isBillingProviderId = (providerId: string): providerId is BillingProviderId =>
  providerId === "codex" || providerId === "claude";

export const resolveBillingProviders = (
  dashboard: UsageDashboardResponse | null | undefined,
): BillingProviderId[] => {
  const available: BillingProviderId[] = [];
  for (const provider of dashboard?.providers ?? []) {
    if (isBillingProviderId(provider.providerId)) available.push(provider.providerId);
  }
  return available.length > 0 ? available : FALLBACK_BILLING_PROVIDERS;
};

const projectBillingSnapshot = (
  current: UsageProviderSnapshot,
  snapshot: UsageProviderSnapshot,
): UsageProviderSnapshot => ({
  ...current,
  billing: snapshot.billing,
  capabilities: {
    ...current.capabilities,
    cost: snapshot.capabilities.cost,
  },
  issues: mergeIssues(current.issues, snapshot.issues),
});

const projectBillingError = (
  current: UsageProviderSnapshot,
  message: string,
  errorUpdatedAt: number,
): UsageProviderSnapshot => {
  const issue: UsageIssue = {
    code: "COST_SOURCE_UNAVAILABLE",
    message,
    severity: "warning",
  };
  return {
    ...current,
    billing: {
      ...current.billing,
      meta: {
        source: "unavailable",
        sourceLabel: current.billing.meta.sourceLabel,
        confidence: null,
        updatedAt: new Date(errorUpdatedAt).toISOString(),
        reasonCode: issue.code,
        reasonMessage: issue.message,
      },
      modelBreakdown: [],
      dailyBreakdown: [],
    },
    issues: mergeIssues(current.issues, [issue]),
  };
};

type RequestUsageProviderBilling = (
  options: { provider: BillingProviderId; refresh?: boolean },
  signal?: AbortSignal,
) => Promise<UsageProviderSnapshot>;
type ResolveErrorMessage = (error: unknown, fallback: string) => string;

type BillingRefreshSnapshot = {
  queryClient: QueryClient;
  queryKey: QueryKey;
  operationKey: string;
  requestUsageProviderBilling: RequestUsageProviderBilling;
  provider: BillingProviderId;
  forceRefresh: boolean;
};

const requestBilling = async (
  requestUsageProviderBilling: RequestUsageProviderBilling,
  provider: BillingProviderId,
  refresh: boolean,
  signal?: AbortSignal,
) => {
  const response = await requestUsageProviderBilling({ provider, refresh }, signal);
  if (response.providerId !== provider) throw new Error(API_ERROR_MESSAGES.invalidResponse);
  return response;
};

const refreshProviderBilling = async ({
  queryClient,
  queryKey,
  requestUsageProviderBilling,
  provider,
  forceRefresh,
}: BillingRefreshSnapshot) => {
  if (forceRefresh) await queryClient.cancelQueries({ queryKey, exact: true });
  try {
    await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) =>
        requestBilling(requestUsageProviderBilling, provider, forceRefresh, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "always",
    });
  } catch {
    // Query state owns the billing fallback projection.
  }
};

const markBillingQueryStale = (_data: void, variables: BillingRefreshSnapshot) => {
  void variables.queryClient.invalidateQueries({
    queryKey: variables.queryKey,
    exact: true,
    refetchType: "none",
  });
};

export const useUsageBillingData = ({
  canRequest,
  queryScope,
  dashboardCore,
  requestUsageProviderBilling,
  resolveErrorMessage,
}: {
  canRequest: boolean;
  queryScope: UsageDashboardQueryScope;
  dashboardCore: UsageDashboardResponse | null;
  requestUsageProviderBilling: RequestUsageProviderBilling;
  resolveErrorMessage: ResolveErrorMessage;
}) => {
  const queryClient = useQueryClient();
  const providers = useMemo(() => resolveBillingProviders(dashboardCore), [dashboardCore]);
  const codexEnabled = canRequest && dashboardCore != null && providers.includes("codex");
  const claudeEnabled = canRequest && dashboardCore != null && providers.includes("claude");
  const codexQueryKey = useMemo(
    () => usageDashboardQueryKeys.billing(queryScope, "codex"),
    [queryScope],
  );
  const claudeQueryKey = useMemo(
    () => usageDashboardQueryKeys.billing(queryScope, "claude"),
    [queryScope],
  );
  const codexObserverQueryKey = useMemo(
    () => (codexEnabled ? codexQueryKey : [...codexQueryKey, "disabled"]),
    [codexEnabled, codexQueryKey],
  );
  const claudeObserverQueryKey = useMemo(
    () => (claudeEnabled ? claudeQueryKey : [...claudeQueryKey, "disabled"]),
    [claudeEnabled, claudeQueryKey],
  );
  const codexQuery = useQuery({
    queryKey: codexObserverQueryKey,
    queryFn: ({ signal }) => requestBilling(requestUsageProviderBilling, "codex", false, signal),
    enabled: codexEnabled,
    ...BILLING_QUERY_OPTIONS,
  });
  const claudeQuery = useQuery({
    queryKey: claudeObserverQueryKey,
    queryFn: ({ signal }) => requestBilling(requestUsageProviderBilling, "claude", false, signal),
    enabled: claudeEnabled,
    ...BILLING_QUERY_OPTIONS,
  });

  const dashboard = useMemo(() => {
    if (dashboardCore == null) return null;
    return {
      ...dashboardCore,
      providers: dashboardCore.providers.map((provider) => {
        if (!isBillingProviderId(provider.providerId)) return provider;
        const query = provider.providerId === "codex" ? codexQuery : claudeQuery;
        if (query.error != null) {
          return projectBillingError(
            provider,
            resolveErrorMessage(query.error, API_ERROR_MESSAGES.usageProviderBilling),
            query.errorUpdatedAt,
          );
        }
        return query.data == null ? provider : projectBillingSnapshot(provider, query.data);
      }),
    };
  }, [claudeQuery, codexQuery, dashboardCore, resolveErrorMessage]);

  const codexRefresh = useMutation({
    mutationFn: refreshProviderBilling,
    networkMode: "always",
    onSuccess: markBillingQueryStale,
  });
  const claudeRefresh = useMutation({
    mutationFn: refreshProviderBilling,
    networkMode: "always",
    onSuccess: markBillingQueryStale,
  });
  const manualOperationsRef = useRef(new Map<string, Promise<void>>());

  const loadProviderBilling = useCallback(
    (provider: BillingProviderId, forceRefresh: boolean) => {
      if (!canRequest) return Promise.resolve();
      const queryKey = usageDashboardQueryKeys.billing(queryScope, provider);
      const operationKey = JSON.stringify(queryKey);
      const runningOperation = manualOperationsRef.current.get(operationKey);
      if (runningOperation != null) return runningOperation;

      const refresh = provider === "codex" ? codexRefresh : claudeRefresh;
      const operation = refresh
        .mutateAsync({
          queryClient,
          queryKey,
          operationKey,
          requestUsageProviderBilling,
          provider,
          forceRefresh,
        })
        .finally(() => {
          if (manualOperationsRef.current.get(operationKey) === operation) {
            manualOperationsRef.current.delete(operationKey);
          }
        });
      manualOperationsRef.current.set(operationKey, operation);
      return operation;
    },
    [canRequest, claudeRefresh, codexRefresh, queryClient, queryScope, requestUsageProviderBilling],
  );

  const loadAllProviderBilling = useCallback(
    async ({
      providers: requestedProviders,
      forceRefresh = false,
    }: { providers?: BillingProviderId[]; forceRefresh?: boolean } = {}) => {
      await Promise.all(
        (requestedProviders ?? providers).map((provider) =>
          loadProviderBilling(provider, forceRefresh),
        ),
      );
    },
    [loadProviderBilling, providers],
  );

  return {
    dashboard,
    billingLoadingByProvider: {
      codex: codexQuery.isLoading,
      claude: claudeQuery.isLoading,
    },
    billingRefreshingByProvider: {
      codex:
        codexRefresh.isPending &&
        codexRefresh.variables.operationKey === JSON.stringify(codexQueryKey),
      claude:
        claudeRefresh.isPending &&
        claudeRefresh.variables.operationKey === JSON.stringify(claudeQueryKey),
    },
    loadAllProviderBilling,
  };
};
