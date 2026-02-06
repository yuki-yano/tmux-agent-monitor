import type {
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionSummary,
} from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import { renderAnsiLines } from "@/lib/ansi";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import type { Theme } from "@/lib/theme";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { logModalOpenAtom, quickPanelOpenAtom, selectedPaneIdAtom } from "../atoms/logAtoms";
import { useScreenCache } from "./useScreenCache";

type UseSessionLogsParams = {
  connected: boolean;
  connectionIssue: string | null;
  sessions: SessionSummary[];
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  resolvedTheme: Theme;
  highlightCorrections?: HighlightCorrectionConfig;
};

const findSessionByPaneId = (sessions: SessionSummary[], paneId: string | null) => {
  if (!paneId) {
    return null;
  }
  return sessions.find((item) => item.paneId === paneId) ?? null;
};

const pickCacheEntryByPaneId = <T>(cache: Record<string, T>, paneId: string | null) => {
  if (!paneId) {
    return null;
  }
  return cache[paneId] ?? null;
};

const isPaneLoading = (paneId: string | null, loading: Record<string, boolean>) =>
  Boolean(paneId && loading[paneId]);

const pickPaneError = (paneId: string | null, errors: Record<string, string | null>) => {
  if (!paneId) {
    return null;
  }
  return errors[paneId] ?? null;
};

export const useSessionLogs = ({
  connected,
  connectionIssue,
  sessions,
  requestScreen,
  resolvedTheme,
  highlightCorrections,
}: UseSessionLogsParams) => {
  const [quickPanelOpen, setQuickPanelOpen] = useAtom(quickPanelOpenAtom);
  const [logModalOpen, setLogModalOpen] = useAtom(logModalOpenAtom);
  const [selectedPaneId, setSelectedPaneId] = useAtom(selectedPaneIdAtom);
  const {
    cache: logCache,
    loading: logLoading,
    error: logError,
    fetchScreen,
    clearCache,
  } = useScreenCache({
    connected,
    connectionIssue,
    requestScreen,
    cacheKey: "logs",
    errorMessages: {
      load: API_ERROR_MESSAGES.logLoad,
      requestFailed: API_ERROR_MESSAGES.logRequestFailed,
    },
  });

  const selectedSession = useMemo(
    () => findSessionByPaneId(sessions, selectedPaneId),
    [selectedPaneId, sessions],
  );

  const selectedLogEntry = pickCacheEntryByPaneId(logCache, selectedPaneId);

  const selectedLogLines = useMemo(() => {
    if (!selectedLogEntry) return [];
    const text = selectedLogEntry.screen.length > 0 ? selectedLogEntry.screen : "No log data";
    const agent =
      selectedSession?.agent === "codex" || selectedSession?.agent === "claude"
        ? selectedSession.agent
        : "unknown";
    return renderAnsiLines(text, resolvedTheme, { agent, highlightCorrections });
  }, [selectedLogEntry, resolvedTheme, selectedSession?.agent, highlightCorrections]);

  const selectedLogLoading = isPaneLoading(selectedPaneId, logLoading);
  const selectedLogError = pickPaneError(selectedPaneId, logError);

  const fetchLog = useCallback(
    async (paneId: string) => {
      await fetchScreen(paneId, { loading: "if-empty" });
    },
    [fetchScreen],
  );
  const canPollLogs = useCallback(
    () => connectionIssue !== API_ERROR_MESSAGES.unauthorized,
    [connectionIssue],
  );
  const refreshSelectedLog = useCallback(() => {
    if (!selectedPaneId) return;
    void fetchLog(selectedPaneId);
  }, [fetchLog, selectedPaneId]);

  useEffect(() => {
    if (!logModalOpen || !selectedPaneId) {
      return;
    }
    void fetchLog(selectedPaneId);
  }, [fetchLog, logModalOpen, selectedPaneId]);

  useVisibilityPolling({
    enabled: logModalOpen && Boolean(selectedPaneId),
    intervalMs: 2000,
    shouldPoll: canPollLogs,
    onTick: refreshSelectedLog,
    onResume: refreshSelectedLog,
  });

  useEffect(() => {
    if (Object.keys(logCache).length === 0) return;
    const activePaneIds = new Set(sessions.map((session) => session.paneId));
    Object.keys(logCache).forEach((paneId) => {
      if (!activePaneIds.has(paneId)) {
        clearCache(paneId);
      }
    });
  }, [clearCache, logCache, sessions]);

  const openLogModal = useCallback(
    (paneId: string) => {
      setSelectedPaneId(paneId);
      setLogModalOpen(true);
    },
    [setLogModalOpen, setSelectedPaneId],
  );

  const closeLogModal = useCallback(() => {
    setLogModalOpen(false);
    setSelectedPaneId(null);
  }, [setLogModalOpen, setSelectedPaneId]);

  const toggleQuickPanel = useCallback(() => {
    setQuickPanelOpen((prev) => {
      const next = !prev;
      if (!next) {
        setLogModalOpen(false);
        setSelectedPaneId(null);
      }
      return next;
    });
  }, [setLogModalOpen, setQuickPanelOpen, setSelectedPaneId]);

  const closeQuickPanel = useCallback(() => {
    setQuickPanelOpen(false);
    setLogModalOpen(false);
    setSelectedPaneId(null);
  }, [setLogModalOpen, setQuickPanelOpen, setSelectedPaneId]);

  useEffect(() => {
    if (!quickPanelOpen && !logModalOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (logModalOpen) {
        closeLogModal();
        return;
      }
      closeQuickPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeLogModal, closeQuickPanel, logModalOpen, quickPanelOpen]);

  return {
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
  };
};
