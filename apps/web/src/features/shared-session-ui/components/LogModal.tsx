import type { SessionSummary } from "@vde-monitor/shared";
import { useAtomValue } from "jotai";
import { ArrowRight, ExternalLink, X } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  Button,
  Callout,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Toolbar,
} from "@/components/ui";
import { useWorkspaceTabs } from "@/features/pwa-tabs/context/workspace-tabs-context";
import { logModalSnapRequestAtom } from "@/features/shared-session-ui/atoms/logAtoms";
import {
  AnsiVirtualizedViewport,
  type VirtualizedViewportHandle,
} from "@/features/shared-session-ui/components/AnsiVirtualizedViewport";
import { useUserScrollState } from "@/features/shared-session-ui/hooks/useUserScrollState";
import { resolveSessionDisplayTitle } from "@/features/shared-session-ui/model/session-display";
import { sanitizeLogCopyText } from "@/lib/clipboard";

type LogModalState = {
  open: boolean;
  session: SessionSummary | null;
  logLines: string[];
  loading: boolean;
  error: string | null;
};

type LogModalActions = {
  onClose: () => void;
  onOpenHere: () => void;
  onOpenNewTab: () => void;
};

type LogModalProps = {
  state: LogModalState;
  actions: LogModalActions;
};

type LogViewportState = {
  observedLines: string[];
  displayLines: string[];
  isUserScrolling: boolean;
  isAtBottom: boolean;
  followIntent: boolean;
  pendingInitialSnap: boolean;
};

const LogModalViewport = ({
  open,
  logLines,
  loading,
  contextKey,
  shouldSnap,
}: Pick<LogModalState, "open" | "logLines" | "loading"> & {
  contextKey: string;
  shouldSnap: boolean;
}) => {
  const viewportRef = useRef<VirtualizedViewportHandle | null>(null);
  const didSnapRef = useRef(false);
  const [scrollState, setScrollState] = useState<LogViewportState>(() => ({
    observedLines: logLines,
    displayLines: open ? logLines : [],
    isUserScrolling: false,
    isAtBottom: true,
    followIntent: true,
    pendingInitialSnap: shouldSnap,
  }));
  let current = scrollState;
  if (current.observedLines !== logLines) {
    current = {
      ...current,
      observedLines: logLines,
      displayLines: open && !current.isUserScrolling ? logLines : current.displayLines,
    };
  }
  if (current.pendingInitialSnap && current.displayLines.length > 0) {
    current = { ...current, pendingInitialSnap: false, followIntent: true };
  }
  if (current !== scrollState) {
    setScrollState(current);
  }
  const { displayLines, isAtBottom, followIntent } = current;
  const effectiveIsAtBottom = displayLines.length === 0 ? true : isAtBottom;

  const handleUserScrollStateChange = useCallback((value: boolean) => {
    setScrollState((previous) => ({
      ...previous,
      isUserScrolling: value,
      followIntent: value ? false : previous.followIntent,
      displayLines: value ? previous.displayLines : previous.observedLines,
    }));
  }, []);
  const { scrollerRef } = useUserScrollState({
    enabled: open,
    onUserScrollStateChange: handleUserScrollStateChange,
  });

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth" = "smooth") => {
      if (displayLines.length === 0) return;
      setScrollState((previous) => ({ ...previous, followIntent: true }));
      viewportRef.current?.scrollToEnd({ behavior });
    },
    [displayLines.length],
  );

  useLayoutEffect(() => {
    if (
      !open ||
      !shouldSnap ||
      displayLines.length === 0 ||
      didSnapRef.current ||
      !viewportRef.current
    )
      return;
    viewportRef.current.scrollToEnd({ behavior: "auto" });
    didSnapRef.current = true;
  }, [displayLines.length, open, shouldSnap]);

  const handleAtBottomChange = useCallback((value: boolean) => {
    setScrollState((previous) => ({
      ...previous,
      isAtBottom: value,
      followIntent: value || previous.followIntent,
    }));
  }, []);

  return (
    <AnsiVirtualizedViewport
      lines={displayLines}
      scrollContextKey={contextKey}
      loading={loading}
      loadingLabel="Loading log..."
      isAtBottom={effectiveIsAtBottom}
      shouldFollowOutput={effectiveIsAtBottom || followIntent}
      onAtBottomChange={handleAtBottomChange}
      viewportRef={viewportRef}
      scrollerRef={scrollerRef}
      scrollerClassName="overscroll-contain"
      onScrollToBottom={scrollToBottom}
      className="border-latte-surface2/50 bg-latte-crust/60 shadow-inner-soft relative mt-2.5 flex min-h-0 w-full flex-1 rounded-xl border sm:mt-3"
      viewportClassName="h-full w-full min-w-0 max-w-full px-2 py-1.5 sm:px-3 sm:py-2"
      listClassName="text-latte-text w-max min-w-full font-mono text-[12px] leading-[16px]"
      lineClassName="min-h-4 whitespace-pre leading-5"
      height="100%"
      estimatedLineHeight={20}
      sanitizeCopyText={sanitizeLogCopyText}
    />
  );
};

export const LogModal = ({ state, actions }: LogModalProps) => {
  const { open, session, logLines, loading, error } = state;
  const { onClose, onOpenHere, onOpenNewTab } = actions;
  const { enabled: pwaTabsEnabled } = useWorkspaceTabs();
  const snapRequest = useAtomValue(logModalSnapRequestAtom);
  const paneId = session?.paneId ?? null;
  const snapVersion = snapRequest.paneId === paneId ? snapRequest.version : -1;
  const contextKey = `${open}:${paneId}:${snapVersion}`;

  if (!session) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        overlayProps={{
          "data-testid": "log-modal-overlay",
          "data-log-modal-overlay": "true",
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              onClose();
            }
          },
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
          onClose();
        }}
        data-log-modal-panel="true"
        data-testid="log-modal-panel"
        className="top-[50%] z-111 flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-3rem)] w-[min(760px,calc(100vw-1rem))] max-w-none translate-y-[-50%] overflow-hidden border-0 bg-transparent p-0 shadow-none ring-0 sm:w-[min(760px,calc(100vw-1.5rem))]"
      >
        <Card className="font-body border-latte-lavender/30 bg-latte-mantle/85 shadow-accent-panel ring-latte-overlay2/25 relative flex h-[min(720px,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-3rem))] max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-3rem)] min-h-0 w-full flex-col overflow-hidden rounded-3xl border-2 p-3 ring-1 ring-inset backdrop-blur-xl sm:p-4">
          <DialogTitle className="sr-only">Session Log</DialogTitle>
          <DialogDescription className="sr-only">
            Scroll and inspect the selected session log output.
          </DialogDescription>
          <IconButton
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3"
            variant="lavender"
            size="sm"
            aria-label="Close log"
          >
            <X className="h-4 w-4" />
          </IconButton>
          <Toolbar className="gap-3 pr-10 sm:pr-12">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p
                className="text-latte-text truncate text-base font-semibold"
                title={resolveSessionDisplayTitle(session)}
              >
                {resolveSessionDisplayTitle(session)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenHere}
                aria-label="Open here"
                className="border-latte-lavender/40 text-latte-lavender-text hover:border-latte-lavender/60 hover:bg-latte-lavender/10 h-7 w-7 p-0"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenNewTab}
                aria-label={pwaTabsEnabled ? "Open in workspace tab" : "Open in new tab"}
                className="border-latte-lavender/40 text-latte-lavender-text hover:border-latte-lavender/60 hover:bg-latte-lavender/10 h-7 w-7 p-0"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </Toolbar>
          {error && (
            <Callout tone="error" size="xs" className="mt-2">
              {error}
            </Callout>
          )}
          <LogModalViewport
            key={contextKey}
            open={open}
            logLines={logLines}
            loading={loading}
            contextKey={contextKey}
            shouldSnap={snapRequest.paneId === paneId}
          />
        </Card>
      </DialogContent>
    </Dialog>
  );
};
