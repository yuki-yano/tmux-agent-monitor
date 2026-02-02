import type { ScreenResponse, SessionSummary } from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { renderAnsiLines } from "@/lib/ansi";
import type { Theme } from "@/lib/theme";

import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";

type LogCacheEntry = {
  screen: string;
  capturedAt: string;
  truncated?: boolean | null;
};

type UseSessionLogsParams = {
  connected: boolean;
  connectionIssue: string | null;
  sessions: SessionSummary[];
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  resolvedTheme: Theme;
};

export const useSessionLogs = ({
  connected,
  connectionIssue,
  sessions,
  requestScreen,
  resolvedTheme,
}: UseSessionLogsParams) => {
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [logCache, setLogCache] = useState<Record<string, LogCacheEntry>>({});
  const [logLoading, setLogLoading] = useState<Record<string, boolean>>({});
  const [logError, setLogError] = useState<Record<string, string | null>>({});

  const logCacheRef = useRef<Record<string, LogCacheEntry>>({});
  const logRequestIdRef = useRef(0);
  const logLatestRequestRef = useRef<Record<string, number>>({});
  const logInflightRef = useRef(new Set<string>());

  const selectedSession = useMemo(
    () =>
      selectedPaneId ? (sessions.find((item) => item.paneId === selectedPaneId) ?? null) : null,
    [selectedPaneId, sessions],
  );

  const selectedLogEntry = selectedPaneId ? (logCache[selectedPaneId] ?? null) : null;

  const selectedLogLines = useMemo(() => {
    if (!selectedLogEntry) return [];
    const text = selectedLogEntry.screen.length > 0 ? selectedLogEntry.screen : "No log data";
    const agent =
      selectedSession?.agent === "codex" || selectedSession?.agent === "claude"
        ? selectedSession.agent
        : "unknown";
    return renderAnsiLines(text, resolvedTheme, { agent });
  }, [selectedLogEntry, resolvedTheme, selectedSession?.agent]);

  const selectedLogLoading = Boolean(selectedPaneId && logLoading[selectedPaneId]);
  const selectedLogError = selectedPaneId ? (logError[selectedPaneId] ?? null) : null;

  useEffect(() => {
    logCacheRef.current = logCache;
  }, [logCache]);

  const fetchLog = useCallback(
    async (paneId: string) => {
      if (!paneId) return;
      if (!connected) {
        setLogError((prev) => ({
          ...prev,
          [paneId]: connectionIssue ?? DISCONNECTED_MESSAGE,
        }));
        return;
      }
      if (logInflightRef.current.has(paneId)) {
        return;
      }
      const hasCache = Boolean(logCacheRef.current[paneId]);
      logInflightRef.current.add(paneId);
      const requestId = (logRequestIdRef.current += 1);
      logLatestRequestRef.current[paneId] = requestId;
      if (!hasCache) {
        setLogLoading((prev) => ({ ...prev, [paneId]: true }));
      }
      setLogError((prev) => ({ ...prev, [paneId]: null }));
      try {
        const response = await requestScreen(paneId, { mode: "text" });
        if (logLatestRequestRef.current[paneId] !== requestId) {
          return;
        }
        if (!response.ok) {
          setLogError((prev) => ({
            ...prev,
            [paneId]: response.error?.message ?? "Failed to load log",
          }));
          return;
        }
        setLogCache((prev) => ({
          ...prev,
          [paneId]: {
            screen: response.screen ?? "",
            capturedAt: response.capturedAt,
            truncated: response.truncated ?? null,
          },
        }));
      } catch (err) {
        if (logLatestRequestRef.current[paneId] !== requestId) {
          return;
        }
        setLogError((prev) => ({
          ...prev,
          [paneId]: err instanceof Error ? err.message : "Log request failed",
        }));
      } finally {
        logInflightRef.current.delete(paneId);
        if (!hasCache && logLatestRequestRef.current[paneId] === requestId) {
          setLogLoading((prev) => ({ ...prev, [paneId]: false }));
        }
      }
    },
    [connected, connectionIssue, requestScreen],
  );

  useEffect(() => {
    if (!logModalOpen || !selectedPaneId) {
      return;
    }
    void fetchLog(selectedPaneId);
    const intervalMs = 2000;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void fetchLog(selectedPaneId);
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchLog, logModalOpen, selectedPaneId]);

  const openLogModal = useCallback((paneId: string) => {
    setSelectedPaneId(paneId);
    setLogModalOpen(true);
  }, []);

  const closeLogModal = useCallback(() => {
    setLogModalOpen(false);
    setSelectedPaneId(null);
  }, []);

  const toggleQuickPanel = useCallback(() => {
    setQuickPanelOpen((prev) => !prev);
  }, []);

  const closeQuickPanel = useCallback(() => {
    setQuickPanelOpen(false);
    setLogModalOpen(false);
    setSelectedPaneId(null);
  }, []);

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
