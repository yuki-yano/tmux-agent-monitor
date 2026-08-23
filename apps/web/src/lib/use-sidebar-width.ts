import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useState } from "react";

import { usePointerDrag } from "./use-pointer-drag";

const STORAGE_KEY = "vde.sidebar-width";
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 340;
const MAX_WIDTH = 560;

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));

export const useSidebarWidth = () => {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (!Number.isFinite(stored)) return DEFAULT_WIDTH;
    return clamp(stored);
  });

  const { startDrag } = usePointerDrag<{ startX: number; startWidth: number }>({
    onMove: (event, context) => {
      const delta = event.clientX - context.startX;
      const nextSidebarWidth = clamp(context.startWidth + delta);
      setSidebarWidth(nextSidebarWidth);
      window.localStorage.setItem(STORAGE_KEY, String(nextSidebarWidth));
    },
  });

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      startDrag(event, { startX: event.clientX, startWidth: sidebarWidth });
    },
    [sidebarWidth, startDrag],
  );

  return {
    sidebarWidth,
    handlePointerDown,
  };
};
