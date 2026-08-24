import { ArrowDown } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type TouchEvent,
  type UIEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { IconButton, LoadingOverlay } from "@/components/ui";
import { TerminalHtmlFragment } from "@/features/shared-session-ui/components/TerminalHtmlLine";
import { cn } from "@/lib/cn";

import type { SmartWrapLineClassification } from "../smart-wrap-classify";
import { decorateSmartWrapLines } from "../smart-wrap-decorator";

type SmartScreenViewportProps = {
  lines: string[];
  classifications: SmartWrapLineClassification[];
  loading: boolean;
  loadingLabel: string;
  scrollContextKey: string;
  isAtBottom: boolean;
  shouldFollowOutput: boolean;
  onAtBottomChange: (value: boolean) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onScrollToBottom: (behavior: "auto" | "smooth") => void;
  onUserScrollStateChange: (value: boolean) => void;
  sanitizeCopyText: (raw: string) => string;
  onLineClick: (event: MouseEvent<HTMLDivElement>) => void;
  onLineKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  height?: string | number;
};

const resolveIsAtBottom = (node: HTMLDivElement) =>
  node.scrollHeight - (node.scrollTop + node.clientHeight) <= 2;

const SCROLL_END_DELAY_MS = 120;
const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

export const SmartScreenViewport = ({
  lines,
  classifications,
  loading,
  loadingLabel,
  scrollContextKey,
  isAtBottom,
  shouldFollowOutput,
  onAtBottomChange,
  scrollerRef,
  onScrollToBottom,
  onUserScrollStateChange,
  sanitizeCopyText,
  onLineClick,
  onLineKeyDown,
  height = "100%",
}: SmartScreenViewportProps) => {
  const scrollEndTimerRef = useRef<number | null>(null);
  const isUserScrollingRef = useRef(false);
  const previousScrollContextKeyRef = useRef(scrollContextKey);
  const decoratedLines = useMemo(
    () => decorateSmartWrapLines(lines, classifications),
    [classifications, lines],
  );
  const decoratedLineRows = useMemo(() => {
    const lineCounts = new Map<string, number>();
    return decoratedLines.map((line, index) => {
      const signature = `${line.className}\u0000${line.lineHtml}`;
      const count = lineCounts.get(signature) ?? 0;
      lineCounts.set(signature, count + 1);
      return {
        key: `smart-line-${signature}-${count}`,
        dataIndex: index,
        line,
      };
    });
  }, [decoratedLines]);

  useLayoutEffect(() => {
    if (!shouldFollowOutput) {
      return;
    }
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    // Writing scrollTop cancels in-flight scroll momentum (including
    // horizontal gestures on the same element), so skip the redundant
    // write when the scroller is already at the bottom.
    if (resolveIsAtBottom(node)) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [decoratedLines, scrollerRef, shouldFollowOutput]);

  // False positive: the viewport owns the DOM measurement, and the parent owns
  // the toolbar state that depends on it. There is no render-time value to lift.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    // react-doctor-disable-next-line no-pass-data-to-parent, no-prop-callback-in-effect
    onAtBottomChange(resolveIsAtBottom(node));
  }, [decoratedLines, onAtBottomChange, scrollerRef]);

  const finishUserScroll = useCallback(() => {
    if (!isUserScrollingRef.current) {
      return;
    }
    isUserScrollingRef.current = false;
    onUserScrollStateChange(false);
  }, [onUserScrollStateChange]);

  const scheduleUserScrollEnd = useCallback(() => {
    if (scrollEndTimerRef.current != null) {
      window.clearTimeout(scrollEndTimerRef.current);
    }
    scrollEndTimerRef.current = window.setTimeout(() => {
      scrollEndTimerRef.current = null;
      finishUserScroll();
    }, SCROLL_END_DELAY_MS);
  }, [finishUserScroll]);

  const beginUserScroll = useCallback(() => {
    if (!isUserScrollingRef.current) {
      isUserScrollingRef.current = true;
      onUserScrollStateChange(true);
    }
    scheduleUserScrollEnd();
  }, [onUserScrollStateChange, scheduleUserScrollEnd]);

  const resetUserScroll = useCallback(() => {
    if (scrollEndTimerRef.current != null) {
      window.clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = null;
    }
    finishUserScroll();
  }, [finishUserScroll]);

  useEffect(() => {
    if (previousScrollContextKeyRef.current === scrollContextKey) {
      return;
    }
    previousScrollContextKeyRef.current = scrollContextKey;
    resetUserScroll();
  }, [resetUserScroll, scrollContextKey]);

  useEffect(() => () => resetUserScroll(), [resetUserScroll]);

  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const selection = window.getSelection?.();
      const raw = selection?.toString() ?? "";
      if (!raw) {
        return;
      }
      const sanitized = sanitizeCopyText(raw);
      if (!event.clipboardData || sanitized === raw) {
        return;
      }
      event.preventDefault();
      event.clipboardData.setData("text/plain", sanitized);
    },
    [sanitizeCopyText],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const node = event.currentTarget;
      onAtBottomChange(resolveIsAtBottom(node));
      if (isUserScrollingRef.current) {
        scheduleUserScrollEnd();
      }
    },
    [onAtBottomChange, scheduleUserScrollEnd],
  );

  const handleWheel = useCallback(
    (_event: WheelEvent<HTMLDivElement>) => beginUserScroll(),
    [beginUserScroll],
  );

  const handleTouchStart = useCallback(
    (_event: TouchEvent<HTMLDivElement>) => beginUserScroll(),
    [beginUserScroll],
  );

  const handleTouchEnd = useCallback(
    (_event: TouchEvent<HTMLDivElement>) => scheduleUserScrollEnd(),
    [scheduleUserScrollEnd],
  );

  const handlePointerDown = useCallback(
    (_event: PointerEvent<HTMLDivElement>) => beginUserScroll(),
    [beginUserScroll],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 0) {
        beginUserScroll();
      }
    },
    [beginUserScroll],
  );

  const handleScrollKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (SCROLL_KEYS.has(event.key)) {
        beginUserScroll();
      }
    },
    [beginUserScroll],
  );

  const handleScrollToBottom = useCallback(() => onScrollToBottom("smooth"), [onScrollToBottom]);

  return (
    <div
      className="border-latte-surface2/80 bg-latte-crust/95 shadow-inner-soft relative min-h-[260px] w-full min-w-0 max-w-full flex-1 rounded-2xl border-2 sm:min-h-[320px]"
      onCopy={handleCopy}
    >
      {loading && <LoadingOverlay label={loadingLabel} entrance="delayed" />}
      <div
        ref={scrollerRef}
        data-testid="smart-screen-scroller"
        role="region"
        aria-label="Screen output"
        className="custom-scrollbar h-full w-full overflow-x-auto overflow-y-auto rounded-2xl"
        style={{ height }}
        tabIndex={0}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={scheduleUserScrollEnd}
        onPointerCancel={scheduleUserScrollEnd}
        onKeyDown={handleScrollKeyDown}
      >
        <div
          data-testid="smart-screen-lines"
          role="log"
          className="text-latte-text w-full min-w-full max-w-full px-1 py-1 font-mono text-xs sm:px-2 sm:py-2"
          onClick={onLineClick}
          onKeyDown={onLineKeyDown}
        >
          {decoratedLineRows.map((item) => (
            <div
              key={item.key}
              data-index={item.dataIndex}
              className={cn("vde-screen-line-smart min-h-4 leading-4", item.line.className)}
            >
              <TerminalHtmlFragment html={item.line.lineHtml} />
            </div>
          ))}
        </div>
      </div>
      {!isAtBottom && (
        <IconButton
          type="button"
          onClick={handleScrollToBottom}
          aria-label="Scroll to bottom"
          className="absolute bottom-2 right-2"
          variant="base"
          size="sm"
        >
          <ArrowDown className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
};
