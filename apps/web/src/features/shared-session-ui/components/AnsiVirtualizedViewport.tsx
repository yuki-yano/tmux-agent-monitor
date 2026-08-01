import { ArrowDown } from "lucide-react";
import {
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type RefObject,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { type Components, Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { IconButton, LoadingOverlay } from "@/components/ui";
import { cn } from "@/lib/cn";

import { TerminalHtmlLine } from "./TerminalHtmlLine";

type AnsiVirtuosoContext = {
  listClassName?: string;
  scrollerClassName?: string;
  scrollerRef?: RefObject<HTMLDivElement | null>;
};

type ScrollerComponent = Components<string, AnsiVirtuosoContext>["Scroller"];
type AnsiVirtuosoComponentProps = HTMLAttributes<HTMLDivElement> & {
  context?: AnsiVirtuosoContext;
  ref?: Ref<HTMLDivElement>;
};

type AnsiVirtualizedViewportProps = {
  lines: string[];
  loading: boolean;
  loadingLabel: string;
  loadingEntrance?: "immediate" | "delayed";
  isAtBottom: boolean;
  onAtBottomChange: (value: boolean) => void;
  onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
  followOutput?: "auto" | "smooth" | boolean;
  shouldFollowOutput?: boolean;
  initialTopMostItemIndex?: number;
  virtuosoRef?: React.RefObject<VirtuosoHandle | null>;
  scroller?: ScrollerComponent;
  scrollerRef?: RefObject<HTMLDivElement | null>;
  scrollerClassName?: string;
  onScrollToBottom?: (behavior: "auto" | "smooth") => void;
  className?: string;
  viewportClassName?: string;
  listClassName?: string;
  lineClassName?: string;
  height?: string | number;
  sanitizeCopyText?: (raw: string) => string;
  onLineClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onLineKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

const resolveIsAtBottom = (node: HTMLDivElement) =>
  node.scrollHeight - (node.scrollTop + node.clientHeight) <= 2;

const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
};

const DefaultScroller = ({ className, context, ref, ...props }: AnsiVirtuosoComponentProps) => {
  const setScrollerRef = (node: HTMLDivElement | null) => {
    assignRef(ref, node);
    if (context?.scrollerRef) {
      context.scrollerRef.current = node;
    }
  };

  return (
    <div
      ref={setScrollerRef}
      role="region"
      aria-label="Scrollable terminal output"
      tabIndex={0}
      {...props}
      className={cn(
        "custom-scrollbar w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-2xl",
        context?.scrollerClassName,
        className,
      )}
    />
  );
};

const AnsiVirtualizedList = ({ className, context, ref, ...props }: AnsiVirtuosoComponentProps) => (
  <div ref={ref} {...props} className={cn(context?.listClassName, className)} />
);

const DEFAULT_VIRTUOSO_COMPONENTS: Components<string, AnsiVirtuosoContext> = {
  Scroller: DefaultScroller,
  List: AnsiVirtualizedList,
};

// Memoized so rows whose html is unchanged skip re-rendering while the
// screen stream replaces the lines array on every SSE event.
const AnsiLine = memo(({ html, className }: { html: string; className?: string }) => (
  <TerminalHtmlLine className={className} html={html} />
));

AnsiLine.displayName = "AnsiLine";

export const AnsiVirtualizedViewport = ({
  lines,
  loading,
  loadingLabel,
  loadingEntrance = "immediate",
  isAtBottom,
  onAtBottomChange,
  onRangeChanged,
  followOutput = "auto",
  shouldFollowOutput = isAtBottom,
  initialTopMostItemIndex,
  virtuosoRef,
  scroller,
  scrollerRef,
  scrollerClassName,
  onScrollToBottom,
  className,
  viewportClassName,
  listClassName,
  lineClassName = "min-h-4 whitespace-pre leading-4",
  height = "100%",
  sanitizeCopyText,
  onLineClick,
  onLineKeyDown,
}: AnsiVirtualizedViewportProps) => {
  const internalScrollerRef = useRef<HTMLDivElement | null>(null);
  const resolvedScrollerRef = scrollerRef ?? internalScrollerRef;
  const virtuosoComponents = useMemo<Components<string, AnsiVirtuosoContext>>(() => {
    if (!scroller) {
      return DEFAULT_VIRTUOSO_COMPONENTS;
    }
    return {
      ...DEFAULT_VIRTUOSO_COMPONENTS,
      Scroller: scroller,
    };
  }, [scroller]);
  const virtuosoContext = useMemo(
    () => ({ listClassName, scrollerClassName, scrollerRef: resolvedScrollerRef }),
    [listClassName, resolvedScrollerRef, scrollerClassName],
  );

  useLayoutEffect(() => {
    if (!shouldFollowOutput) {
      return;
    }
    const node = resolvedScrollerRef.current;
    if (!node || resolveIsAtBottom(node)) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [lines, resolvedScrollerRef, shouldFollowOutput]);

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

  const renderLine = useCallback(
    (_index: number, line: string) => <AnsiLine html={line} className={lineClassName} />,
    [lineClassName],
  );

  const scrollToBottom = useCallback(() => {
    if (onScrollToBottom) {
      onScrollToBottom("smooth");
      return;
    }
    virtuosoRef?.current?.scrollToIndex({
      index: Math.max(lines.length - 1, 0),
      behavior: "smooth",
      align: "end",
    });
  }, [lines.length, onScrollToBottom, virtuosoRef]);

  return (
    <div
      role="log"
      aria-label="Terminal output"
      className={className}
      onCopy={handleCopy}
      onClick={onLineClick}
      onKeyDown={onLineKeyDown}
    >
      {loading && <LoadingOverlay label={loadingLabel} entrance={loadingEntrance} />}
      <Virtuoso<string, AnsiVirtuosoContext>
        ref={virtuosoRef}
        data={lines}
        initialTopMostItemIndex={initialTopMostItemIndex ?? Math.max(lines.length - 1, 0)}
        followOutput={shouldFollowOutput ? followOutput : false}
        atBottomStateChange={onAtBottomChange}
        rangeChanged={onRangeChanged}
        components={virtuosoComponents}
        context={virtuosoContext}
        className={viewportClassName}
        style={{ height }}
        itemContent={renderLine}
      />
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
