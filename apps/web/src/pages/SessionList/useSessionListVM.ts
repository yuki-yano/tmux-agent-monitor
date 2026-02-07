import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { buildSessionGroups } from "@/lib/session-group";
import { useNowMs } from "@/lib/use-now-ms";
import { useSidebarWidth } from "@/lib/use-sidebar-width";
import { useSessions } from "@/state/session-context";
import { useTheme } from "@/state/theme-context";

import { useSessionLogs } from "../SessionDetail/hooks/useSessionLogs";
import {
  DEFAULT_SESSION_LIST_FILTER,
  isSessionListFilter,
  SESSION_LIST_FILTER_VALUES,
  storeSessionListFilter,
} from "./sessionListFilters";

const FILTER_OPTIONS = SESSION_LIST_FILTER_VALUES.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

export const useSessionListVM = () => {
  const {
    sessions,
    connected,
    connectionStatus,
    connectionIssue,
    refreshSessions,
    requestScreen,
    highlightCorrections,
  } = useSessions();
  const nowMs = useNowMs();
  const search = useSearch({ from: "/" });
  const filter = isSessionListFilter(search.filter) ? search.filter : DEFAULT_SESSION_LIST_FILTER;
  const navigate = useNavigate({ from: "/" });
  const { resolvedTheme } = useTheme();
  const { sidebarWidth, handlePointerDown } = useSidebarWidth();

  useEffect(() => {
    storeSessionListFilter(filter);
  }, [filter]);

  const visibleSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (filter === "ALL") return true;
      if (filter === "AGENT") {
        return session.state !== "SHELL" && session.state !== "UNKNOWN";
      }
      return session.state === filter;
    });
  }, [filter, sessions]);

  const groups = useMemo(() => buildSessionGroups(visibleSessions), [visibleSessions]);
  const quickPanelGroups = useMemo(() => buildSessionGroups(visibleSessions), [visibleSessions]);

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

  const handleOpenInNewTab = useCallback(() => {
    if (!selectedPaneId) return;
    const encoded = encodeURIComponent(selectedPaneId);
    window.open(`/sessions/${encoded}`, "_blank", "noopener,noreferrer");
  }, [selectedPaneId]);

  const handleOpenPaneHere = useCallback(
    (targetPaneId: string) => {
      closeQuickPanel();
      navigate({ to: "/sessions/$paneId", params: { paneId: targetPaneId } });
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
        search: { filter: nextFilter },
        replace: true,
      });
    },
    [filter, navigate],
  );

  const handleRefresh = useCallback(() => {
    refreshSessions();
  }, [refreshSessions]);

  return {
    sessions,
    groups,
    visibleSessionCount: visibleSessions.length,
    quickPanelGroups,
    filter,
    filterOptions: FILTER_OPTIONS,
    connectionStatus,
    connectionIssue,
    nowMs,
    sidebarWidth,
    onFilterChange: handleFilterChange,
    onRefresh: handleRefresh,
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
    onOpenHere: handleOpenHere,
    onOpenNewTab: handleOpenInNewTab,
  };
};

export type SessionListVM = ReturnType<typeof useSessionListVM>;
