import { useNavigate } from "@tanstack/react-router";
import type { SessionStateValue } from "@vde-monitor/shared";
import { useCallback, useMemo, useState } from "react";

import { buildSessionGroups } from "@/lib/session-group";
import { useNowMs } from "@/lib/use-now-ms";
import { useSidebarWidth } from "@/lib/use-sidebar-width";
import { useSessions } from "@/state/session-context";
import { useTheme } from "@/state/theme-context";

import { useSessionLogs } from "../SessionDetail/hooks/useSessionLogs";

type SessionListFilter = "ALL" | "AGENT" | "SHELL" | "UNKNOWN";

const FILTER_VALUES: SessionListFilter[] = ["ALL", "AGENT", "SHELL", "UNKNOWN"];

const FILTER_OPTIONS = FILTER_VALUES.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

const STATUS_ORDER: SessionStateValue[] = [
  "RUNNING",
  "WAITING_INPUT",
  "WAITING_PERMISSION",
  "SHELL",
  "UNKNOWN",
];

export const useSessionListVM = () => {
  const {
    sessions,
    connected,
    connectionIssue,
    readOnly,
    reconnect,
    refreshSessions,
    requestScreen,
    highlightCorrections,
  } = useSessions();
  const [filter, setFilter] = useState<SessionListFilter>("AGENT");
  const nowMs = useNowMs();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { sidebarWidth, handlePointerDown } = useSidebarWidth();

  const visibleSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (filter === "ALL") return true;
      if (filter === "AGENT") {
        return session.state !== "SHELL" && session.state !== "UNKNOWN";
      }
      return session.state === filter;
    });
  }, [filter, sessions]);

  const statusSections = useMemo(() => {
    const buckets = new Map<SessionStateValue, typeof visibleSessions>();
    STATUS_ORDER.forEach((state) => {
      buckets.set(state, []);
    });
    visibleSessions.forEach((session) => {
      const bucket = buckets.get(session.state);
      if (bucket) {
        bucket.push(session);
      }
    });
    return STATUS_ORDER.map((state) => {
      const sessionsForState = buckets.get(state) ?? [];
      return {
        state,
        count: sessionsForState.length,
        groups: buildSessionGroups(sessionsForState),
      };
    }).filter((section) => section.count > 0);
  }, [visibleSessions]);

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

  const handleOpenHere = useCallback(() => {
    if (!selectedPaneId) return;
    closeQuickPanel();
    navigate({ to: "/sessions/$paneId", params: { paneId: selectedPaneId } });
    closeLogModal();
  }, [closeLogModal, closeQuickPanel, navigate, selectedPaneId]);

  const handleFilterChange = useCallback((value: string) => {
    setFilter(value as SessionListFilter);
  }, []);

  const handleRefresh = useCallback(() => {
    refreshSessions();
  }, [refreshSessions]);

  const handleReconnect = useCallback(() => {
    reconnect();
  }, [reconnect]);

  return {
    sessions,
    statusSections,
    visibleSessionCount: visibleSessions.length,
    quickPanelGroups,
    filter,
    filterOptions: FILTER_OPTIONS,
    connected,
    connectionIssue,
    readOnly,
    nowMs,
    sidebarWidth,
    onFilterChange: handleFilterChange,
    onRefresh: handleRefresh,
    onReconnect: handleReconnect,
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
    onOpenHere: handleOpenHere,
    onOpenNewTab: handleOpenInNewTab,
  };
};

export type SessionListVM = ReturnType<typeof useSessionListVM>;
