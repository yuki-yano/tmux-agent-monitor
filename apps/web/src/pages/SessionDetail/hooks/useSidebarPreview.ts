import type {
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionSummary,
} from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { renderAnsiLines } from "@/lib/ansi";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
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
  timeline: SessionStateTimeline | null;
  timelineLoading: boolean;
  timelineError: string | null;
};

type UseSidebarPreviewParams = {
  sessionIndex: Map<string, SessionSummary>;
  currentPaneId?: string | null;
  connected: boolean;
  connectionIssue: string | null;
  requestStateTimeline?: (
    paneId: string,
    options?: { range?: SessionStateTimelineRange; limit?: number },
  ) => Promise<SessionStateTimeline>;
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
const PREVIEW_HEADER_OFFSET = 176;
const PREVIEW_LINE_HEIGHT = 16;
const HOVER_PREVIEW_DELAY_MS = 320;
const TIMELINE_RANGE: SessionStateTimelineRange = "1h";
const TIMELINE_LIMIT = 200;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type PreviewCacheMap = Partial<Record<string, { screen: string }>>;
type PreviewLoadingMap = Partial<Record<string, boolean>>;
type PreviewErrorMap = Partial<Record<string, string | null>>;
type TimelineCacheMap = Partial<Record<string, SessionStateTimeline>>;

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

const isPaneLoading = (paneId: string | null, loading: Record<string, boolean>) =>
  Boolean(paneId && loading[paneId]);

const pickPaneError = (paneId: string | null, errors: Record<string, string | null>) => {
  if (!paneId) {
    return null;
  }
  return errors[paneId] ?? null;
};

const pickPaneTimeline = (paneId: string | null, cache: TimelineCacheMap) => {
  if (!paneId) {
    return null;
  }
  return cache[paneId] ?? null;
};

const resolveTimelineError = (err: unknown) =>
  err instanceof Error ? err.message : API_ERROR_MESSAGES.timeline;

const prunePaneRecord = <T>(record: Record<string, T>, activePaneIds: Set<string>) => {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return record;
  }
  const nextKeys = keys.filter((paneId) => activePaneIds.has(paneId));
  if (nextKeys.length === keys.length) {
    return record;
  }
  const nextRecord: Record<string, T> = {};
  nextKeys.forEach((paneId) => {
    nextRecord[paneId] = record[paneId] as T;
  });
  return nextRecord;
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
  timeline,
  timelineLoading,
  timelineError,
}: {
  hoveredPaneId: string | null;
  previewFrame: PreviewFrame | null;
  title: string;
  sessionName: string | null;
  windowIndex: number | null;
  lines: string[];
  loading: boolean;
  error: string | null;
  timeline: SessionStateTimeline | null;
  timelineLoading: boolean;
  timelineError: string | null;
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
    timeline,
    timelineLoading,
    timelineError,
  };
};

export const useSidebarPreview = ({
  sessionIndex,
  currentPaneId,
  connected,
  connectionIssue,
  requestStateTimeline,
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
  const [timelineCache, setTimelineCache] = useState<Record<string, SessionStateTimeline>>({});
  const [timelineLoading, setTimelineLoading] = useState<Record<string, boolean>>({});
  const [timelineError, setTimelineError] = useState<Record<string, string | null>>({});
  const timelineCacheRef = useRef<Record<string, SessionStateTimeline>>({});
  const timelineInflightRef = useRef(new Set<string>());
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
  const hoveredTimeline = pickPaneTimeline(hoveredPaneId, timelineCache);
  const hoveredTimelineLoading = isPaneLoading(hoveredPaneId, timelineLoading);
  const hoveredTimelineError = pickPaneError(hoveredPaneId, timelineError);
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

  useEffect(() => {
    timelineCacheRef.current = timelineCache;
  }, [timelineCache]);

  const fetchTimeline = useCallback(
    async (paneId: string) => {
      if (!requestStateTimeline || !paneId) {
        return;
      }
      if (timelineCacheRef.current[paneId] || timelineInflightRef.current.has(paneId)) {
        return;
      }
      timelineInflightRef.current.add(paneId);
      setTimelineLoading((prev) => ({ ...prev, [paneId]: true }));
      try {
        const timeline = await requestStateTimeline(paneId, {
          range: TIMELINE_RANGE,
          limit: TIMELINE_LIMIT,
        });
        setTimelineCache((prev) => ({ ...prev, [paneId]: timeline }));
        setTimelineError((prev) => ({ ...prev, [paneId]: null }));
      } catch (err) {
        setTimelineError((prev) => ({ ...prev, [paneId]: resolveTimelineError(err) }));
      } finally {
        timelineInflightRef.current.delete(paneId);
        setTimelineLoading((prev) => ({ ...prev, [paneId]: false }));
      }
    },
    [requestStateTimeline],
  );

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
      if (rafIdRef.current != null) return;
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
    if (hoverTimerRef.current != null) {
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
      void fetchTimeline(paneId);
      clearHoverTimer();
      pendingHoverRef.current = paneId;
      hoverTimerRef.current = window.setTimeout(() => {
        if (pendingHoverRef.current !== paneId) return;
        setHoveredPaneId(paneId);
        clearHoverTimer();
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [clearHoverTimer, currentPaneId, fetchTimeline, prefetchPreview, setHoveredPaneId],
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
      void fetchTimeline(paneId);
    },
    [clearHoverTimer, currentPaneId, fetchTimeline, prefetchPreview, setHoveredPaneId],
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
    const activePaneIds = new Set(sessionIndex.keys());
    setTimelineCache((prev) => prunePaneRecord(prev, activePaneIds));
    setTimelineLoading((prev) => prunePaneRecord(prev, activePaneIds));
    setTimelineError((prev) => prunePaneRecord(prev, activePaneIds));
  }, [sessionIndex]);

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
      if (typeof window !== "undefined" && rafIdRef.current != null) {
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
    timeline: hoveredTimeline,
    timelineLoading: hoveredTimelineLoading,
    timelineError: hoveredTimelineError,
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
