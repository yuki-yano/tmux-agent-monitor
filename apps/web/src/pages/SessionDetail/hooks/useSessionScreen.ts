import type { HighlightCorrectionConfig, ScreenResponse } from "@vde-monitor/shared";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { renderAnsiLines } from "@/lib/ansi";
import {
  initialScreenLoadingState,
  screenLoadingReducer,
  type ScreenMode,
} from "@/lib/screen-loading";
import type { Theme } from "@/lib/theme";

import { useScreenFetch } from "./useScreenFetch";
import { useScreenMode } from "./useScreenMode";
import { useScreenScroll } from "./useScreenScroll";

type UseSessionScreenParams = {
  paneId: string;
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  resolvedTheme: Theme;
  agent?: string | null;
  highlightCorrections?: HighlightCorrectionConfig;
};

export const useSessionScreen = ({
  paneId,
  connected,
  connectionIssue,
  requestScreen,
  resolvedTheme,
  agent,
  highlightCorrections,
}: UseSessionScreenParams) => {
  const [screen, setScreen] = useState<string>("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [screenLoadingState, dispatchScreenLoading] = useReducer(
    screenLoadingReducer,
    initialScreenLoadingState,
  );

  const isUserScrollingRef = useRef(false);
  const pendingScreenRef = useRef<string | null>(null);
  const screenRef = useRef<string>("");
  const imageRef = useRef<string | null>(null);
  const modeSwitchRef = useRef<ScreenMode | null>(null);
  const cursorRef = useRef<string | null>(null);
  const screenLinesRef = useRef<string[]>([]);

  const { mode, modeLoadedRef, handleModeChange, markModeLoaded } = useScreenMode({
    connected,
    paneId,
    dispatchScreenLoading,
    modeSwitchRef,
    cursorRef,
    screenLinesRef,
  });

  const resolvedAgent = useMemo(() => {
    if (agent === "codex" || agent === "claude") {
      return agent;
    }
    return "unknown";
  }, [agent]);

  const screenLines = useMemo(() => {
    if (mode !== "text") {
      return [];
    }
    return renderAnsiLines(screen || "No screen data", resolvedTheme, {
      agent: resolvedAgent,
      highlightCorrections,
    });
  }, [mode, screen, resolvedAgent, resolvedTheme, highlightCorrections]);

  const flushPendingScreen = useCallback(() => {
    const pending = pendingScreenRef.current;
    if (pending === null) return;
    pendingScreenRef.current = null;
    startTransition(() => {
      setScreen(pending);
      setImageBase64(null);
    });
    screenRef.current = pending;
    imageRef.current = null;
  }, []);

  const clearPendingScreen = useCallback(() => {
    pendingScreenRef.current = null;
  }, []);

  const {
    isAtBottom,
    forceFollow,
    scrollToBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    virtuosoRef,
    scrollerRef,
  } = useScreenScroll({
    mode,
    screenLinesLength: screenLines.length,
    isUserScrollingRef,
    onFlushPending: flushPendingScreen,
    onClearPending: clearPendingScreen,
  });

  const { refreshScreen, error, setError, fallbackReason } = useScreenFetch({
    paneId,
    connected,
    connectionIssue,
    requestScreen,
    mode,
    isAtBottom,
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
    dispatchScreenLoading,
    onModeLoaded: markModeLoaded,
  });

  const isScreenLoading = screenLoadingState.loading && screenLoadingState.mode === mode;

  useEffect(() => {
    dispatchScreenLoading({ type: "reset" });
    modeSwitchRef.current = null;
    screenRef.current = "";
    imageRef.current = null;
    cursorRef.current = null;
    screenLinesRef.current = [];
    pendingScreenRef.current = null;
    setScreen("");
    setImageBase64(null);
  }, [paneId, dispatchScreenLoading]);

  return {
    mode,
    screenLines,
    imageBase64,
    fallbackReason,
    error,
    setScreenError: setError,
    isScreenLoading,
    isAtBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    forceFollow,
    refreshScreen,
    scrollToBottom,
    handleModeChange,
    virtuosoRef,
    scrollerRef,
  };
};
