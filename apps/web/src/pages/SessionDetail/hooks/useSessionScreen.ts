import type { HighlightCorrectionConfig, ScreenResponse } from "@vde-monitor/shared";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { renderAnsiLines } from "@/lib/ansi";
import {
  type ScreenMode,
  initialScreenLoadingState,
  screenLoadingReducer,
} from "@/lib/screen-loading";
import type { Theme } from "@/lib/theme";

import {
  screenContentContextKeyAtom,
  screenErrorAtom,
  screenFallbackReasonAtom,
  screenImageAtom,
  screenLoadingAtom,
  screenModeAtom,
  screenTextAtom,
} from "../atoms/screenAtoms";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";
import { createScreenContent } from "./screen-content";
import { useScreenFetch } from "./useScreenFetch";
import { useScreenMode } from "./useScreenMode";
import { useScreenScroll } from "./useScreenScroll";
import { useScreenWrapMode } from "./useScreenWrapMode";

type UseSessionScreenParams = {
  paneId: string;
  connected: boolean;
  connectionIssue: string | null;
  resolvedTheme: Theme;
  sessionAgent: string | null;
  highlightCorrections: HighlightCorrectionConfig;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  /** Raw API base URL (e.g. "https://host/api" or null for same-origin). */
  apiBaseUrl?: string | null;
  /** Bearer token for SSE. SSE is disabled when null. */
  token?: string | null;
};

export const useSessionScreen = ({
  paneId,
  connected,
  connectionIssue,
  resolvedTheme,
  sessionAgent,
  highlightCorrections,
  requestScreen,
  apiBaseUrl = null,
  token = null,
}: UseSessionScreenParams) => {
  const [screenText, setScreen] = useAtom(screenTextAtom);
  const [imageBase64, setImageBase64] = useAtom(screenImageAtom);
  const [screenContentContextKey, setScreenContentContextKey] = useAtom(
    screenContentContextKeyAtom,
  );
  const [screenLoadingState, setScreenLoadingState] = useAtom(screenLoadingAtom);
  const setScreenFallbackReason = useSetAtom(screenFallbackReasonAtom);
  const setScreenError = useSetAtom(screenErrorAtom);
  const mode = useAtomValue(screenModeAtom);
  const { wrapMode, toggleWrapMode } = useScreenWrapMode();

  const [content] = useState(() =>
    createScreenContent({ setScreen, setImageBase64, setScreenContentContextKey }),
  );
  const modeSwitchRef = useRef<ScreenMode | null>(null);
  const currentScreenContextKey = `${paneId}\0${mode}`;
  const hasCurrentScreenContent = screenContentContextKey === currentScreenContextKey;

  const dispatchScreenLoading = useCallback(
    (event: Parameters<typeof screenLoadingReducer>[1]) => {
      setScreenLoadingState((prev) => screenLoadingReducer(prev, event));
    },
    [setScreenLoadingState],
  );

  const { modeLoaded, modeLoadedRef, handleModeChange, markModeLoaded } = useScreenMode({
    connected,
    paneId,
    dispatchScreenLoading,
    modeSwitchRef,
    resetDeltaBase: content.resetDeltaBase,
  });

  const screenLines = useMemo(() => {
    if (mode !== "text" || !hasCurrentScreenContent) {
      return [];
    }
    const isTextLoading = screenLoadingState.loading && screenLoadingState.mode === "text";
    if (screenText.length === 0 && (isTextLoading || !modeLoaded.text)) {
      return [];
    }
    const agent = sessionAgent === "codex" || sessionAgent === "claude" ? sessionAgent : "unknown";
    return renderAnsiLines(screenText || "No screen data", resolvedTheme, {
      agent,
      highlightCorrections,
    });
  }, [
    highlightCorrections,
    hasCurrentScreenContent,
    mode,
    modeLoaded.text,
    resolvedTheme,
    screenLoadingState.loading,
    screenLoadingState.mode,
    screenText,
    sessionAgent,
  ]);

  const {
    isAtBottom,
    isUserScrolling,
    shouldFollowOutput,
    scrollToBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    viewportRef,
    scrollerRef,
  } = useScreenScroll({
    paneId,
    mode,
    screenLinesLength: screenLines.length,
    onFlushPending: content.flushPending,
    onClearPending: content.clearPending,
  });

  const apiBasePath = useMemo(() => {
    const normalized = apiBaseUrl?.trim();
    return normalized && normalized.length > 0 ? normalized : "/api";
  }, [apiBaseUrl]);

  const { refreshScreen, error, setError, fallbackReason, pollingPauseReason, transport } =
    useScreenFetch({
      paneId,
      connected,
      connectionIssue,
      requestScreen,
      mode,
      isUserScrolling,
      content,
      modeLoadedRef,
      modeSwitchRef,
      dispatchScreenLoading,
      onModeLoaded: markModeLoaded,
      apiBasePath,
      token,
    });

  const hasBlockingScreenError = error != null && error !== DISCONNECTED_MESSAGE;
  const isInitialModeLoading =
    connected &&
    !connectionIssue &&
    !hasBlockingScreenError &&
    (!modeLoaded[mode] || !hasCurrentScreenContent);
  const isScreenLoading =
    (screenLoadingState.loading && screenLoadingState.mode === mode) || isInitialModeLoading;

  // Reset pane content before useScreenFetch starts its passive initial request.
  // Otherwise a tab switch can send the previous pane's cursor and discard the response.
  useLayoutEffect(() => {
    setScreenLoadingState(initialScreenLoadingState);
    modeSwitchRef.current = null;
    content.reset();
    setScreenFallbackReason(null);
    setScreenError(null);
  }, [paneId, content, setScreenError, setScreenFallbackReason, setScreenLoadingState]);

  useEffect(() => {
    if (connected) {
      setScreenError(null);
      return;
    }
    setScreenError(connectionIssue ?? DISCONNECTED_MESSAGE);
  }, [connected, connectionIssue, setScreenError]);

  return {
    mode,
    wrapMode,
    screenLines,
    imageBase64: hasCurrentScreenContent ? imageBase64 : null,
    fallbackReason,
    error,
    pollingPauseReason,
    transport,
    setScreenError: setError,
    isScreenLoading,
    isAtBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    shouldFollowOutput,
    refreshScreen,
    scrollToBottom,
    handleModeChange,
    toggleWrapMode,
    viewportRef,
    scrollerRef,
  };
};
