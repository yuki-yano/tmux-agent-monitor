import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { createLaunchRequestId } from "@/lib/request-id";

import { useWorkspaceTabs } from "@/features/pwa-tabs/context/workspace-tabs-context";
import { useSessionListPins } from "@/features/shared-session-ui/hooks/useSessionListPins";
import { useSessionLogs } from "@/features/shared-session-ui/hooks/useSessionLogs";
import { buildSessionGroups } from "@/lib/session-group";
import { useNowMs } from "@/lib/use-now-ms";
import { useSidebarWidth } from "@/lib/use-sidebar-width";
import type { LaunchAgentRequestOptions } from "@/state/launch-agent-options";
import {
  useSessionBranchesApi,
  useSessionConfigData,
  useSessionCoreApi,
  useSessionLaunchApi,
  useSessionStreamData,
} from "@/state/session-context";
import { useTheme } from "@/state/theme-context";
import { useUsageApi } from "@/state/use-usage-api";

import { resolveBillingProviders, useUsageBillingData } from "./useUsageBillingData";
import { useUsageDashboardData } from "./useUsageDashboardData";
import { useUsageTimelineData } from "./useUsageTimelineData";
import { useRepositoryActivityData } from "./useRepositoryActivityData";
import { createUsageDashboardQueryScope } from "./usage-dashboard-query-keys";

export const useUsageDashboardVM = () => {
  const { sessions, connected, connectionIssue } = useSessionStreamData();
  const { token, apiBaseUrl, launchConfig, highlightCorrections, capabilities } =
    useSessionConfigData();
  const { requestStateTimeline, requestScreen, moveSessionToTop } = useSessionCoreApi();
  const { requestWorktrees } = useSessionBranchesApi();
  const { launchAgentInSession } = useSessionLaunchApi();
  const navigate = useNavigate();
  const { enabled: pwaTabsEnabled, openSessionTab } = useWorkspaceTabs();
  const { resolvedTheme } = useTheme();
  const { sidebarWidth, handlePointerDown } = useSidebarWidth();
  const { getRepoSortAnchorAt, touchRepoPin, touchPanePin } = useSessionListPins({
    onTouchPane: moveSessionToTop,
  });
  const {
    requestUsageDashboard,
    requestUsageProviderBilling,
    requestUsageGlobalTimeline,
    requestUsageRepositoryActivity,
    resolveErrorMessage,
  } = useUsageApi({ token, apiBaseUrl });

  const canRequest = Boolean(token);
  const nowMs = useNowMs(30_000);
  const queryScope = useMemo(
    () => createUsageDashboardQueryScope(apiBaseUrl, token),
    [apiBaseUrl, token],
  );

  const { dashboardCore, dashboardLoading, dashboardRefreshing, dashboardError, loadDashboard } =
    useUsageDashboardData({
      canRequest,
      queryScope,
      requestUsageDashboard,
      resolveErrorMessage,
    });

  const {
    dashboard,
    billingLoadingByProvider,
    billingRefreshingByProvider,
    loadAllProviderBilling,
  } = useUsageBillingData({
    canRequest,
    queryScope,
    dashboardCore,
    requestUsageProviderBilling,
    resolveErrorMessage,
  });

  const {
    timeline,
    timelineLoading,
    timelineRefreshing,
    timelineError,
    timelineRange,
    setTimelineRange,
    compactTimeline,
    setCompactTimeline,
    loadTimeline,
  } = useUsageTimelineData({
    canRequest,
    queryScope,
    requestUsageGlobalTimeline,
    resolveErrorMessage,
  });

  const {
    activity: repositoryActivity,
    loading: repositoryActivityLoading,
    refreshing: repositoryActivityRefreshing,
    error: repositoryActivityError,
    range: repositoryActivityRange,
    setRange: setRepositoryActivityRange,
    load: loadRepositoryActivity,
  } = useRepositoryActivityData({
    canRequest,
    queryScope,
    requestRepositoryActivity: requestUsageRepositoryActivity,
    resolveErrorMessage,
  });

  const sidebarSessionGroups = useMemo(
    () =>
      buildSessionGroups(sessions, {
        getRepoSortAnchorAt,
      }),
    [getRepoSortAnchorAt, sessions],
  );
  const quickPanelGroups = sidebarSessionGroups;
  const {
    quickPanelOpen,
    logModalOpen,
    selectedPaneId,
    selectedSession,
    selectedLogLines,
    selectedLogLoading,
    selectedLogError,
    openLogModal,
    closeLogModal,
    toggleQuickPanel,
    closeQuickPanel,
  } = useSessionLogs({
    connected,
    connectionIssue,
    sessions,
    requestScreen,
    resolvedTheme,
    highlightCorrections,
  });

  const refreshAll = useCallback(() => {
    void loadTimeline();
    void loadRepositoryActivity();
    void loadDashboard({ forceRefresh: true }).then((nextDashboard) => {
      if (nextDashboard == null) return;
      return loadAllProviderBilling({
        providers: resolveBillingProviders(nextDashboard),
        forceRefresh: true,
      });
    });
  }, [loadAllProviderBilling, loadDashboard, loadRepositoryActivity, loadTimeline]);

  const handleOpenPaneInNewWindow = useCallback(
    (targetPaneId: string) => {
      closeQuickPanel();
      closeLogModal();
      if (pwaTabsEnabled) {
        openSessionTab(targetPaneId);
        return;
      }
      const encoded = encodeURIComponent(targetPaneId);
      window.open(`/sessions/${encoded}`, "_blank", "noopener,noreferrer");
    },
    [closeLogModal, closeQuickPanel, openSessionTab, pwaTabsEnabled],
  );

  const handleOpenPaneHere = useCallback(
    (targetPaneId: string) => {
      closeQuickPanel();
      closeLogModal();
      void navigate({
        to: "/sessions/$paneId",
        params: { paneId: targetPaneId },
      });
    },
    [closeLogModal, closeQuickPanel, navigate],
  );

  const handleOpenHere = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneHere(selectedPaneId);
  }, [handleOpenPaneHere, selectedPaneId]);

  const handleOpenInNewTab = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneInNewWindow(selectedPaneId);
  }, [handleOpenPaneInNewWindow, selectedPaneId]);

  const handleLaunchAgentInSession = useCallback(
    async (sessionName: string, agent: "codex" | "claude", options?: LaunchAgentRequestOptions) => {
      await launchAgentInSession(sessionName, agent, createLaunchRequestId(), options);
    },
    [launchAgentInSession],
  );

  return {
    sessions,
    connected,
    connectionIssue,
    launchConfig,
    capabilities,
    requestWorktrees,
    requestStateTimeline,
    requestScreen,
    highlightCorrections,
    resolvedTheme,
    sidebarSessionGroups,
    sidebarWidth,
    dashboard,
    dashboardLoading,
    dashboardRefreshing,
    billingLoadingByProvider,
    billingRefreshingByProvider,
    dashboardError,
    timeline,
    timelineLoading,
    timelineRefreshing,
    timelineError,
    timelineRange,
    repositoryActivity,
    repositoryActivityLoading,
    repositoryActivityRefreshing,
    repositoryActivityError,
    repositoryActivityRange,
    compactTimeline,
    nowMs,
    onTimelineRangeChange: setTimelineRange,
    onRepositoryActivityRangeChange: setRepositoryActivityRange,
    onToggleCompactTimeline: () => {
      setCompactTimeline((current) => !current);
    },
    onRefreshAll: refreshAll,
    quickPanelGroups,
    quickPanelOpen,
    logModalOpen,
    selectedSession,
    selectedLogLines,
    selectedLogLoading,
    selectedLogError,
    onOpenLogModal: openLogModal,
    onCloseLogModal: closeLogModal,
    onToggleQuickPanel: toggleQuickPanel,
    onCloseQuickPanel: closeQuickPanel,
    onOpenPaneHere: handleOpenPaneHere,
    onOpenPaneInNewWindow: handleOpenPaneInNewWindow,
    onSidebarResizeStart: handlePointerDown,
    onLaunchAgentInSession: handleLaunchAgentInSession,
    onTouchPanePin: touchPanePin,
    onTouchRepoPin: touchRepoPin,
    onOpenHere: handleOpenHere,
    onOpenNewTab: handleOpenInNewTab,
  };
};

export type UsageDashboardVM = ReturnType<typeof useUsageDashboardVM>;
