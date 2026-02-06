import { ArrowDown, FileText, Image, RefreshCw } from "lucide-react";
import {
  type ClipboardEvent,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import {
  Button,
  Callout,
  Card,
  IconButton,
  LoadingOverlay,
  Tabs,
  TabsList,
  TabsTrigger,
  Toolbar,
} from "@/components/ui";
import { sanitizeLogCopyText } from "@/lib/clipboard";
import type { ScreenMode } from "@/lib/screen-loading";

import { useStableVirtuosoScroll } from "../hooks/useStableVirtuosoScroll";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";

type ScreenPanelState = {
  mode: ScreenMode;
  connectionIssue: string | null;
  fallbackReason: string | null;
  error: string | null;
  isScreenLoading: boolean;
  imageBase64: string | null;
  screenLines: string[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  forceFollow: boolean;
  rawMode: boolean;
  allowDangerKeys: boolean;
};

type ScreenPanelActions = {
  onModeChange: (mode: ScreenMode) => void;
  onRefresh: () => void;
  onAtBottomChange: (value: boolean) => void;
  onScrollToBottom: (behavior: "auto" | "smooth") => void;
  onUserScrollStateChange: (value: boolean) => void;
};

type ScreenPanelProps = {
  state: ScreenPanelState;
  actions: ScreenPanelActions;
  controls: ReactNode;
};

const shouldShowErrorMessage = (error: string | null, connectionIssue: string | null) =>
  Boolean(error) &&
  (!connectionIssue || (error !== connectionIssue && error !== DISCONNECTED_MESSAGE));

const resolveModeValue = (value: string): ScreenMode | null => {
  if (value === "text" || value === "image") {
    return value;
  }
  return null;
};

const handleModeValueChange = (
  value: string,
  currentMode: ScreenMode,
  onModeChange: (mode: ScreenMode) => void,
) => {
  const nextMode = resolveModeValue(value);
  if (!nextMode || nextMode === currentMode) {
    return;
  }
  onModeChange(nextMode);
};

const renderScreenLine = (_index: number, line: string) => (
  <div
    className="min-h-4 whitespace-pre leading-4"
    dangerouslySetInnerHTML={{ __html: line || "&#x200B;" }}
  />
);

const screenModeTabs = (mode: ScreenMode, onModeChange: (mode: ScreenMode) => void) => (
  <Tabs value={mode} onValueChange={(value) => handleModeValueChange(value, mode, onModeChange)}>
    <TabsList aria-label="Screen mode">
      <TabsTrigger value="text">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          <span>Text</span>
        </span>
      </TabsTrigger>
      <TabsTrigger value="image">
        <span className="inline-flex items-center gap-1.5">
          <Image className="h-3.5 w-3.5" />
          <span>Image</span>
        </span>
      </TabsTrigger>
    </TabsList>
  </Tabs>
);

const RawModeIndicator = ({
  rawMode,
  allowDangerKeys,
}: {
  rawMode: boolean;
  allowDangerKeys: boolean;
}) => {
  if (!rawMode) {
    return null;
  }
  return (
    <div className="border-latte-lavender/60 bg-latte-lavender/10 text-latte-lavender inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] shadow-[inset_0_0_0_1px_rgba(114,135,253,0.12)]">
      Raw
      {allowDangerKeys && (
        <span className="bg-latte-red/20 text-latte-red rounded-full px-2 py-0.5 text-[9px] tracking-[0.24em]">
          Unsafe
        </span>
      )}
    </div>
  );
};

const ScreenContent = ({
  mode,
  imageBase64,
  isAtBottom,
  isScreenLoading,
  screenLines,
  virtuosoRef,
  onAtBottomChange,
  handleRangeChanged,
  VirtuosoScroller,
  onScrollToBottom,
}: {
  mode: ScreenMode;
  imageBase64: string | null;
  isAtBottom: boolean;
  isScreenLoading: boolean;
  screenLines: string[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  onAtBottomChange: (value: boolean) => void;
  handleRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  VirtuosoScroller: (
    props: HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> },
  ) => ReactNode;
  onScrollToBottom: (behavior: "auto" | "smooth") => void;
}) => {
  const showImage = mode === "image" && Boolean(imageBase64);

  return (
    <div className="border-latte-surface2/80 bg-latte-crust/95 relative min-h-[320px] w-full min-w-0 max-w-full flex-1 rounded-2xl border-2 shadow-inner">
      {isScreenLoading && <LoadingOverlay label="Loading screen..." />}
      {showImage ? (
        <div className="flex w-full items-center justify-center p-3">
          <img
            src={`data:image/png;base64,${imageBase64}`}
            alt="screen"
            className="border-latte-surface2 max-h-[480px] w-full rounded-xl border object-contain"
          />
        </div>
      ) : (
        <>
          <Virtuoso
            ref={virtuosoRef}
            data={screenLines}
            initialTopMostItemIndex={Math.max(screenLines.length - 1, 0)}
            followOutput="auto"
            atBottomStateChange={onAtBottomChange}
            rangeChanged={handleRangeChanged}
            components={{ Scroller: VirtuosoScroller, List: VirtuosoList }}
            className="w-full min-w-0 max-w-full"
            style={{ height: "60vh" }}
            itemContent={renderScreenLine}
          />
          {!isAtBottom && (
            <IconButton
              type="button"
              onClick={() => onScrollToBottom("smooth")}
              aria-label="Scroll to bottom"
              className="absolute bottom-2 right-2"
              variant="base"
              size="sm"
            >
              <ArrowDown className="h-4 w-4" />
            </IconButton>
          )}
        </>
      )}
    </div>
  );
};

const VirtuosoList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      className={`text-latte-text w-max min-w-max px-2 py-2 font-mono text-xs ${className ?? ""}`}
    />
  ),
);

VirtuosoList.displayName = "VirtuosoList";

export const ScreenPanel = ({ state, actions, controls }: ScreenPanelProps) => {
  const {
    mode,
    connectionIssue,
    fallbackReason,
    error,
    isScreenLoading,
    imageBase64,
    screenLines,
    virtuosoRef,
    scrollerRef,
    isAtBottom,
    forceFollow,
    rawMode,
    allowDangerKeys,
  } = state;
  const { onModeChange, onRefresh, onAtBottomChange, onScrollToBottom, onUserScrollStateChange } =
    actions;
  const showError = shouldShowErrorMessage(error, connectionIssue);
  const { scrollerRef: stableScrollerRef, handleRangeChanged } = useStableVirtuosoScroll({
    items: screenLines,
    isAtBottom,
    enabled: mode === "text",
    scrollerRef,
    isUserScrolling: forceFollow,
    onUserScrollStateChange,
  });

  const VirtuosoScroller = useMemo(() => {
    const Component = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
      ({ className, ...props }, ref) => (
        <div
          ref={(node) => {
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
            stableScrollerRef.current = node;
          }}
          {...props}
          className={`custom-scrollbar w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-2xl ${className ?? ""}`}
        />
      ),
    );
    Component.displayName = "VirtuosoScroller";
    return Component;
  }, [stableScrollerRef]);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection?.();
    const raw = selection?.toString() ?? "";
    if (!raw) return;
    const sanitized = sanitizeLogCopyText(raw);
    if (sanitized === raw || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", sanitized);
  }, []);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <Toolbar className="gap-3">
        <div className="flex items-center gap-2">{screenModeTabs(mode, onModeChange)}</div>
        <div className="flex items-center gap-2">
          <RawModeIndicator rawMode={rawMode} allowDangerKeys={allowDangerKeys} />
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh screen">
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </Toolbar>
      {fallbackReason && (
        <Callout tone="warning" size="xs">
          Image fallback: {fallbackReason}
        </Callout>
      )}
      {showError && (
        <Callout tone="error" size="xs">
          {error}
        </Callout>
      )}
      <div onCopy={handleCopy}>
        <ScreenContent
          mode={mode}
          imageBase64={imageBase64}
          isAtBottom={isAtBottom}
          isScreenLoading={isScreenLoading}
          screenLines={screenLines}
          virtuosoRef={virtuosoRef}
          onAtBottomChange={onAtBottomChange}
          handleRangeChanged={handleRangeChanged}
          VirtuosoScroller={VirtuosoScroller}
          onScrollToBottom={onScrollToBottom}
        />
      </div>
      <div>{controls}</div>
    </Card>
  );
};
