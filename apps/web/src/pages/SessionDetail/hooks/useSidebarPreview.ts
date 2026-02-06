import type {
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionSummary,
} from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { renderAnsiLines } from "@/lib/ansi";
import type { Theme } from "@/lib/theme";

import {
  type PreviewFrame,
  sidebarHoveredPaneIdAtom,
  sidebarPreviewFrameAtom,
} from "../atoms/sidebarPreviewAtoms";
import { useSessionPreview } from "./useSessionPreview";

type SidebarPreview = {
  paneId: string;
  sessionName: string | null;
  windowIndex: number | null;
  frame: PreviewFrame;
  title: string;
  lines: string[];
  loading: boolean;
  error: string | null;
};

type UseSidebarPreviewParams = {
  sessionIndex: Map<string, SessionSummary>;
  currentPaneId?: string | null;
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  resolvedTheme: Theme;
  highlightCorrections?: HighlightCorrectionConfig;
};

const PREVIEW_MIN_WIDTH = 640;
const PREVIEW_MAX_WIDTH = 1200;
const PREVIEW_MIN_HEIGHT = 420;
const PREVIEW_MAX_HEIGHT = 760;
const PREVIEW_MARGIN = 16;
const PREVIEW_HEADER_OFFSET = 120;
const PREVIEW_LINE_HEIGHT = 16;
const HOVER_PREVIEW_DELAY_MS = 320;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type PreviewCacheMap = Partial<Record<string, { screen: string }>>;
type PreviewLoadingMap = Partial<Record<string, boolean>>;
type PreviewErrorMap = Partial<Record<string, string | null>>;

type HoveredPaneData = {
  session: SessionSummary | null;
  previewEntry: { screen: string } | null;
  previewText: string;
  loading: boolean;
  error: string | null;
};

const resolveHoveredPaneData = ({
  hoveredPaneId,
  sessionIndex,
  previewCache,
  previewLoading,
  previewError,
}: {
  hoveredPaneId: string | null;
  sessionIndex: Map<string, SessionSummary>;
  previewCache: PreviewCacheMap;
  previewLoading: PreviewLoadingMap;
  previewError: PreviewErrorMap;
}): HoveredPaneData => {
  if (!hoveredPaneId) {
    return {
      session: null,
      previewEntry: null,
      previewText: "",
      loading: false,
      error: null,
    };
  }

  const previewEntry = previewCache[hoveredPaneId] ?? null;
  return {
    session: sessionIndex.get(hoveredPaneId) ?? null,
    previewEntry,
    previewText: previewEntry?.screen ?? "",
    loading: Boolean(previewLoading[hoveredPaneId]),
    error: previewError[hoveredPaneId] ?? null,
  };
};

const resolvePreviewAgent = (session: SessionSummary | null): "codex" | "claude" | "unknown" => {
  if (session?.agent === "codex" || session?.agent === "claude") {
    return session.agent;
  }
  return "unknown";
};

const buildPreviewLines = ({
  hoveredPaneId,
  previewEntry,
  previewText,
  session,
  resolvedTheme,
  highlightCorrections,
}: {
  hoveredPaneId: string | null;
  previewEntry: { screen: string } | null;
  previewText: string;
  session: SessionSummary | null;
  resolvedTheme: Theme;
  highlightCorrections: HighlightCorrectionConfig | undefined;
}) => {
  if (!hoveredPaneId || !previewEntry) return [];
  const text = previewText.length > 0 ? previewText : "No log data";
  return renderAnsiLines(text, resolvedTheme, {
    agent: resolvePreviewAgent(session),
    highlightCorrections,
  });
};

const selectVisibleLines = (previewFrame: PreviewFrame | null, lines: string[]) => {
  if (!previewFrame || lines.length === 0) return [];
  return lines.slice(-previewFrame.lines);
};

const resolvePreviewTitle = (session: SessionSummary | null) => {
  if (session?.customTitle) return session.customTitle;
  if (session?.title) return session.title;
  if (session?.sessionName) return session.sessionName;
  return "Session";
};

const resolvePreviewSessionMeta = (session: SessionSummary | null) => {
  if (!session) {
    return {
      title: "Session",
      sessionName: null,
      windowIndex: null,
    };
  }
  return {
    title: resolvePreviewTitle(session),
    sessionName: session.sessionName,
    windowIndex: session.windowIndex,
  };
};

const buildSidebarPreview = ({
  hoveredPaneId,
  previewFrame,
  title,
  sessionName,
  windowIndex,
  lines,
  loading,
  error,
}: {
  hoveredPaneId: string | null;
  previewFrame: PreviewFrame | null;
  title: string;
  sessionName: string | null;
  windowIndex: number | null;
  lines: string[];
  loading: boolean;
  error: string | null;
}): SidebarPreview | null => {
  if (!hoveredPaneId || !previewFrame) return null;
  return {
    paneId: hoveredPaneId,
    sessionName,
    windowIndex,
    frame: previewFrame,
    title,
    lines,
    loading,
    error,
  };
};

export const useSidebarPreview = ({
  sessionIndex,
  currentPaneId,
  connected,
  connectionIssue,
  requestScreen,
  resolvedTheme,
  highlightCorrections,
}: UseSidebarPreviewParams) => {
  const { previewCache, previewLoading, previewError, prefetchPreview, clearPreviewCache } =
    useSessionPreview({
      connected,
      connectionIssue,
      requestScreen,
    });
  const [hoveredPaneId, setHoveredPaneId] = useAtom(sidebarHoveredPaneIdAtom);
  const [previewFrame, setPreviewFrame] = useAtom(sidebarPreviewFrameAtom);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const hoverTimerRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingPreviewPaneRef = useRef<string | null>(null);
  const hoveredPaneData = resolveHoveredPaneData({
    hoveredPaneId,
    sessionIndex,
    previewCache,
    previewLoading,
    previewError,
  });
  const hoveredSession = hoveredPaneData.session;
  const hoveredPreviewEntry = hoveredPaneData.previewEntry;
  const hoveredPreviewText = hoveredPaneData.previewText;
  const hoveredPreviewLoading = hoveredPaneData.loading;
  const hoveredPreviewError = hoveredPaneData.error;
  const hoveredPreviewLines = useMemo(() => {
    return buildPreviewLines({
      hoveredPaneId,
      previewEntry: hoveredPreviewEntry,
      previewText: hoveredPreviewText,
      session: hoveredSession,
      resolvedTheme,
      highlightCorrections,
    });
  }, [
    highlightCorrections,
    hoveredPaneId,
    hoveredPreviewEntry,
    hoveredPreviewText,
    hoveredSession,
    resolvedTheme,
  ]);

  const updatePreviewPosition = useCallback(
    (paneId: string) => {
      const node = itemRefs.current.get(paneId);
      if (!node || typeof window === "undefined") return;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxWidth = Math.min(PREVIEW_MAX_WIDTH, viewportWidth - 48);
      const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, viewportHeight - 120);
      const width = clamp(Math.round(viewportWidth * 0.56), PREVIEW_MIN_WIDTH, maxWidth);
      const height = clamp(Math.round(viewportHeight * 0.68), PREVIEW_MIN_HEIGHT, maxHeight);
      const bodyHeight = Math.max(
        height - PREVIEW_HEADER_OFFSET,
        PREVIEW_MIN_HEIGHT - PREVIEW_HEADER_OFFSET,
      );
      const lines = Math.max(20, Math.floor(bodyHeight / PREVIEW_LINE_HEIGHT) - 1);

      let left = rect.right + PREVIEW_MARGIN;
      const maxLeft = viewportWidth - width - 24;
      if (left > maxLeft) {
        left = Math.max(24, maxLeft);
      }
      let top = rect.top + rect.height / 2;
      const minTop = height / 2 + 24;
      const maxTop = viewportHeight - height / 2 - 24;
      top = Math.min(Math.max(top, minTop), maxTop);
      setPreviewFrame({ left, top, width, height, lines });
    },
    [setPreviewFrame],
  );

  const schedulePreviewPosition = useCallback(
    (paneId: string) => {
      if (!paneId || typeof window === "undefined") return;
      pendingPreviewPaneRef.current = paneId;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const target = pendingPreviewPaneRef.current;
        if (target) {
          updatePreviewPosition(target);
        }
      });
    },
    [updatePreviewPosition],
  );

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    pendingHoverRef.current = null;
  }, []);

  const clearHoverState = useCallback(
    (paneId: string) => {
      if (pendingHoverRef.current === paneId) {
        clearHoverTimer();
      }
      setHoveredPaneId((prev) => {
        if (prev !== paneId) return prev;
        setPreviewFrame(null);
        return null;
      });
    },
    [clearHoverTimer, setHoveredPaneId, setPreviewFrame],
  );

  const registerItemRef = useCallback((paneId: string, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(paneId, node);
    } else {
      itemRefs.current.delete(paneId);
    }
  }, []);

  const handleHoverStart = useCallback(
    (paneId: string) => {
      if (paneId === currentPaneId) return;
      void prefetchPreview(paneId);
      clearHoverTimer();
      pendingHoverRef.current = paneId;
      hoverTimerRef.current = window.setTimeout(() => {
        if (pendingHoverRef.current !== paneId) return;
        setHoveredPaneId(paneId);
        clearHoverTimer();
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [clearHoverTimer, currentPaneId, prefetchPreview, setHoveredPaneId],
  );

  const handleHoverEnd = useCallback(
    (paneId: string) => {
      clearHoverState(paneId);
    },
    [clearHoverState],
  );

  const handleFocus = useCallback(
    (paneId: string) => {
      if (paneId === currentPaneId) return;
      clearHoverTimer();
      setHoveredPaneId(paneId);
      void prefetchPreview(paneId);
    },
    [clearHoverTimer, currentPaneId, prefetchPreview, setHoveredPaneId],
  );

  const handleBlur = useCallback(
    (paneId: string) => {
      clearHoverState(paneId);
    },
    [clearHoverState],
  );

  const handleSelect = useCallback(() => {
    clearHoverTimer();
    setHoveredPaneId(null);
    setPreviewFrame(null);
  }, [clearHoverTimer, setHoveredPaneId, setPreviewFrame]);

  useEffect(() => {
    if (!hoveredPaneId) {
      pendingPreviewPaneRef.current = null;
      setPreviewFrame(null);
      return;
    }
    updatePreviewPosition(hoveredPaneId);
  }, [hoveredPaneId, setPreviewFrame, updatePreviewPosition]);

  useEffect(() => {
    if (Object.keys(previewCache).length === 0) return;
    const activePaneIds = new Set(sessionIndex.keys());
    Object.keys(previewCache).forEach((paneId) => {
      if (!activePaneIds.has(paneId)) {
        clearPreviewCache(paneId);
      }
    });
  }, [clearPreviewCache, previewCache, sessionIndex]);

  useEffect(() => {
    if (!hoveredPaneId) return;
    const handleUpdate = () => schedulePreviewPosition(hoveredPaneId);
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);
    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [hoveredPaneId, schedulePreviewPosition]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
      if (typeof window !== "undefined" && rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [clearHoverTimer]);

  const previewLines = selectVisibleLines(previewFrame, hoveredPreviewLines);
  const previewSessionMeta = resolvePreviewSessionMeta(hoveredSession);
  const preview = buildSidebarPreview({
    hoveredPaneId,
    previewFrame,
    title: previewSessionMeta.title,
    sessionName: previewSessionMeta.sessionName,
    windowIndex: previewSessionMeta.windowIndex,
    lines: previewLines,
    loading: hoveredPreviewLoading,
    error: hoveredPreviewError,
  });

  const handleListScroll = useCallback(() => {
    if (hoveredPaneId) {
      schedulePreviewPosition(hoveredPaneId);
    }
  }, [hoveredPaneId, schedulePreviewPosition]);

  return {
    preview,
    handleHoverStart,
    handleHoverEnd,
    handleFocus,
    handleBlur,
    handleSelect,
    handleListScroll,
    registerItemRef,
  };
};

export type { PreviewFrame };
