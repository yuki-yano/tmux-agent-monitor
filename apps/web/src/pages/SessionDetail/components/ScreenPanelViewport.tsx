import { type KeyboardEvent, type MouseEvent, type RefObject } from "react";

import { LoadingOverlay } from "@/components/ui";
import {
  AnsiVirtualizedViewport,
  type VirtualizedViewportHandle,
} from "@/features/shared-session-ui/components/AnsiVirtualizedViewport";
import { sanitizeLogCopyText } from "@/lib/clipboard";
import type { ScreenMode } from "@/lib/screen-loading";

import type { ScreenWrapMode } from "../atoms/screenAtoms";
import type { SmartWrapLineClassification } from "../smart-wrap-classify";
import { SmartScreenViewport } from "./SmartScreenViewport";

const SCREEN_VIEWPORT_HEIGHT = "60vh";

type ScreenPanelViewportProps = {
  mode: ScreenMode;
  effectiveWrapMode: ScreenWrapMode;
  scrollContextKey: string;
  imageBase64: string | null;
  isAtBottom: boolean;
  shouldFollowOutput: boolean;
  isScreenLoading: boolean;
  screenLines: string[];
  smartLineClassifications: SmartWrapLineClassification[];
  viewportRef: RefObject<VirtualizedViewportHandle | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onAtBottomChange: (value: boolean) => void;
  onRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  onScrollToBottom: (behavior: "auto" | "smooth") => void;
  onUserScrollStateChange: (value: boolean) => void;
  onResolveFileReference: (event: MouseEvent<HTMLDivElement>) => void;
  onResolveFileReferenceKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export const ScreenPanelViewport = function ScreenPanelViewport({
  mode,
  effectiveWrapMode,
  scrollContextKey,
  imageBase64,
  isAtBottom,
  shouldFollowOutput,
  isScreenLoading,
  screenLines,
  smartLineClassifications,
  viewportRef,
  scrollerRef,
  onAtBottomChange,
  onRangeChanged,
  onScrollToBottom,
  onUserScrollStateChange,
  onResolveFileReference,
  onResolveFileReferenceKeyDown,
}: ScreenPanelViewportProps) {
  "use memo";

  const showImage = mode === "image" && Boolean(imageBase64);

  if (showImage) {
    return (
      <div className="border-latte-surface2/80 bg-latte-crust/95 shadow-inner-soft relative min-h-[260px] w-full min-w-0 max-w-full flex-1 rounded-2xl border-2 sm:min-h-[320px]">
        {isScreenLoading && <LoadingOverlay label="Loading screen..." entrance="delayed" />}
        <div className="flex w-full items-center justify-center p-1.5 sm:p-3">
          <img
            src={`data:image/png;base64,${imageBase64}`}
            alt="screen"
            className="border-latte-surface2 max-h-[480px] w-full rounded-xl border object-contain"
          />
        </div>
      </div>
    );
  }

  if (effectiveWrapMode === "smart") {
    return (
      <SmartScreenViewport
        scrollContextKey={scrollContextKey}
        lines={screenLines}
        classifications={smartLineClassifications}
        loading={isScreenLoading}
        loadingLabel="Loading screen..."
        isAtBottom={isAtBottom}
        shouldFollowOutput={shouldFollowOutput}
        onAtBottomChange={onAtBottomChange}
        scrollerRef={scrollerRef}
        onScrollToBottom={onScrollToBottom}
        onUserScrollStateChange={onUserScrollStateChange}
        sanitizeCopyText={sanitizeLogCopyText}
        onLineClick={onResolveFileReference}
        onLineKeyDown={onResolveFileReferenceKeyDown}
        height={SCREEN_VIEWPORT_HEIGHT}
      />
    );
  }

  return (
    <AnsiVirtualizedViewport
      lines={screenLines}
      scrollContextKey={scrollContextKey}
      loading={isScreenLoading}
      loadingLabel="Loading screen..."
      loadingEntrance="delayed"
      isAtBottom={isAtBottom}
      shouldFollowOutput={shouldFollowOutput}
      onAtBottomChange={onAtBottomChange}
      onRangeChanged={onRangeChanged}
      viewportRef={viewportRef}
      scrollerRef={scrollerRef}
      onScrollToBottom={onScrollToBottom}
      className="border-latte-surface2/80 bg-latte-crust/95 shadow-inner-soft relative min-h-[260px] w-full min-w-0 max-w-full flex-1 rounded-2xl border-2 sm:min-h-[320px]"
      viewportClassName="w-full min-w-0 max-w-full px-1 py-1 sm:px-2 sm:py-2"
      listClassName="text-latte-text w-max min-w-full font-mono text-xs"
      lineClassName="min-h-4 whitespace-pre leading-4"
      height={SCREEN_VIEWPORT_HEIGHT}
      sanitizeCopyText={sanitizeLogCopyText}
      onLineClick={onResolveFileReference}
      onLineKeyDown={onResolveFileReferenceKeyDown}
    />
  );
};
