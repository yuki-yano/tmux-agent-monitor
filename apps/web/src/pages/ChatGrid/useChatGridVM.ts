import { useNavigate, useSearch } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createLaunchRequestId } from "@/lib/request-id";

import { useMultiPaneScreenFeed } from "@/features/shared-session-ui/hooks/useMultiPaneScreenFeed";
import { useSessionListPins } from "@/features/shared-session-ui/hooks/useSessionListPins";
import { DEFAULT_SESSION_LIST_FILTER } from "@/features/shared-session-ui/model/session-list-filters";
import { renderAnsiLines } from "@/lib/ansi";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { SCREEN_POLL_INTERVAL_MS } from "@/lib/screen-polling";
import { isKnownAgent } from "@/lib/session-format";
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

import { normalizeChatGridPaneParam, serializeChatGridPaneParam } from "./chatGridSearch";
import { buildChatGridCandidates } from "./model/chat-grid-candidates";
import {
  CHAT_GRID_MAX_PANE_COUNT,
  CHAT_GRID_MIN_PANE_COUNT,
  resolveChatGridLayout,
} from "./model/chat-grid-layout";

export const useChatGridVM = () => {
  const { sessions, connected, connectionStatus, connectionIssue, transport } =
    useSessionStreamData();
  const { launchConfig, highlightCorrections, capabilities } = useSessionConfigData();
  const { requestStateTimeline, requestScreen, touchSession, moveSessionToTop, refreshSessions } =
    useSessionCoreApi();
  const { requestWorktrees } = useSessionBranchesApi();
  const { launchAgentInSession } = useSessionLaunchApi();
  const { resolvedTheme } = useTheme();
  const nowMs = useNowMs();
  const search = useSearch({ from: "/chat-grid" });
  const navigate = useNavigate({ from: "/chat-grid" });
  const { sidebarWidth, handlePointerDown } = useSidebarWidth();
  const { getRepoSortAnchorAt, touchRepoPin, touchPanePin } = useSessionListPins({
    onTouchPane: moveSessionToTop,
  });

  const [candidateModalOpen, setCandidateModalOpen] = useState(false);
  const [candidateSelection, setCandidateSelection] = useState<string[]>([]);
  const paneIdsFromSearch = useMemo(() => normalizeChatGridPaneParam(search.panes), [search.panes]);
  const [hasResolvedGridSelection, setHasResolvedGridSelection] = useState(
    () => sessions.length > 0 || connected || connectionStatus === "disconnected",
  );

  const gridSelectionResolved =
    sessions.length > 0 || connected || connectionStatus === "disconnected";
  if (!hasResolvedGridSelection && gridSelectionResolved) {
    setHasResolvedGridSelection(true);
  }
  const effectiveHasResolvedGridSelection = hasResolvedGridSelection || gridSelectionResolved;

  const candidateItems = useMemo(
    () =>
      buildChatGridCandidates({
        sessions,
        getRepoSortAnchorAt,
      }),
    [getRepoSortAnchorAt, sessions],
  );
  const candidatePaneIdSet = useMemo(
    () => new Set(candidateItems.map((session) => session.paneId)),
    [candidateItems],
  );
  const selectedCandidatePaneIds = useMemo(
    () => candidateSelection.filter((paneId) => candidatePaneIdSet.has(paneId)),
    [candidatePaneIdSet, candidateSelection],
  );
  if (selectedCandidatePaneIds.length !== candidateSelection.length) {
    setCandidateSelection(selectedCandidatePaneIds);
  }

  const sessionByPaneId = useMemo(
    () => new Map(sessions.map((session) => [session.paneId, session] as const)),
    [sessions],
  );

  const selectedPaneIds = useMemo(
    () => paneIdsFromSearch.filter((paneId) => sessionByPaneId.has(paneId)),
    [paneIdsFromSearch, sessionByPaneId],
  );
  const selectedSessions = useMemo(
    () =>
      selectedPaneIds
        .map((paneId) => sessionByPaneId.get(paneId) ?? null)
        .filter((session): session is SessionSummary => session != null),
    [selectedPaneIds, sessionByPaneId],
  );
  const currentGridCandidatePaneIds = useMemo(() => {
    const candidatePaneIdSet = new Set(candidateItems.map((session) => session.paneId));
    return selectedPaneIds
      .filter((paneId) => candidatePaneIdSet.has(paneId))
      .slice(0, CHAT_GRID_MAX_PANE_COUNT);
  }, [candidateItems, selectedPaneIds]);
  const sidebarSessionGroups = useMemo(
    () => buildSessionGroups(sessions, { getRepoSortAnchorAt }),
    [getRepoSortAnchorAt, sessions],
  );
  const retainedPaneIds = useMemo(() => sessions.map((session) => session.paneId), [sessions]);
  const canPollScreens = useCallback(
    () => connectionIssue !== API_ERROR_MESSAGES.unauthorized,
    [connectionIssue],
  );
  const { cache, loading, error, fetchPane } = useMultiPaneScreenFeed({
    paneIds: selectedPaneIds,
    retainedPaneIds,
    enabled: selectedPaneIds.length > 0,
    connected,
    connectionIssue,
    requestScreen,
    intervalMs: SCREEN_POLL_INTERVAL_MS.text,
    concurrency: 3,
    lines: 160,
    ttlMs: 800,
    cacheKey: "chat-grid",
    errorMessages: {
      load: API_ERROR_MESSAGES.screenCapture,
      requestFailed: API_ERROR_MESSAGES.screenRequestFailed,
    },
    shouldPoll: canPollScreens,
  });

  const screenByPane = useMemo(() => {
    return selectedSessions.reduce<Record<string, string[]>>((acc, session) => {
      const cached = cache[session.paneId];
      if (!cached) {
        acc[session.paneId] = [];
        return acc;
      }
      const rendered = renderAnsiLines(cached.screen, resolvedTheme, {
        agent: isKnownAgent(session.agent) ? session.agent : "unknown",
        highlightCorrections,
      });
      acc[session.paneId] = rendered;
      return acc;
    }, {});
  }, [cache, highlightCorrections, resolvedTheme, selectedSessions]);

  const boardLayout = useMemo(
    () => resolveChatGridLayout(Math.max(selectedSessions.length, CHAT_GRID_MIN_PANE_COUNT)),
    [selectedSessions.length],
  );
  const isRestoringSelection = paneIdsFromSearch.length > 0 && !effectiveHasResolvedGridSelection;

  useEffect(() => {
    if (paneIdsFromSearch.length > 0 && !effectiveHasResolvedGridSelection) {
      return;
    }
    const availablePaneParam = serializeChatGridPaneParam(selectedPaneIds);
    const currentPaneParam = serializeChatGridPaneParam(paneIdsFromSearch);
    if (availablePaneParam === currentPaneParam) {
      return;
    }

    void navigate({
      search: (prev) => ({
        ...prev,
        panes: availablePaneParam,
      }),
      replace: true,
    });
  }, [effectiveHasResolvedGridSelection, navigate, paneIdsFromSearch, selectedPaneIds]);

  const handleOpenCandidateModal = useCallback(() => {
    setCandidateSelection([]);
    setCandidateModalOpen(true);
  }, []);

  const handleCloseCandidateModal = useCallback(() => {
    setCandidateModalOpen(false);
  }, []);

  const handleToggleCandidatePane = useCallback(
    (paneId: string) => {
      setCandidateSelection((previous) => {
        const activeSelection = previous.filter((id) => candidatePaneIdSet.has(id));
        if (activeSelection.includes(paneId)) {
          return activeSelection.filter((id) => id !== paneId);
        }
        if (activeSelection.length >= CHAT_GRID_MAX_PANE_COUNT) {
          return activeSelection;
        }
        return [...activeSelection, paneId];
      });
    },
    [candidatePaneIdSet],
  );

  const handleApplyCandidates = useCallback(() => {
    const nextPaneIds = selectedCandidatePaneIds
      .filter((paneId) => candidatePaneIdSet.has(paneId))
      .slice(0, CHAT_GRID_MAX_PANE_COUNT);

    if (nextPaneIds.length < CHAT_GRID_MIN_PANE_COUNT) {
      return;
    }

    setCandidateModalOpen(false);
    void navigate({
      search: (prev) => ({
        ...prev,
        panes: serializeChatGridPaneParam(nextPaneIds),
      }),
      replace: true,
    });
    nextPaneIds.forEach((paneId) => {
      void fetchPane(paneId, { force: true, loading: "always" });
    });
  }, [candidatePaneIdSet, fetchPane, navigate, selectedCandidatePaneIds]);

  const handleRefreshAllTiles = useCallback(() => {
    if (selectedPaneIds.length === 0) {
      void refreshSessions();
      return;
    }
    selectedPaneIds.forEach((paneId) => {
      void fetchPane(paneId, { force: true, loading: "always" });
    });
  }, [fetchPane, refreshSessions, selectedPaneIds]);

  const handleBackToSessionList = useCallback(() => {
    void navigate({
      to: "/",
      search: { filter: DEFAULT_SESSION_LIST_FILTER },
    });
  }, [navigate]);

  const handleOpenPaneHere = useCallback(
    (paneId: string) => {
      void navigate({ to: "/sessions/$paneId", params: { paneId } });
    },
    [navigate],
  );
  const handleRemovePaneFromGrid = useCallback(
    (paneId: string) => {
      const nextPaneIds = selectedPaneIds.filter((id) => id !== paneId);
      void navigate({
        search: (prev) => ({
          ...prev,
          panes: serializeChatGridPaneParam(nextPaneIds),
        }),
        replace: true,
      });
    },
    [navigate, selectedPaneIds],
  );
  const handleSyncCandidateSelectionFromCurrentGrid = useCallback(() => {
    setCandidateSelection(currentGridCandidatePaneIds);
  }, [currentGridCandidatePaneIds]);

  const handleLaunchAgentInSession = useCallback(
    async (sessionName: string, agent: "codex" | "claude", options?: LaunchAgentRequestOptions) => {
      try {
        const result = await launchAgentInSession(
          sessionName,
          agent,
          createLaunchRequestId(),
          options,
        );
        if (result.ok) {
          await refreshSessions();
        }
      } catch {
        // Launch failures are surfaced by upstream transport and reconciled by next refresh.
      }
    },
    [launchAgentInSession, refreshSessions],
  );

  return {
    nowMs,
    connected,
    connectionStatus,
    connectionIssue,
    transport,
    launchConfig,
    capabilities,
    requestStateTimeline,
    requestScreen,
    requestWorktrees,
    highlightCorrections,
    resolvedTheme,
    sidebarSessionGroups,
    sidebarWidth,
    selectedCount: selectedSessions.length,
    candidateModalOpen,
    candidateItems,
    selectedCandidatePaneIds,
    selectedSessions,
    isRestoringSelection,
    boardLayout,
    screenByPane,
    screenLoadingByPane: loading,
    screenErrorByPane: error,
    onOpenCandidateModal: handleOpenCandidateModal,
    onCloseCandidateModal: handleCloseCandidateModal,
    onToggleCandidatePane: handleToggleCandidatePane,
    onApplyCandidates: handleApplyCandidates,
    onRefreshAllTiles: handleRefreshAllTiles,
    onBackToSessionList: handleBackToSessionList,
    onOpenPaneHere: handleOpenPaneHere,
    onRemovePaneFromGrid: handleRemovePaneFromGrid,
    onLaunchAgentInSession: handleLaunchAgentInSession,
    onTouchRepoPin: touchRepoPin,
    onTouchPanePin: touchPanePin,
    onTouchSessionActivity: touchSession,
    onSidebarResizeStart: handlePointerDown,
    canSyncCandidateSelectionFromCurrentGrid: currentGridCandidatePaneIds.length > 0,
    onSyncCandidateSelectionFromCurrentGrid: handleSyncCandidateSelectionFromCurrentGrid,
  };
};
