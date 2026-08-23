import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useRef, useState } from "react";

import { usePointerDrag } from "./use-pointer-drag";

type SplitRatioOptions = {
  storageKey: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const useSplitRatio = ({
  storageKey,
  defaultRatio = 0.56,
  minRatio = 0.4,
  maxRatio = 0.7,
}: SplitRatioOptions) => {
  const [ratio, setRatio] = useState(() => {
    if (typeof window === "undefined") return defaultRatio;
    const stored = Number(window.localStorage.getItem(storageKey));
    if (!Number.isFinite(stored)) return defaultRatio;
    return clamp(stored, minRatio, maxRatio);
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { startDrag } = usePointerDrag<{ startX: number; startRatio: number; width: number }>({
    onMove: (event, context) => {
      const { startX, startRatio, width } = context;
      if (width <= 0) return;
      const delta = event.clientX - startX;
      const next = clamp((startRatio * width + delta) / width, minRatio, maxRatio);
      setRatio(next);
      window.localStorage.setItem(storageKey, String(next));
    },
  });

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      if (event.button !== 0 && event.pointerType !== "touch") return;
      const rect = container.getBoundingClientRect();
      startDrag(event, { startX: event.clientX, startRatio: ratio, width: rect.width });
    },
    [ratio, startDrag],
  );

  return {
    ratio,
    containerRef,
    handlePointerDown,
  };
};
