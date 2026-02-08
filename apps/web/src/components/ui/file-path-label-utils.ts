import type { MutableRefObject, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

export const normalizePath = (value: string) => value.replace(/\\/g, "/");

export const buildFullDir = (value: string) => {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
};

export const buildPathInfo = (value: string, tailSegments: number) => {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  const base = segments.pop() ?? normalized;
  if (segments.length === 0) {
    return { base, hint: "" };
  }
  const tail = segments.slice(-tailSegments).join("/");
  const prefix = segments.length > tailSegments ? ".../" : "";
  return { base, hint: `${prefix}${tail}` };
};

const buildSegmentedLabel = (segments: string[], count: number) => {
  if (segments.length === 0) return "";
  const body = segments.slice(-count).join("/");
  if (!body) return "";
  return count < segments.length ? `.../${body}` : body;
};

const SEGMENT_RETRY_LIMIT = 5;
const SEGMENT_RETRY_DELAY_MS = 60;

const measureElementWidth = (element: HTMLElement) =>
  element.getBoundingClientRect().width || element.scrollWidth || element.clientWidth;

const readContainerWidth = (element: HTMLElement | null | undefined) => {
  if (!element) {
    return 0;
  }
  return element.getBoundingClientRect().width || element.clientWidth || 0;
};

const getContainerWidth = (
  primary: HTMLElement | null | undefined,
  fallback: HTMLElement | null | undefined,
) => {
  const primaryWidth = readContainerWidth(primary);
  const fallbackWidth = readContainerWidth(fallback);
  return Math.max(primaryWidth, fallbackWidth);
};

const scheduleRetry = (
  retryRef: MutableRefObject<number>,
  callback: () => void,
  setTimeoutId: (timeoutId: number) => void,
) => {
  if (retryRef.current >= SEGMENT_RETRY_LIMIT) {
    return;
  }
  retryRef.current += 1;
  const timeoutId = window.setTimeout(callback, SEGMENT_RETRY_DELAY_MS);
  setTimeoutId(timeoutId);
};

const findSegmentLabel = (
  text: string,
  segments: string[],
  available: number,
  measureEl: HTMLSpanElement,
) => {
  measureEl.textContent = text;
  const fullWidth = measureElementWidth(measureEl);
  if (!fullWidth) {
    return null;
  }
  if (fullWidth <= available) {
    return text;
  }
  let next = buildSegmentedLabel(segments, 1);
  for (let count = segments.length; count >= 1; count -= 1) {
    const candidate = buildSegmentedLabel(segments, count);
    measureEl.textContent = candidate;
    if (measureElementWidth(measureEl) <= available) {
      next = candidate;
      break;
    }
  }
  return next;
};

const observeResize = (
  primary: HTMLElement | null | undefined,
  fallback: HTMLElement | null | undefined,
  schedule: () => void,
) => {
  if (typeof ResizeObserver === "undefined") {
    return null;
  }
  const observer = new ResizeObserver(schedule);
  if (primary) {
    observer.observe(primary);
  }
  if (fallback && fallback !== primary) {
    observer.observe(fallback);
  }
  return observer;
};

const scheduleOnFontReady = (schedule: () => void) => {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return;
  }
  document.fonts.ready.then(schedule).catch(() => undefined);
};

export const useOverflowTruncate = (text: string) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [truncate, setTruncate] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!text) {
      setTruncate(false);
      return;
    }
    const measure = () => {
      const isOverflow = el.scrollWidth > el.clientWidth;
      setTruncate(isOverflow);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return { ref, truncate };
};

export const useSegmentTruncate = ({
  text,
  segments,
  reservePx,
  containerRef,
  fallbackRef,
}: {
  text: string;
  segments: string[];
  reservePx: number;
  containerRef: RefObject<HTMLElement | null>;
  fallbackRef?: RefObject<HTMLElement | null>;
}) => {
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [label, setLabel] = useState(text);
  const segmentsKey = useMemo(() => segments.join("/"), [segments]);
  const retryRef = useRef(0);

  useLayoutEffect(() => {
    const primary = containerRef.current;
    const fallback = fallbackRef?.current;
    const container = primary ?? fallback;
    const measureEl = measureRef.current;
    if (!container || !measureEl) return;

    let rafId: number | null = null;
    let timeoutId: number | null = null;
    const setRetryTimeout = (nextTimeoutId: number) => {
      timeoutId = nextTimeoutId;
    };
    const update = () => {
      if (!text || segments.length === 0) {
        setLabel("");
        return;
      }
      const containerWidth = getContainerWidth(primary, fallback);
      if (!containerWidth) {
        scheduleRetry(retryRef, update, setRetryTimeout);
        return;
      }
      retryRef.current = 0;
      const available = Math.max(0, containerWidth - reservePx);
      const nextLabel = findSegmentLabel(text, segments, available, measureEl);
      if (nextLabel == null) {
        scheduleRetry(retryRef, update, setRetryTimeout);
        return;
      }
      setLabel(nextLabel);
    };

    const schedule = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(update);
    };

    schedule();
    const observer = observeResize(primary, fallback, schedule);
    scheduleOnFontReady(schedule);
    return () => {
      observer?.disconnect();
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [containerRef, fallbackRef, reservePx, segments, segments.length, segmentsKey, text]);

  return { measureRef, label };
};
