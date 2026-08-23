import type { HTMLAttributes, RefObject } from "react";
import { useMemo, useRef } from "react";

import {
  buildFullDir,
  buildPathInfo,
  normalizePath,
  useOverflowTruncate,
  useSegmentTruncate,
} from "@/components/ui/file-path-label-utils";
import { cn } from "@/lib/cn";

type FilePathLabelSize = "sm" | "xs";
type DirTruncateMode = "start" | "end" | "segments";

type FilePathLabelProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  renamedFrom?: string | null;
  size?: FilePathLabelSize;
  tailSegments?: number;
  dirTruncate?: DirTruncateMode;
  dirReservePx?: number;
  measureRef?: RefObject<HTMLElement | null>;
};

type HintModel = {
  label: string;
  measureText: string;
};

type PathHint = {
  hint: HintModel;
  measureRef: RefObject<HTMLSpanElement | null>;
};

type HintRowProps = {
  displayText: string;
  hint: HintModel;
  measureRef: RefObject<HTMLSpanElement | null>;
  hintClass: string;
  measureClass: string;
  measureWrapperClass: string;
  isSegmentTruncate: boolean;
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

const isStartTruncate = (mode: DirTruncateMode) => mode === "start";
const isSegmentTruncateMode = (mode: DirTruncateMode) => mode === "segments";

const buildHintClasses = (mode: DirTruncateMode, size: FilePathLabelSize) => {
  const startClass = isStartTruncate(mode)
    ? "text-left [direction:rtl] [unicode-bidi:plaintext]"
    : "";
  return {
    hintClass: cn(
      "text-latte-subtext0 block truncate",
      startClass,
      isSegmentTruncateMode(mode) ? "w-full" : "",
      sizeClass[size].hint,
    ),
    measureClass: cn(
      "text-latte-subtext0 block whitespace-nowrap",
      startClass,
      sizeClass[size].hint,
    ),
    measureWrapperClass: isSegmentTruncateMode(mode)
      ? "pointer-events-none invisible absolute left-0 top-0 w-max"
      : "pointer-events-none invisible absolute inset-0",
  };
};

const buildFallbackHintLabel = (value: string, tailSegments: number) => {
  const info = buildPathInfo(value, tailSegments);
  if (!info.hint) {
    return info.base;
  }
  return `${info.hint}/${info.base}`;
};

const resolveHintLabel = ({
  mode,
  fullText,
  segmentedLabel,
  overflowFallback,
  truncate,
}: {
  mode: DirTruncateMode;
  fullText: string;
  segmentedLabel: string;
  overflowFallback: string;
  truncate: boolean;
}) => {
  if (isStartTruncate(mode)) {
    return fullText;
  }
  if (isSegmentTruncateMode(mode)) {
    return segmentedLabel;
  }
  return truncate ? overflowFallback : fullText;
};

const usePathHint = ({
  mode,
  fullText,
  segments,
  overflowMeasureText,
  overflowFallback,
  reservePx,
  containerRef,
  measureRef,
}: {
  mode: DirTruncateMode;
  fullText: string;
  segments: string[];
  overflowMeasureText: string;
  overflowFallback: string;
  reservePx: number;
  containerRef: RefObject<HTMLElement | null>;
  measureRef?: RefObject<HTMLElement | null>;
}): PathHint => {
  const { ref: overflowRef, truncate } = useOverflowTruncate(overflowMeasureText);
  const segmented = useSegmentTruncate({
    text: fullText,
    segments,
    reservePx,
    containerRef,
    fallbackRef: measureRef,
  });
  const label = resolveHintLabel({
    mode,
    fullText,
    segmentedLabel: segmented.label,
    overflowFallback,
    truncate,
  });
  return {
    hint: {
      label,
      measureText: isSegmentTruncateMode(mode) ? fullText : overflowMeasureText,
    },
    measureRef: isSegmentTruncateMode(mode) ? segmented.measureRef : overflowRef,
  };
};

const HintRow = ({
  displayText,
  hint,
  measureRef,
  hintClass,
  measureClass,
  measureWrapperClass,
  isSegmentTruncate,
}: HintRowProps) => (
  <div className="relative min-w-0">
    <span
      ref={measureRef}
      aria-hidden
      className={cn(isSegmentTruncate ? measureClass : hintClass, measureWrapperClass)}
    >
      {hint.measureText}
    </span>
    <span className={hintClass}>{displayText}</span>
  </div>
);

type HintClasses = ReturnType<typeof buildHintClasses>;

const buildFullLabel = (path: string, renamedFrom?: string | null) =>
  renamedFrom ? `${renamedFrom} → ${path}` : path;

const buildFromFallback = (renamedFrom: string | null | undefined, tailSegments: number) =>
  renamedFrom ? buildFallbackHintLabel(renamedFrom, tailSegments) : "";

const PathHintRow = ({
  renamedFrom,
  fromHint,
  fromMeasureRef,
  dirHint,
  dirMeasureRef,
  classes,
  isSegmentTruncate,
}: {
  renamedFrom?: string | null;
  fromHint: HintModel;
  fromMeasureRef: RefObject<HTMLSpanElement | null>;
  dirHint: HintModel;
  dirMeasureRef: RefObject<HTMLSpanElement | null>;
  classes: HintClasses;
  isSegmentTruncate: boolean;
}) => {
  if (renamedFrom) {
    return (
      <HintRow
        displayText={`from ${fromHint.label}`}
        hint={fromHint}
        measureRef={fromMeasureRef}
        hintClass={classes.hintClass}
        measureClass={classes.measureClass}
        measureWrapperClass={classes.measureWrapperClass}
        isSegmentTruncate={isSegmentTruncate}
      />
    );
  }
  if (!dirHint.label) {
    return null;
  }
  return (
    <HintRow
      displayText={dirHint.label}
      hint={dirHint}
      measureRef={dirMeasureRef}
      hintClass={classes.hintClass}
      measureClass={classes.measureClass}
      measureWrapperClass={classes.measureWrapperClass}
      isSegmentTruncate={isSegmentTruncate}
    />
  );
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
  const fullLabel = buildFullLabel(path, renamedFrom);
  const fromFullLabel = normalizePath(renamedFrom ?? "");

  const dirSegments = useMemo(() => fullDir.split("/").filter(Boolean), [fullDir]);
  const fromSegments = useMemo(() => fromFullLabel.split("/").filter(Boolean), [fromFullLabel]);
  const fromFallback = useMemo(
    () => buildFromFallback(renamedFrom, tailSegments),
    [renamedFrom, tailSegments],
  );

  const { hint: dirHint, measureRef: dirHintMeasureRef } = usePathHint({
    mode: dirTruncate,
    fullText: fullDir,
    segments: dirSegments,
    overflowMeasureText: fullDir,
    overflowFallback: baseInfo.hint,
    reservePx: dirReservePx,
    containerRef,
    measureRef,
  });
  const { hint: fromHint, measureRef: fromHintMeasureRef } = usePathHint({
    mode: dirTruncate,
    fullText: fromFullLabel,
    segments: fromSegments,
    overflowMeasureText: renamedFrom ? `from ${fromFullLabel}` : "",
    overflowFallback: fromFallback,
    reservePx: dirReservePx,
    containerRef,
    measureRef,
  });

  const classes = buildHintClasses(dirTruncate, size);
  const segmentTruncate = isSegmentTruncateMode(dirTruncate);

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
      <PathHintRow
        renamedFrom={renamedFrom}
        fromHint={fromHint}
        fromMeasureRef={fromHintMeasureRef}
        dirHint={dirHint}
        dirMeasureRef={dirHintMeasureRef}
        classes={classes}
        isSegmentTruncate={segmentTruncate}
      />
      <span className="sr-only">{fullLabel}</span>
    </div>
  );
};

export { FilePathLabel };
