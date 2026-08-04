import { useCallback, useEffect, useRef } from "react";

import type { PreviewFrame } from "../atoms/sidebarPreviewAtoms";
import { resolvePreviewFrame } from "./sidebar-preview-geometry";

const HOVER_PREVIEW_DELAY_MS = 320;

export const useSidebarPreviewHoverController = ({
  currentPaneId,
  hoveredPaneId,
  setHoveredPaneId,
  setPreviewFrame,
  prefetchPreview,
  fetchTimeline,
}: {
  currentPaneId?: string | null;
  hoveredPaneId: string | null;
  setHoveredPaneId: (next: string | null | ((prev: string | null) => string | null)) => void;
  setPreviewFrame: (next: PreviewFrame | null) => void;
  prefetchPreview: (paneId: string) => Promise<void>;
  fetchTimeline: (paneId: string) => Promise<void>;
}) => {
  const itemRefs = useRef<Map<string, HTMLDivElement> | null>(null);
  if (itemRefs.current == null) {
    itemRefs.current = new Map();
  }
  const hoverTimerRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingPreviewPaneRef = useRef<string | null>(null);

  const updatePreviewPosition = useCallback(
    (paneId: string) => {
      const node = itemRefs.current!.get(paneId);
      if (!node || typeof window === "undefined") {
        return;
      }
      const rect = node.getBoundingClientRect();
      const frame = resolvePreviewFrame({
        rect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      if (!frame) {
        return;
      }
      setPreviewFrame(frame);
    },
    [setPreviewFrame],
  );

  const schedulePreviewPosition = useCallback(
    (paneId: string) => {
      if (!paneId || typeof window === "undefined") {
        return;
      }
      pendingPreviewPaneRef.current = paneId;
      if (rafIdRef.current != null) {
        return;
      }
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
        if (prev !== paneId) {
          return prev;
        }
        setPreviewFrame(null);
        return null;
      });
    },
    [clearHoverTimer, setHoveredPaneId, setPreviewFrame],
  );

  const registerItemRef = useCallback((paneId: string, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current!.set(paneId, node);
    } else {
      itemRefs.current!.delete(paneId);
    }
  }, []);

  const prefetch = useCallback(
    (paneId: string) => {
      void prefetchPreview(paneId);
      void fetchTimeline(paneId);
    },
    [fetchTimeline, prefetchPreview],
  );

  const handleHoverStart = useCallback(
    (paneId: string) => {
      if (paneId === currentPaneId) {
        return;
      }
      prefetch(paneId);
      clearHoverTimer();
      pendingHoverRef.current = paneId;
      hoverTimerRef.current = window.setTimeout(() => {
        if (pendingHoverRef.current !== paneId) {
          return;
        }
        setHoveredPaneId(paneId);
        clearHoverTimer();
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [clearHoverTimer, currentPaneId, prefetch, setHoveredPaneId],
  );

  const handleHoverEnd = useCallback(
    (paneId: string) => {
      clearHoverState(paneId);
    },
    [clearHoverState],
  );

  const handleFocus = useCallback(
    (paneId: string) => {
      if (paneId === currentPaneId) {
        return;
      }
      clearHoverTimer();
      setHoveredPaneId(paneId);
      prefetch(paneId);
    },
    [clearHoverTimer, currentPaneId, prefetch, setHoveredPaneId],
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
    // The hook publishes geometry to the owning overlay after the hovered DOM node commits.
    // react-doctor-disable-next-line no-pass-data-to-parent, no-pass-live-state-to-parent
    updatePreviewPosition(hoveredPaneId);
  }, [hoveredPaneId, setPreviewFrame, updatePreviewPosition]);

  useEffect(() => {
    if (!hoveredPaneId) {
      return;
    }
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

  const handleListScroll = useCallback(() => {
    if (hoveredPaneId) {
      schedulePreviewPosition(hoveredPaneId);
    }
  }, [hoveredPaneId, schedulePreviewPosition]);

  return {
    registerItemRef,
    handleHoverStart,
    handleHoverEnd,
    handleFocus,
    handleBlur,
    handleSelect,
    handleListScroll,
  };
};
