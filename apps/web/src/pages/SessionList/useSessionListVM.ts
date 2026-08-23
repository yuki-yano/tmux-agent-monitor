import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { createLaunchRequestId } from "@/lib/request-id";

import { useWorkspaceTabs } from "@/features/pwa-tabs/context/workspace-tabs-context";
import { useSessionGroupingSelector } from "@/features/shared-session-ui/hooks/useSessionGroupingSelector";
import { useSessionListPins } from "@/features/shared-session-ui/hooks/useSessionListPins";
import { useSessionLogs } from "@/features/shared-session-ui/hooks/useSessionLogs";
import {
  DEFAULT_SESSION_LIST_FILTER,
  SESSION_LIST_FILTER_VALUES,
  isSessionListFilter,
  storeSessionListFilter,
} from "@/features/shared-session-ui/model/session-list-filters";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { useLazyRef } from "@/lib/use-lazy-ref";
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

import {
  hasSessionListSearchTerms,
  matchesSessionListSearch,
  normalizeSessionListSearchQuery,
} from "./sessionListSearch";

const FILTER_OPTIONS = SESSION_LIST_FILTER_VALUES.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

export const useSessionListVM = () => {
  const {
    sessions,
    connected,
    hasLoadedInitialSessions,
    connectionStatus,
    connectionIssue,
    transport,
  } = useSessionStreamData();
  const { highlightCorrections, launchConfig, capabilities } = useSessionConfigData();
  const { refreshSessions, requestStateTimeline, requestScreen, moveSessionToTop } =
    useSessionCoreApi();
  const { requestWorktrees } = useSessionBranchesApi();
  const { launchAgentInSession } = useSessionLaunchApi();
  const nowMs = useNowMs();
  const search = useSearch({ from: "/" });
  const filter = isSessionListFilter(search.filter) ? search.filter : DEFAULT_SESSION_LIST_FILTER;
  const searchQuery = normalizeSessionListSearchQuery(search.q);
  const navigate = useNavigate({ from: "/" });
  const { enabled: pwaTabsEnabled, openSessionTab } = useWorkspaceTabs();
  const { resolvedTheme } = useTheme();
  const { sidebarWidth, handlePointerDown } = useSidebarWidth();
  const [launchPendingSessions, setLaunchPendingSessions] = useState<Set<string>>(() => new Set());
  const [screenError, setScreenError] = useState<string | null>(null);
  const launchPendingRef = useLazyRef(() => new Set<string>());
  const { getRepoSortAnchorAt, touchRepoPin, touchPanePin } = useSessionListPins({
    onTouchPane: moveSessionToTop,
  });

  useEffect(() => {
    storeSessionListFilter(filter);
  }, [filter]);

  const { visibleSessions, groups, sidebarSessionGroups, quickPanelGroups } =
    useSessionGroupingSelector({
      sessions,
      filter,
      searchQuery,
      matchesSearch: matchesSessionListSearch,
      getRepoSortAnchorAt,
    });

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

  const handleOpenInNewTab = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneInNewWindow(selectedPaneId);
  }, [handleOpenPaneInNewWindow, selectedPaneId]);

  const handleOpenPaneHere = useCallback(
    (targetPaneId: string) => {
      closeQuickPanel();
      void navigate({ to: "/sessions/$paneId", params: { paneId: targetPaneId } });
      closeLogModal();
    },
    [closeLogModal, closeQuickPanel, navigate],
  );

  const handleOpenHere = useCallback(() => {
    if (!selectedPaneId) return;
    handleOpenPaneHere(selectedPaneId);
  }, [handleOpenPaneHere, selectedPaneId]);

  const handleFilterChange = useCallback(
    (value: string) => {
      const nextFilter = isSessionListFilter(value) ? value : DEFAULT_SESSION_LIST_FILTER;
      if (nextFilter === filter) return;
      void navigate({
        search: (prev) => ({
          ...prev,
          filter: nextFilter,
        }),
        replace: true,
      });
    },
    [filter, navigate],
  );

  const handleSearchQueryChange = useCallback(
    (value: string) => {
      const nextQuery = normalizeSessionListSearchQuery(value);
      if (nextQuery === searchQuery) return;
      void navigate({
        search: (prev) => ({
          ...prev,
          q: hasSessionListSearchTerms(nextQuery) ? nextQuery : undefined,
        }),
        replace: true,
      });
    },
    [navigate, searchQuery],
  );

  const handleRefresh = useCallback(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const handleOpenChatGrid = useCallback(() => {
    closeQuickPanel();
    closeLogModal();
    void navigate({ to: "/chat-grid" });
  }, [closeLogModal, closeQuickPanel, navigate]);

  const handleOpenUsage = useCallback(() => {
    closeQuickPanel();
    closeLogModal();
    void navigate({ to: "/usage" });
  }, [closeLogModal, closeQuickPanel, navigate]);

  const handleLaunchAgentInSession = useCallback(
    async (sessionName: string, agent: "codex" | "claude", options?: LaunchAgentRequestOptions) => {
      const key = sessionName;
      if (launchPendingRef.current.has(key)) {
        return;
      }
      launchPendingRef.current.add(key);
      setLaunchPendingSessions(new Set(launchPendingRef.current));

      try {
        const result = await launchAgentInSession(
          sessionName,
          agent,
          createLaunchRequestId(),
          options,
        );
        if (!result.ok) {
          setScreenError(result.error?.message ?? API_ERROR_MESSAGES.launchAgent);
          return;
        }
        await refreshSessions();
        setScreenError(null);
      } catch (error) {
        setScreenError(resolveUnknownErrorMessage(error, API_ERROR_MESSAGES.launchAgent));
      } finally {
        launchPendingRef.current.delete(key);
        setLaunchPendingSessions(new Set(launchPendingRef.current));
      }
    },
    [launchAgentInSession, launchPendingRef, refreshSessions],
  );

  return {
    sessions,
    groups,
    sidebarSessionGroups,
    visibleSessionCount: visibleSessions.length,
    quickPanelGroups,
    filter,
    searchQuery,
    filterOptions: FILTER_OPTIONS,
    connected,
    hasLoadedInitialSessions,
    connectionStatus,
    connectionIssue,
    transport,
    requestStateTimeline,
    requestScreen,
    requestWorktrees,
    highlightCorrections,
    launchConfig,
    capabilities,
    resolvedTheme,
    nowMs,
    sidebarWidth,
    onFilterChange: handleFilterChange,
    onSearchQueryChange: handleSearchQueryChange,
    onRefresh: handleRefresh,
    onOpenChatGrid: handleOpenChatGrid,
    onOpenUsage: handleOpenUsage,
    onSidebarResizeStart: handlePointerDown,
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
    onOpenHere: handleOpenHere,
    onOpenNewTab: handleOpenInNewTab,
    screenError,
    launchPendingSessions,
    onLaunchAgentInSession: handleLaunchAgentInSession,
    onTouchRepoPin: touchRepoPin,
    onTouchPanePin: touchPanePin,
  };
};

export type SessionListVM = ReturnType<typeof useSessionListVM>;
