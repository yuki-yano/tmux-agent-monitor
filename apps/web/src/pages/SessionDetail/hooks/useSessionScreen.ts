import type { ScreenResponse } from "@vde-monitor/shared";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect, useRef } from "react";

import {
  initialScreenLoadingState,
  screenLoadingReducer,
  type ScreenMode,
} from "@/lib/screen-loading";

import {
  screenErrorAtom,
  screenFallbackReasonAtom,
  screenImageAtom,
  screenLinesAtom,
  screenLoadingAtom,
  screenModeAtom,
  screenTextAtom,
} from "../atoms/screenAtoms";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";
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
};

export const useSessionScreen = ({
  paneId,
  connected,
  connectionIssue,
  requestScreen,
}: UseSessionScreenParams) => {
  const [, setScreen] = useAtom(screenTextAtom);
  const [imageBase64, setImageBase64] = useAtom(screenImageAtom);
  const [screenLoadingState, setScreenLoadingState] = useAtom(screenLoadingAtom);
  const setScreenFallbackReason = useSetAtom(screenFallbackReasonAtom);
  const setScreenError = useSetAtom(screenErrorAtom);
  const screenLines = useAtomValue(screenLinesAtom);
  const mode = useAtomValue(screenModeAtom);

  const isUserScrollingRef = useRef(false);
  const pendingScreenRef = useRef<string | null>(null);
  const screenRef = useRef<string>("");
  const imageRef = useRef<string | null>(null);
  const modeSwitchRef = useRef<ScreenMode | null>(null);
  const cursorRef = useRef<string | null>(null);
  const screenLinesRef = useRef<string[]>([]);

  const dispatchScreenLoading = useCallback(
    (event: Parameters<typeof screenLoadingReducer>[1]) => {
      setScreenLoadingState((prev) => screenLoadingReducer(prev, event));
    },
    [setScreenLoadingState],
  );

  const { modeLoadedRef, handleModeChange, markModeLoaded } = useScreenMode({
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
    });
    screenRef.current = pending;
    imageRef.current = null;
  }, [setImageBase64, setScreen]);

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
    setScreenLoadingState(initialScreenLoadingState);
    modeSwitchRef.current = null;
    screenRef.current = "";
    imageRef.current = null;
    cursorRef.current = null;
    screenLinesRef.current = [];
    pendingScreenRef.current = null;
    setScreen("");
    setImageBase64(null);
    setScreenFallbackReason(null);
    setScreenError(null);
  }, [
    paneId,
    setImageBase64,
    setScreen,
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
