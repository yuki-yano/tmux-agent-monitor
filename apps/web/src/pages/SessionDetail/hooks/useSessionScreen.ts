import type { HighlightCorrectionConfig, ScreenResponse } from "@vde-monitor/shared";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

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

  const isUserScrollingRef = useRef(false);
  const pendingScreenRef = useRef<string | null>(null);
  const screenRef = useRef<string>("");
  const imageRef = useRef<string | null>(null);
  const modeSwitchRef = useRef<ScreenMode | null>(null);
  const cursorRef = useRef<string | null>(null);
  const screenLinesRef = useRef<string[]>([]);
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
    cursorRef,
    screenLinesRef,
  });

  const flushPendingScreen = useCallback(() => {
    const pending = pendingScreenRef.current;
    if (pending == null) return;
    pendingScreenRef.current = null;
    startTransition(() => {
      setScreen(pending);
      setImageBase64(null);
      setScreenContentContextKey(currentScreenContextKey);
    });
    screenRef.current = pending;
    imageRef.current = null;
  }, [currentScreenContextKey, setImageBase64, setScreen, setScreenContentContextKey]);

  const clearPendingScreen = useCallback(() => {
    pendingScreenRef.current = null;
  }, []);

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
    isUserScrollingRef,
    onFlushPending: flushPendingScreen,
    onClearPending: clearPendingScreen,
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
      isUserScrollingRef,
      modeLoadedRef,
      modeSwitchRef,
      screenRef,
      imageRef,
      cursorRef,
      screenLinesRef,
      pendingScreenRef,
      setScreen,
      setImageBase64,
      setScreenContentContextKey,
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

  // Reset pane-scoped refs before useScreenFetch starts its passive initial request.
  // Otherwise a tab switch can send the previous pane's cursor and discard the response.
  useLayoutEffect(() => {
    setScreenLoadingState(initialScreenLoadingState);
    modeSwitchRef.current = null;
    screenRef.current = "";
    imageRef.current = null;
    cursorRef.current = null;
    screenLinesRef.current = [];
    pendingScreenRef.current = null;
    setScreen("");
    setImageBase64(null);
    setScreenContentContextKey(null);
    setScreenFallbackReason(null);
    setScreenError(null);
  }, [
    paneId,
    setImageBase64,
    setScreen,
    setScreenContentContextKey,
    setScreenError,
    setScreenFallbackReason,
    setScreenLoadingState,
  ]);

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
