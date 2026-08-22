import { type Virtualizer, useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type RefObject,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { IconButton, LoadingOverlay } from "@/components/ui";
import { cn } from "@/lib/cn";

import { type VirtualLineItemsState, reconcileVirtualLineItems } from "../lib/virtual-line-items";
import { TerminalHtmlLine } from "./TerminalHtmlLine";

type VisibleRange = { startIndex: number; endIndex: number };

export type VirtualizedViewportHandle = {
  scrollToEnd: (options?: { behavior?: "auto" | "smooth" }) => void;
};

type AnsiVirtualizedViewportProps = {
  lines: string[];
  scrollContextKey: string;
  loading: boolean;
  loadingLabel: string;
  loadingEntrance?: "immediate" | "delayed";
  isAtBottom: boolean;
  onAtBottomChange: (value: boolean) => void;
  onRangeChanged?: (range: VisibleRange) => void;
  followOutput?: "auto" | "smooth" | boolean;
  shouldFollowOutput?: boolean;
  viewportRef?: Ref<VirtualizedViewportHandle>;
  scrollerRef?: RefObject<HTMLDivElement | null>;
  scrollerClassName?: string;
  onScrollToBottom?: (behavior: "auto" | "smooth") => void;
  className?: string;
  viewportClassName?: string;
  listClassName?: string;
  lineClassName?: string;
  height?: string | number;
  estimatedLineHeight?: number;
  sanitizeCopyText?: (raw: string) => string;
  onLineClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onLineKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

type CommittedVirtualLines = {
  scrollContextKey: string;
  state: VirtualLineItemsState;
};

type VirtualLineEdges = {
  scrollContextKey: string;
  count: number;
  firstId: string | null;
  lastId: string | null;
};

const EMPTY_VIRTUAL_LINES_STATE: VirtualLineItemsState = { items: [], nextId: 0 };

// Memoized so rows whose html is unchanged skip re-rendering while the
// screen stream replaces the lines array on every SSE event.
const AnsiLine = memo(({ html, className }: { html: string; className?: string }) => (
  <TerminalHtmlLine className={className} html={html} />
));

AnsiLine.displayName = "AnsiLine";

const getFollowBehavior = (followOutput: AnsiVirtualizedViewportProps["followOutput"]) =>
  followOutput === "smooth" ? "smooth" : "auto";

const isSameRange = (left: VisibleRange | null, right: VisibleRange) =>
  left?.startIndex === right.startIndex && left.endIndex === right.endIndex;

export const AnsiVirtualizedViewport = ({
  lines,
  scrollContextKey,
  loading,
  loadingLabel,
  loadingEntrance = "immediate",
  isAtBottom,
  onAtBottomChange,
  onRangeChanged,
  followOutput = "auto",
  shouldFollowOutput = isAtBottom,
  viewportRef,
  scrollerRef: scrollerRefProp,
  scrollerClassName,
  onScrollToBottom,
  className,
  viewportClassName,
  listClassName,
  lineClassName = "min-h-4 whitespace-pre leading-4",
  height = "100%",
  estimatedLineHeight = 16,
  sanitizeCopyText,
  onLineClick,
  onLineKeyDown,
}: AnsiVirtualizedViewportProps) => {
  const internalScrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = scrollerRefProp ?? internalScrollerRef;
  const listRef = useRef<HTMLDivElement | null>(null);
  const committedVirtualLinesRef = useRef<CommittedVirtualLines | null>(null);
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  const onRangeChangedRef = useRef(onRangeChanged);
  const lastPublishedAtBottomRef = useRef<boolean | null>(null);
  const lastPublishedRangeRef = useRef<VisibleRange | null>(null);
  const previousEdgesRef = useRef<VirtualLineEdges | null>(null);
  const widthContextKeyRef = useRef(scrollContextKey);

  const virtualLinesState = useMemo(() => {
    const committed = committedVirtualLinesRef.current;
    const previousState =
      committed?.scrollContextKey === scrollContextKey
        ? committed.state
        : {
            items: EMPTY_VIRTUAL_LINES_STATE.items,
            nextId: committed?.state.nextId ?? EMPTY_VIRTUAL_LINES_STATE.nextId,
          };
    return reconcileVirtualLineItems(previousState, lines);
  }, [lines, scrollContextKey]);
  const virtualLines = virtualLinesState.items;
  const followBehavior = getFollowBehavior(followOutput);

  useLayoutEffect(() => {
    committedVirtualLinesRef.current = { scrollContextKey, state: virtualLinesState };
  }, [scrollContextKey, virtualLinesState]);

  useLayoutEffect(() => {
    onAtBottomChangeRef.current = onAtBottomChange;
    onRangeChangedRef.current = onRangeChanged;
  }, [onAtBottomChange, onRangeChanged]);

  const publishVirtualState = useCallback(
    (instance: Virtualizer<HTMLDivElement, HTMLDivElement>) => {
      const nextAtBottom = lines.length === 0 || instance.isAtEnd(2);
      if (lastPublishedAtBottomRef.current !== nextAtBottom) {
        lastPublishedAtBottomRef.current = nextAtBottom;
        onAtBottomChangeRef.current(nextAtBottom);
      }
      const range = instance.range;
      if (range == null) {
        return;
      }
      const nextRange = { startIndex: range.startIndex, endIndex: range.endIndex };
      if (!isSameRange(lastPublishedRangeRef.current, nextRange)) {
        lastPublishedRangeRef.current = nextRange;
        onRangeChangedRef.current?.(nextRange);
      }
    },
    [lines.length],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: virtualLines.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => estimatedLineHeight,
    getItemKey: (index) => virtualLines[index]?.id ?? index,
    useFlushSync: false,
    anchorTo: "end",
    followOnAppend: shouldFollowOutput ? followBehavior : false,
    scrollEndThreshold: 2,
    overscan: 8,
    onChange: publishVirtualState,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useImperativeHandle(
    viewportRef,
    () => ({
      scrollToEnd: (options) => virtualizer.scrollToEnd(options),
    }),
    [virtualizer],
  );

  useLayoutEffect(() => {
    publishVirtualState(virtualizer);
    const previousEdges = previousEdgesRef.current;
    const nextEdges = {
      scrollContextKey,
      count: virtualLines.length,
      firstId: virtualLines[0]?.id ?? null,
      lastId: virtualLines[virtualLines.length - 1]?.id ?? null,
    };
    previousEdgesRef.current = nextEdges;
    const rolledWithoutCountGrowth =
      previousEdges?.scrollContextKey === scrollContextKey &&
      previousEdges.count >= nextEdges.count &&
      nextEdges.count > 0 &&
      (previousEdges.firstId !== nextEdges.firstId || previousEdges.lastId !== nextEdges.lastId);
    if (shouldFollowOutput && rolledWithoutCountGrowth) {
      virtualizer.scrollToEnd({ behavior: followBehavior });
    }
  }, [
    followBehavior,
    publishVirtualState,
    scrollContextKey,
    shouldFollowOutput,
    virtualLines,
    virtualizer,
  ]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollerRef.current;
    if (!list || !scroller) {
      return;
    }

    const contextChanged = widthContextKeyRef.current !== scrollContextKey;
    widthContextKeyRef.current = scrollContextKey;
    const inlineWidth = list.style.width.endsWith("px")
      ? Number.parseFloat(list.style.width)
      : Number.NaN;
    const currentWidth = Number.isFinite(inlineWidth)
      ? inlineWidth
      : list.getBoundingClientRect().width;
    const canShrink = contextChanged || scroller.scrollLeft <= 0.5;

    if (canShrink) {
      list.style.width = "100%";
    }

    let widestRow = list.clientWidth;
    for (const child of list.children) {
      if (child instanceof HTMLElement) {
        widestRow = Math.max(widestRow, child.scrollWidth);
      }
    }

    const nextWidth = canShrink ? widestRow : Math.max(currentWidth, widestRow);
    if (nextWidth > 0) {
      list.style.width = `${Math.ceil(nextWidth)}px`;
    }
  }, [scrollContextKey, scrollerRef, virtualItems, virtualLines]);

  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!sanitizeCopyText) {
        return;
      }
      const selection = window.getSelection?.();
      const raw = selection?.toString() ?? "";
      if (!raw) {
        return;
      }
      const sanitized = sanitizeCopyText(raw);
      if (sanitized === raw || !event.clipboardData) {
        return;
      }
      event.preventDefault();
      event.clipboardData.setData("text/plain", sanitized);
    },
    [sanitizeCopyText],
  );

  const scrollToBottom = useCallback(() => {
    if (onScrollToBottom) {
      onScrollToBottom("smooth");
      return;
    }
    virtualizer.scrollToEnd({ behavior: "smooth" });
  }, [onScrollToBottom, virtualizer]);

  return (
    <div
      role="log"
      aria-label="Terminal output"
      className={cn(
        "relative min-h-0 overflow-hidden",
        className,
        height !== "100%" && "flex-none",
      )}
      style={{ height }}
      onCopy={handleCopy}
      onClick={onLineClick}
      onKeyDown={onLineKeyDown}
    >
      {loading && <LoadingOverlay label={loadingLabel} entrance={loadingEntrance} />}
      <div
        ref={scrollerRef}
        role="region"
        aria-label="Scrollable terminal output"
        tabIndex={0}
        className={cn(
          "custom-scrollbar absolute inset-0 h-full min-h-0 w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-2xl",
          viewportClassName,
          scrollerClassName,
        )}
      >
        <div
          ref={listRef}
          className={cn("relative", listClassName)}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => {
            const line = virtualLines[virtualItem.index];
            if (!line) {
              return null;
            }
            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "max-content",
                  minWidth: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <AnsiLine html={line.html} className={lineClassName} />
              </div>
            );
          })}
        </div>
      </div>
      {!isAtBottom && (
        <IconButton
          type="button"
          onClick={scrollToBottom}
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
