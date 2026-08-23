import type {
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionSummary,
} from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import {
  logModalOpenAtom,
  logModalSnapRequestAtom,
  quickPanelOpenAtom,
  selectedPaneIdAtom,
} from "@/features/shared-session-ui/atoms/logAtoms";
import { useMultiPaneScreenFeed } from "@/features/shared-session-ui/hooks/useMultiPaneScreenFeed";
import { renderAnsiLines } from "@/lib/ansi";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import type { Theme } from "@/lib/theme";

import { linkifyLogLineHttpUrls } from "../lib/log-file-reference";

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
  const [, setLogModalSnapRequest] = useAtom(logModalSnapRequestAtom);
  const [selectedPaneId, setSelectedPaneId] = useAtom(selectedPaneIdAtom);
  const feedPaneIds = useMemo(() => {
    if (!logModalOpen || !selectedPaneId) {
      return [];
    }
    return [selectedPaneId];
  }, [logModalOpen, selectedPaneId]);
  const retainedPaneIds = useMemo(() => sessions.map((session) => session.paneId), [sessions]);
  const canPollLogs = useCallback(
    () => connectionIssue !== API_ERROR_MESSAGES.unauthorized,
    [connectionIssue],
  );

  const {
    cache: logCache,
    loading: logLoading,
    error: logError,
    fetchPane,
  } = useMultiPaneScreenFeed({
    paneIds: feedPaneIds,
    retainedPaneIds,
    enabled: logModalOpen,
    intervalMs: 2000,
    concurrency: 1,
    connected,
    connectionIssue,
    requestScreen,
    cacheKey: "logs",
    fetchOnMount: false,
    errorMessages: {
      load: API_ERROR_MESSAGES.logLoad,
      requestFailed: API_ERROR_MESSAGES.logRequestFailed,
    },
    shouldPoll: canPollLogs,
  });

  const selectedSession = useMemo(
    () => findSessionByPaneId(sessions, selectedPaneId),
    [selectedPaneId, sessions],
  );

  const selectedLogEntry = pickCacheEntryByPaneId(logCache, selectedPaneId);
  const selectedLogAgent =
    selectedSession?.agent === "codex" || selectedSession?.agent === "claude"
      ? selectedSession.agent
      : "unknown";

  const selectedLogLines = useMemo(() => {
    if (!selectedLogEntry) return [];
    const text = selectedLogEntry.screen.length > 0 ? selectedLogEntry.screen : "No log data";
    const renderedLines = renderAnsiLines(text, resolvedTheme, {
      agent: selectedLogAgent,
      highlightCorrections,
    });
    if (renderedLines.every((line) => !line.includes("http://") && !line.includes("https://"))) {
      return renderedLines;
    }
    return renderedLines.map((line) =>
      line.includes("http://") || line.includes("https://") ? linkifyLogLineHttpUrls(line) : line,
    );
  }, [selectedLogEntry, resolvedTheme, selectedLogAgent, highlightCorrections]);

  const selectedLogLoading = isPaneLoading(selectedPaneId, logLoading);
  const selectedLogError = pickPaneError(selectedPaneId, logError);

  const fetchLog = useCallback(
    async (paneId: string) => {
      await fetchPane(paneId, { loading: "always" });
    },
    [fetchPane],
  );

  useEffect(() => {
    if (!logModalOpen || !selectedPaneId) {
      return;
    }
    void fetchLog(selectedPaneId);
  }, [fetchLog, logModalOpen, selectedPaneId]);

  const openLogModal = useCallback(
    (paneId: string) => {
      setSelectedPaneId(paneId);
      setLogModalSnapRequest((request) => ({ paneId, version: request.version + 1 }));
      setLogModalOpen(true);
    },
    [setLogModalOpen, setLogModalSnapRequest, setSelectedPaneId],
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
