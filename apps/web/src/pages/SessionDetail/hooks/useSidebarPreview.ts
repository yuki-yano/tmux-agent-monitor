import type {
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionSummary,
} from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { renderAnsiLines } from "@/lib/ansi";
import type { Theme } from "@/lib/theme";

import { useSessionPreview } from "./useSessionPreview";

export type PreviewFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  lines: number;
};

type SidebarPreview = {
  paneId: string;
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
const PREVIEW_HEADER_OFFSET = 96;
const PREVIEW_LINE_HEIGHT = 16;
const HOVER_PREVIEW_DELAY_MS = 320;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const useSidebarPreview = ({
  sessionIndex,
  currentPaneId,
  connected,
  connectionIssue,
  requestScreen,
  resolvedTheme,
  highlightCorrections,
}: UseSidebarPreviewParams) => {
  const { previewCache, previewLoading, previewError, prefetchPreview } = useSessionPreview({
    connected,
    connectionIssue,
    requestScreen,
  });
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrame | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const hoverTimerRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingPreviewPaneRef = useRef<string | null>(null);

  const hoveredSession = hoveredPaneId ? (sessionIndex.get(hoveredPaneId) ?? null) : null;
  const hoveredPreviewEntry = hoveredPaneId ? previewCache[hoveredPaneId] : null;
  const hoveredPreviewText = hoveredPreviewEntry?.screen ?? "";
  const hoveredPreviewLines = useMemo(() => {
    if (!hoveredPaneId || !hoveredPreviewEntry) return [];
    const text = hoveredPreviewText.length > 0 ? hoveredPreviewText : "No log data";
    const agent =
      hoveredSession?.agent === "codex" || hoveredSession?.agent === "claude"
        ? hoveredSession.agent
        : "unknown";
    return renderAnsiLines(text, resolvedTheme, { agent, highlightCorrections });
  }, [
    highlightCorrections,
    hoveredPaneId,
    hoveredPreviewEntry,
    hoveredPreviewText,
    hoveredSession?.agent,
    resolvedTheme,
  ]);
  const hoveredPreviewLoading = hoveredPaneId ? Boolean(previewLoading[hoveredPaneId]) : false;
  const hoveredPreviewError = hoveredPaneId ? (previewError[hoveredPaneId] ?? null) : null;

  const updatePreviewPosition = useCallback((paneId: string) => {
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
  }, []);

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
    [clearHoverTimer],
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
    [clearHoverTimer, currentPaneId, prefetchPreview],
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
    [clearHoverTimer, currentPaneId, prefetchPreview],
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
  }, [clearHoverTimer]);

  useEffect(() => {
    if (!hoveredPaneId) {
      pendingPreviewPaneRef.current = null;
      setPreviewFrame(null);
      return;
    }
    updatePreviewPosition(hoveredPaneId);
  }, [hoveredPaneId, updatePreviewPosition]);

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

  const previewLines = useMemo(() => {
    if (!previewFrame) return [];
    if (hoveredPreviewLines.length === 0) return [];
    return hoveredPreviewLines.slice(-previewFrame.lines);
  }, [hoveredPreviewLines, previewFrame]);

  const previewTitle =
    hoveredSession?.customTitle ??
    hoveredSession?.title ??
    hoveredSession?.sessionName ??
    "Session";

  const preview = useMemo<SidebarPreview | null>(() => {
    if (!hoveredPaneId || !previewFrame) return null;
    return {
      paneId: hoveredPaneId,
      frame: previewFrame,
      title: previewTitle,
      lines: previewLines,
      loading: hoveredPreviewLoading,
      error: hoveredPreviewError,
    };
  }, [
    hoveredPaneId,
    previewFrame,
    previewTitle,
    previewLines,
    hoveredPreviewLoading,
    hoveredPreviewError,
  ]);

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
