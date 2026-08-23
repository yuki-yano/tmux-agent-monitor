import type { UsageDashboardResponse } from "@vde-monitor/shared";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import {
  type BillingProviderId,
  FALLBACK_BILLING_PROVIDERS,
  mergeIssues,
} from "./useUsageBillingData";

const DASHBOARD_POLL_INTERVAL_MS = 30_000;

const isBillingProviderId = (providerId: string): providerId is BillingProviderId =>
  providerId === "codex" || providerId === "claude";

const mergeDashboardCore = (
  current: UsageDashboardResponse | null,
  next: UsageDashboardResponse,
): UsageDashboardResponse => {
  if (!current) {
    return next;
  }
  const currentByProvider = new Map(
    current.providers.map((provider) => [provider.providerId, provider] as const),
  );
  return {
    ...next,
    providers: next.providers.map((provider) => {
      const existing = currentByProvider.get(provider.providerId);
      if (!existing) {
        return provider;
      }
      return {
        ...provider,
        billing: existing.billing,
        capabilities: {
          ...provider.capabilities,
          cost: existing.capabilities.cost,
        },
        issues: mergeIssues(provider.issues, existing.issues),
      };
    }),
  };
};

type SetDashboard = Dispatch<SetStateAction<UsageDashboardResponse | null>>;

type RequestUsageDashboard = (options: { refresh?: boolean }) => Promise<UsageDashboardResponse>;

type ResolveErrorMessage = (error: unknown, fallback: string) => string;

export const useUsageDashboardData = ({
  canRequest,
  requestUsageDashboard,
  resolveErrorMessage,
  setDashboard,
  loadAllProviderBilling,
  resetBillingState,
}: {
  canRequest: boolean;
  requestUsageDashboard: RequestUsageDashboard;
  resolveErrorMessage: ResolveErrorMessage;
  setDashboard: SetDashboard;
  loadAllProviderBilling: (params?: {
    providers?: BillingProviderId[];
    forceRefresh?: boolean;
  }) => Promise<void>;
  resetBillingState: () => void;
}) => {
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const dashboardRequestIdRef = useRef(0);
  // Tracks whether the initial billing load has already been triggered; ensures that
  // silent polling ticks (withBilling=false) still trigger billing on the very first load.
  const initialBillingRequestedRef = useRef(false);

  const loadDashboard = useCallback(
    async ({
      forceRefresh = false,
      silent = false,
      withBilling = true,
    }: {
      forceRefresh?: boolean;
      silent?: boolean;
      withBilling?: boolean;
    } = {}) => {
      const requestId = ++dashboardRequestIdRef.current;
      if (!canRequest) {
        setDashboard(null);
        setDashboardError(API_ERROR_MESSAGES.missingToken);
        initialBillingRequestedRef.current = false;
        resetBillingState();
        return;
      }
      if (!silent) {
        setDashboardLoading(true);
      }
      try {
        const next = await requestUsageDashboard({ refresh: forceRefresh });
        if (requestId !== dashboardRequestIdRef.current) {
          return;
        }
        setDashboard((current) => mergeDashboardCore(current, next));
        setDashboardError(null);
        // Derive billing providers from dashboard response; fall back to known providers.
        const billingProviders: BillingProviderId[] = [];
        next.providers.forEach((provider) => {
          if (isBillingProviderId(provider.providerId)) {
            billingProviders.push(provider.providerId);
          }
        });
        const resolvedProviders =
          billingProviders.length > 0 ? billingProviders : FALLBACK_BILLING_PROVIDERS;
        // Always load billing on the first successful dashboard load, even when the
        // caller passes withBilling=false (e.g. a silent polling tick).
        const shouldLoadBilling = withBilling || !initialBillingRequestedRef.current;
        if (shouldLoadBilling) {
          initialBillingRequestedRef.current = true;
          void loadAllProviderBilling({ providers: resolvedProviders, forceRefresh });
        }
      } catch (error) {
        if (requestId !== dashboardRequestIdRef.current) {
          return;
        }
        setDashboardError(resolveErrorMessage(error, API_ERROR_MESSAGES.usageDashboard));
      } finally {
        if (!silent && requestId === dashboardRequestIdRef.current) {
          // The loading flag is intentionally reset on the finally path for both outcomes.
          // react-doctor-disable-next-line no-loading-flag-reset-outside-finally
          setDashboardLoading(false);
        }
      }
    },
    [
      canRequest,
      loadAllProviderBilling,
      requestUsageDashboard,
      resolveErrorMessage,
      resetBillingState,
      setDashboard,
    ],
  );

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- This effect owns initial loading and request guards.
    void loadDashboard();
  }, [loadDashboard]);

  useVisibilityPolling({
    enabled: canRequest,
    intervalMs: DASHBOARD_POLL_INTERVAL_MS,
    onTick: () => {
      void loadDashboard({ silent: true, withBilling: false });
    },
    onResume: () => {
      void loadDashboard({ silent: true, withBilling: false });
    },
  });

  return { dashboardLoading, dashboardError, loadDashboard };
};
