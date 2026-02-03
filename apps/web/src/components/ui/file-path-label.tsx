import type { HTMLAttributes, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

type FilePathLabelSize = "sm" | "xs";

type FilePathLabelProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  renamedFrom?: string | null;
  size?: FilePathLabelSize;
  tailSegments?: number;
  dirTruncate?: "start" | "end" | "segments";
  dirReservePx?: number;
  measureRef?: RefObject<HTMLElement | null>;
};

const sizeClass = {
  sm: {
    base: "text-sm",
    hint: "text-[11px]",
  },
  xs: {
    base: "text-xs",
    hint: "text-[10px]",
  },
};

const normalizePath = (value: string) => value.replace(/\\/g, "/");

const buildFullDir = (value: string) => {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
};

const buildPathInfo = (value: string, tailSegments: number) => {
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

const useOverflowTruncate = (text: string) => {
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

const useSegmentTruncate = ({
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
    const update = () => {
      if (!text || segments.length === 0) {
        setLabel("");
        return;
      }
      const primaryWidth = primary?.getBoundingClientRect().width || primary?.clientWidth || 0;
      const fallbackWidth = fallback?.getBoundingClientRect().width || fallback?.clientWidth || 0;
      const containerWidth = Math.max(primaryWidth, fallbackWidth);
      if (!containerWidth) {
        if (retryRef.current < 5) {
          retryRef.current += 1;
          timeoutId = window.setTimeout(update, 60);
        }
        return;
      }
      retryRef.current = 0;
      const available = Math.max(0, containerWidth - reservePx);
      const measureWidth = () =>
        measureEl.getBoundingClientRect().width || measureEl.scrollWidth || measureEl.clientWidth;
      measureEl.textContent = text;
      const fullWidth = measureWidth();
      if (!fullWidth) {
        if (retryRef.current < 5) {
          retryRef.current += 1;
          timeoutId = window.setTimeout(update, 60);
        }
        return;
      }
      if (fullWidth <= available) {
        setLabel(text);
        return;
      }
      let next = buildSegmentedLabel(segments, 1);
      for (let count = segments.length; count >= 1; count -= 1) {
        const candidate = buildSegmentedLabel(segments, count);
        measureEl.textContent = candidate;
        if (measureWidth() <= available) {
          next = candidate;
          break;
        }
      }
      setLabel(next);
    };

    const schedule = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    schedule();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    if (primary) observer.observe(primary);
    if (fallback && fallback !== primary) observer.observe(fallback);
    if (typeof document !== "undefined" && "fonts" in document) {
      document.fonts.ready.then(schedule).catch(() => undefined);
    }
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [containerRef, fallbackRef, reservePx, segments, segments.length, segmentsKey, text]);

  return { measureRef, label };
};

const FilePathLabel = ({
  path,
  renamedFrom,
  size = "sm",
  tailSegments = 3,
  dirTruncate = "end",
  dirReservePx = 12,
  measureRef,
  className,
  ...props
}: FilePathLabelProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseInfo = buildPathInfo(path, tailSegments);
  const fullDir = buildFullDir(path);
  const dirSegments = useMemo(() => fullDir.split("/").filter(Boolean), [fullDir]);
  const { ref: dirMeasureRef, truncate: truncateDir } = useOverflowTruncate(fullDir);
  const dirSegmented = useSegmentTruncate({
    text: fullDir,
    segments: dirSegments,
    reservePx: dirReservePx,
    containerRef: containerRef,
    fallbackRef: measureRef,
  });
  const dirLabel =
    dirTruncate === "start"
      ? fullDir
      : dirTruncate === "segments"
        ? dirSegmented.label
        : truncateDir
          ? baseInfo.hint
          : fullDir;

  const fromInfo = renamedFrom ? buildPathInfo(renamedFrom, tailSegments) : null;
  const fullLabel = renamedFrom ? `${renamedFrom} → ${path}` : path;
  const fromFullLabel = renamedFrom ? normalizePath(renamedFrom) : "";
  const fromShortLabel = fromInfo
    ? `${fromInfo.hint ? `${fromInfo.hint}/` : ""}${fromInfo.base}`
    : (renamedFrom ?? "");
  const fromMeasureText = renamedFrom ? `from ${fromFullLabel}` : "";
  const { ref: fromMeasureRef, truncate: truncateFrom } = useOverflowTruncate(fromMeasureText);
  const fromSegments = useMemo(() => fromFullLabel.split("/").filter(Boolean), [fromFullLabel]);
  const fromSegmented = useSegmentTruncate({
    text: fromFullLabel,
    segments: fromSegments,
    reservePx: dirReservePx,
    containerRef: containerRef,
    fallbackRef: measureRef,
  });
  const fromLabel =
    dirTruncate === "start"
      ? fromFullLabel
      : dirTruncate === "segments"
        ? fromSegmented.label
        : truncateFrom
          ? fromShortLabel
          : fromFullLabel;

  const hintClass = cn(
    "text-latte-subtext0 block truncate",
    dirTruncate === "start" ? "text-left [direction:rtl] [unicode-bidi:plaintext]" : "",
    dirTruncate === "segments" ? "w-full" : "",
    sizeClass[size].hint,
  );
  const measureClass = cn(
    "text-latte-subtext0 block whitespace-nowrap",
    dirTruncate === "start" ? "text-left [direction:rtl] [unicode-bidi:plaintext]" : "",
    sizeClass[size].hint,
  );
  const measureWrapperClass =
    dirTruncate === "segments"
      ? "pointer-events-none invisible absolute left-0 top-0 w-max"
      : "pointer-events-none invisible absolute inset-0";

  return (
    <div ref={containerRef} className={cn("min-w-0", className)} {...props}>
      <span
        className={cn(
          "text-latte-text block truncate font-semibold leading-snug",
          sizeClass[size].base,
        )}
      >
        {baseInfo.base}
      </span>
      {renamedFrom ? (
        <div className="relative min-w-0">
          <span
            ref={dirTruncate === "segments" ? fromSegmented.measureRef : fromMeasureRef}
            aria-hidden
            className={cn(
              dirTruncate === "segments" ? measureClass : hintClass,
              measureWrapperClass,
            )}
          >
            {dirTruncate === "segments" ? fromFullLabel : fromMeasureText}
          </span>
          <span className={hintClass}>from {fromLabel}</span>
        </div>
      ) : (
        dirLabel && (
          <div className="relative min-w-0">
            <span
              ref={dirTruncate === "segments" ? dirSegmented.measureRef : dirMeasureRef}
              aria-hidden
              className={cn(
                dirTruncate === "segments" ? measureClass : hintClass,
                measureWrapperClass,
              )}
            >
              {fullDir}
            </span>
            <span className={hintClass}>{dirLabel}</span>
          </div>
        )
      )}
      <span className="sr-only">{fullLabel}</span>
    </div>
  );
};

export { FilePathLabel };
