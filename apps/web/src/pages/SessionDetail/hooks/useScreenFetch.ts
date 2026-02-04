import type { ScreenResponse } from "@vde-monitor/shared";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { applyScreenDeltas } from "@/lib/screen-delta";
import type { ScreenLoadingEvent, ScreenMode } from "@/lib/screen-loading";

import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";

type UseScreenFetchParams = {
  paneId: string;
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  mode: ScreenMode;
  isAtBottom: boolean;
  isUserScrollingRef: MutableRefObject<boolean>;
  modeLoadedRef: MutableRefObject<{ text: boolean; image: boolean }>;
  modeSwitchRef: MutableRefObject<ScreenMode | null>;
  screenRef: MutableRefObject<string>;
  imageRef: MutableRefObject<string | null>;
  cursorRef: MutableRefObject<string | null>;
  screenLinesRef: MutableRefObject<string[]>;
  pendingScreenRef: MutableRefObject<string | null>;
  setScreen: Dispatch<SetStateAction<string>>;
  setImageBase64: Dispatch<SetStateAction<string | null>>;
  dispatchScreenLoading: Dispatch<ScreenLoadingEvent>;
  onModeLoaded: (mode: ScreenMode) => void;
};

export const useScreenFetch = ({
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
  onModeLoaded,
}: UseScreenFetchParams) => {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlightRef = useRef<null | { id: number; mode: ScreenMode }>(null);
  const refreshRequestIdRef = useRef(0);

  const refreshScreen = useCallback(async () => {
    if (!paneId) return;
    if (!connected) {
      refreshInFlightRef.current = null;
      modeSwitchRef.current = null;
      dispatchScreenLoading({ type: "reset" });
      if (!connectionIssue) {
        setError(DISCONNECTED_MESSAGE);
      }
      return;
    }
    const requestId = (refreshRequestIdRef.current += 1);
    const inflight = refreshInFlightRef.current;
    const isModeOverride = inflight && inflight.mode !== mode;
    if (inflight && !isModeOverride) {
      return;
    }
    const isModeSwitch = modeSwitchRef.current === mode;
    const shouldShowLoading = isModeSwitch || !modeLoadedRef.current[mode];
    setError(null);
    if (shouldShowLoading) {
      dispatchScreenLoading({ type: "start", mode });
    }
    refreshInFlightRef.current = { id: requestId, mode };
    try {
      const options: { mode: ScreenMode; cursor?: string } = { mode };
      if (mode === "text" && cursorRef.current) {
        options.cursor = cursorRef.current;
      }
      const response = await requestScreen(paneId, options);
      if (refreshInFlightRef.current?.id !== requestId) {
        return;
      }
      if (!response.ok) {
        setError(response.error?.message ?? API_ERROR_MESSAGES.screenCapture);
        return;
      }
      setFallbackReason(response.fallbackReason ?? null);
      const suppressRender = mode === "text" && !isAtBottom && isUserScrollingRef.current;
      if (response.mode === "image") {
        const nextImage = response.imageBase64 ?? null;
        if (imageRef.current !== nextImage || screenRef.current !== "") {
          startTransition(() => {
            setImageBase64(nextImage);
            setScreen("");
          });
          imageRef.current = nextImage;
          screenRef.current = "";
          pendingScreenRef.current = null;
        }
      } else {
        const nextCursor = response.cursor ?? null;
        const shouldUseFull = response.full || response.screen !== undefined || !response.deltas;
        if (shouldUseFull) {
          const nextScreen = response.screen ?? "";
          const nextLines = nextScreen.replace(/\r\n/g, "\n").split("\n");
          screenLinesRef.current = nextLines;
          cursorRef.current = nextCursor;
          if (suppressRender) {
            pendingScreenRef.current = nextScreen;
          } else if (screenRef.current !== nextScreen || imageRef.current !== null) {
            startTransition(() => {
              setScreen(nextScreen);
              setImageBase64(null);
            });
            screenRef.current = nextScreen;
            imageRef.current = null;
            pendingScreenRef.current = null;
          }
        } else {
          const applied = applyScreenDeltas(screenLinesRef.current, response.deltas ?? []);
          if (!applied.ok) {
            cursorRef.current = null;
            return;
          }
          const nextLines = applied.lines;
          const nextScreen = nextLines.join("\n");
          screenLinesRef.current = nextLines;
          cursorRef.current = nextCursor;
          if (suppressRender) {
            pendingScreenRef.current = nextScreen;
          } else if (screenRef.current !== nextScreen || imageRef.current !== null) {
            startTransition(() => {
              setScreen(nextScreen);
              setImageBase64(null);
            });
            screenRef.current = nextScreen;
            imageRef.current = null;
            pendingScreenRef.current = null;
          }
        }
      }
      onModeLoaded(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : API_ERROR_MESSAGES.screenRequestFailed);
    } finally {
      if (refreshInFlightRef.current?.id === requestId) {
        refreshInFlightRef.current = null;
        if (shouldShowLoading) {
          dispatchScreenLoading({ type: "finish", mode });
        }
        if (isModeSwitch && modeSwitchRef.current === mode) {
          modeSwitchRef.current = null;
        }
      }
    }
  }, [
    connected,
    connectionIssue,
    cursorRef,
    dispatchScreenLoading,
    imageRef,
    isAtBottom,
    isUserScrollingRef,
    mode,
    modeLoadedRef,
    modeSwitchRef,
    onModeLoaded,
    paneId,
    pendingScreenRef,
    requestScreen,
    screenLinesRef,
    screenRef,
    setImageBase64,
    setScreen,
  ]);

  useEffect(() => {
    refreshScreen();
  }, [refreshScreen]);

  useEffect(() => {
    if (!connected) {
      refreshInFlightRef.current = null;
      modeSwitchRef.current = null;
      dispatchScreenLoading({ type: "reset" });
      if (!connectionIssue && !error) {
        setError(DISCONNECTED_MESSAGE);
      }
      return;
    }
    if (error === DISCONNECTED_MESSAGE) {
      setError(null);
    }
  }, [connected, connectionIssue, dispatchScreenLoading, error, modeSwitchRef]);

  useEffect(() => {
    if (!paneId || !connected) {
      return;
    }
    const intervalMs = mode === "image" ? 2000 : 1000;
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      refreshScreen();
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [connected, mode, paneId, refreshScreen]);

  return {
    refreshScreen,
    error,
    setError,
    fallbackReason,
  };
};
