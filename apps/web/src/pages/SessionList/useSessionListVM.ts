import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildSessionGroups } from "@/lib/session-group";
import { useNowMs } from "@/lib/use-now-ms";
import { useSidebarWidth } from "@/lib/use-sidebar-width";
import { useSessions } from "@/state/session-context";
import { useTheme } from "@/state/theme-context";

import { useSessionLogs } from "../SessionDetail/hooks/useSessionLogs";
import {
  DEFAULT_SESSION_LIST_FILTER,
  isSessionListFilter,
  matchesSessionListFilter,
  SESSION_LIST_FILTER_VALUES,
  storeSessionListFilter,
} from "./sessionListFilters";
import {
  createRepoPinKey,
  createSessionWindowPinKey,
  readStoredSessionListPins,
  storeSessionListPins,
  toggleSessionListPin,
} from "./sessionListPins";

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
  const [pins, setPins] = useState(() => readStoredSessionListPins());
  const pinnedRepoKeys = useMemo(() => new Set(pins.repos), [pins.repos]);
  const pinnedWindowKeys = useMemo(() => new Set(pins.windows), [pins.windows]);
  const pinnedPaneIds = useMemo(() => new Set(pins.panes), [pins.panes]);

  useEffect(() => {
    storeSessionListFilter(filter);
  }, [filter]);

  useEffect(() => {
    storeSessionListPins(pins);
  }, [pins]);

  const isRepoPinned = useCallback(
    (repoRoot: string | null) => pinnedRepoKeys.has(createRepoPinKey(repoRoot)),
    [pinnedRepoKeys],
  );

  const visibleSessions = useMemo(() => {
    return sessions.filter((session) => matchesSessionListFilter(session, filter));
  }, [filter, sessions]);

  const groups = useMemo(
    () => buildSessionGroups(visibleSessions, { isRepoPinned }),
    [isRepoPinned, visibleSessions],
  );
  const sidebarSessionGroups = useMemo(
    () => buildSessionGroups(sessions, { isRepoPinned }),
    [isRepoPinned, sessions],
  );
  const quickPanelGroups = useMemo(
    () => buildSessionGroups(visibleSessions, { isRepoPinned }),
    [isRepoPinned, visibleSessions],
  );

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

  const handleToggleRepoPin = useCallback((repoRoot: string | null) => {
    const key = createRepoPinKey(repoRoot);
    setPins((prev) => toggleSessionListPin(prev, "repos", key));
  }, []);

  const handleToggleWindowPin = useCallback((sessionName: string, windowIndex: number) => {
    const key = createSessionWindowPinKey(sessionName, windowIndex);
    setPins((prev) => toggleSessionListPin(prev, "windows", key));
  }, []);

  const handleTogglePanePin = useCallback((paneId: string) => {
    setPins((prev) => toggleSessionListPin(prev, "panes", paneId));
  }, []);

  const isWindowPinned = useCallback(
    (sessionName: string, windowIndex: number) =>
      pinnedWindowKeys.has(createSessionWindowPinKey(sessionName, windowIndex)),
    [pinnedWindowKeys],
  );

  const isPanePinned = useCallback((paneId: string) => pinnedPaneIds.has(paneId), [pinnedPaneIds]);

  return {
    sessions,
    groups,
    sidebarSessionGroups,
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
    isRepoPinned,
    isWindowPinned,
    isPanePinned,
    onToggleRepoPin: handleToggleRepoPin,
    onToggleWindowPin: handleToggleWindowPin,
    onTogglePanePin: handleTogglePanePin,
  };
};

export type SessionListVM = ReturnType<typeof useSessionListVM>;
