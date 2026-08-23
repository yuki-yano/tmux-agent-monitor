import type { ScreenResponse } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import { applyScreenDeltas } from "@/lib/screen-delta";
import type { ScreenLoadingEvent, ScreenMode } from "@/lib/screen-loading";
import { resolveScreenPollIntervalMs } from "@/lib/screen-polling";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { screenErrorAtom, screenFallbackReasonAtom } from "../atoms/screenAtoms";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";
import {
  type ScreenFetchLifecycleAction,
  type ScreenFetchLifecycleAttempt,
  initialScreenFetchLifecycleState,
  screenFetchLifecycleReducer,
} from "./screen-fetch-lifecycle";
import { useScreenPollingPauseReason } from "./useScreenPollingPauseReason";
import { type ScreenStreamTransport, useScreenStream } from "./useScreenStream";

const normalizeScreenText = (text: string) => text.replace(/\r\n/g, "\n");

const shouldUseFullResponse = (response: ScreenResponse) =>
  response.full || response.screen != null || !response.deltas;

const buildScreenOptions = (mode: ScreenMode, cursor: string | null) => {
  const options: { mode: ScreenMode; cursor?: string } = { mode };
  if (mode === "text" && cursor) {
    options.cursor = cursor;
  }
  return options;
};

type AppliedScreenResponse = {
  contextKey: string;
  capturedAtMs: number;
};

type ScreenFetchContext = {
  key: string;
  paneId: string;
  mode: ScreenMode;
};

// Suppress renders while the user is actively scrolling (any axis, even at the
// bottom): committing screen updates mid-gesture triggers stick-to-bottom
// scrolls that cancel scroll momentum and clamp horizontal position.
// Pending screens are flushed when the user-scroll state ends.
const shouldSuppressTextRender = (mode: ScreenMode, isUserScrolling: boolean) =>
  mode === "text" && isUserScrolling;

type UseScreenFetchParams = {
  paneId: string;
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  mode: ScreenMode;
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
  setScreenContentContextKey: Dispatch<SetStateAction<string | null>>;
  dispatchScreenLoading: Dispatch<ScreenLoadingEvent>;
  onModeLoaded: (mode: ScreenMode) => void;
  /** Base path for API calls (e.g. "/api" or "https://host/api"). Defaults to "/api". */
  apiBasePath?: string;
  /** Bearer token for SSE authentication. SSE is disabled when null. */
  token?: string | null;
  /** Initial SSE screen deadline before REST polling takes over. */
  streamFallbackDelayMs?: number;
};

type CommitTextScreenRefsParams = {
  nextScreen: string;
  nextLines: string[];
  nextCursor: string | null;
  pendingScreen: string | null;
  screenLinesRef: MutableRefObject<string[]>;
  cursorRef: MutableRefObject<string | null>;
  screenRef: MutableRefObject<string>;
  imageRef: MutableRefObject<string | null>;
  pendingScreenRef: MutableRefObject<string | null>;
};

const commitTextScreenRefs = ({
  nextScreen,
  nextLines,
  nextCursor,
  pendingScreen,
  screenLinesRef,
  cursorRef,
  screenRef,
  imageRef,
  pendingScreenRef,
}: CommitTextScreenRefsParams) => {
  screenLinesRef.current = nextLines;
  cursorRef.current = nextCursor;
  pendingScreenRef.current = pendingScreen;
  if (pendingScreen == null) {
    screenRef.current = nextScreen;
    imageRef.current = null;
  }
};

export const useScreenFetch = ({
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
  onModeLoaded,
  apiBasePath = "/api",
  token = null,
  streamFallbackDelayMs,
}: UseScreenFetchParams) => {
  const [fallbackReason, setFallbackReason] = useAtom(screenFallbackReasonAtom);
  const [error, setError] = useAtom(screenErrorAtom);
  const screenContextKey = `${paneId}\0${mode}`;
  const currentContextRef = useRef<ScreenFetchContext>({
    key: screenContextKey,
    paneId,
    mode,
  });
  useLayoutEffect(() => {
    currentContextRef.current = { key: screenContextKey, paneId, mode };
  }, [mode, paneId, screenContextKey]);
  const pollingPauseReason = useScreenPollingPauseReason({
    connected,
    connectionIssue,
  });
  const refreshLifecycleRef = useRef(initialScreenFetchLifecycleState);
  const latestAppliedResponseRef = useRef<AppliedScreenResponse>({
    contextKey: "",
    capturedAtMs: Number.NEGATIVE_INFINITY,
  });
  const sseGenerationRef = useRef(0);
  const applyRefreshLifecycleAction = useCallback((action: ScreenFetchLifecycleAction) => {
    refreshLifecycleRef.current = screenFetchLifecycleReducer(refreshLifecycleRef.current, action);
    return refreshLifecycleRef.current;
  }, []);

  const canPollScreen = useCallback(
    () => connectionIssue !== API_ERROR_MESSAGES.unauthorized,
    [connectionIssue],
  );

  const acceptCurrentResponse = useCallback((response: ScreenResponse) => {
    const currentContext = currentContextRef.current;
    if (response.paneId !== currentContext.paneId || response.mode !== currentContext.mode) {
      return false;
    }

    const capturedAtMs = Date.parse(response.capturedAt);
    if (!Number.isFinite(capturedAtMs)) {
      return false;
    }

    const latestApplied = latestAppliedResponseRef.current;
    if (
      latestApplied.contextKey === currentContext.key &&
      capturedAtMs < latestApplied.capturedAtMs
    ) {
      return false;
    }

    if (response.ok) {
      latestAppliedResponseRef.current = {
        contextKey: currentContext.key,
        capturedAtMs,
      };
    }
    return true;
  }, []);

  const updateImageScreen = useCallback(
    (nextImage: string | null, immediateCommit: boolean) => {
      const shouldCommitImage = imageRef.current !== nextImage || screenRef.current !== "";
      const commitImageState = () => {
        if (shouldCommitImage) {
          setImageBase64(nextImage);
          setScreen("");
        }
        setScreenContentContextKey(screenContextKey);
      };
      if (immediateCommit) {
        commitImageState();
      } else {
        startTransition(commitImageState);
      }
      if (shouldCommitImage) {
        imageRef.current = nextImage;
        screenRef.current = "";
        pendingScreenRef.current = null;
      }
    },
    [
      imageRef,
      pendingScreenRef,
      screenContextKey,
      screenRef,
      setImageBase64,
      setScreen,
      setScreenContentContextKey,
    ],
  );

  const updateTextScreen = useCallback(
    (
      nextScreen: string,
      nextLines: string[],
      nextCursor: string | null,
      suppressRender: boolean,
      immediateCommit: boolean,
    ) => {
      if (suppressRender) {
        commitTextScreenRefs({
          nextScreen,
          nextLines,
          nextCursor,
          pendingScreen: nextScreen,
          // react-doctor-disable-next-line no-event-handler
          screenLinesRef,
          // react-doctor-disable-next-line no-event-handler
          cursorRef,
          // react-doctor-disable-next-line no-event-handler
          screenRef,
          // react-doctor-disable-next-line no-event-handler
          imageRef,
          // react-doctor-disable-next-line no-event-handler
          pendingScreenRef,
        });
        return;
      }
      const shouldCommitScreen = screenRef.current !== nextScreen || imageRef.current != null;
      commitTextScreenRefs({
        nextScreen,
        nextLines,
        nextCursor,
        pendingScreen: null,
        screenLinesRef,
        cursorRef,
        screenRef,
        imageRef,
        pendingScreenRef,
      });
      const commitScreenState = () => {
        if (shouldCommitScreen) {
          // react-doctor-disable-next-line no-event-handler
          setScreen(nextScreen);
          // react-doctor-disable-next-line no-event-handler
          setImageBase64(null);
        }
        setScreenContentContextKey(screenContextKey);
      };
      if (immediateCommit) {
        commitScreenState();
      } else {
        startTransition(commitScreenState);
      }
    },
    [
      cursorRef,
      imageRef,
      pendingScreenRef,
      screenContextKey,
      screenLinesRef,
      screenRef,
      setImageBase64,
      setScreen,
      setScreenContentContextKey,
    ],
  );

  const applyTextResponse = useCallback(
    (response: ScreenResponse, suppressRender: boolean, immediateCommit: boolean) => {
      const nextCursor = response.cursor ?? null;
      if (shouldUseFullResponse(response)) {
        const nextScreen = response.screen ?? "";
        const nextLines = normalizeScreenText(nextScreen).split("\n");
        updateTextScreen(nextScreen, nextLines, nextCursor, suppressRender, immediateCommit);
        return;
      }
      const applied = applyScreenDeltas(screenLinesRef.current, response.deltas ?? []);
      if (!applied.ok) {
        cursorRef.current = null;
        return;
      }
      const nextLines = applied.lines;
      const nextScreen = nextLines.join("\n");
      updateTextScreen(nextScreen, nextLines, nextCursor, suppressRender, immediateCommit);
    },
    [cursorRef, screenLinesRef, updateTextScreen],
  );

  const markCurrentModeLoaded = useCallback(() => {
    // Advance the shared ref before scheduling parent state so a fallback
    // refresh cannot reopen loading in the render-to-effect synchronization gap.
    if (!modeLoadedRef.current[mode]) {
      modeLoadedRef.current = { ...modeLoadedRef.current, [mode]: true };
    }
    onModeLoaded(mode);
  }, [mode, modeLoadedRef, onModeLoaded]);

  const resetDisconnectedState = useCallback(
    (skipWhenErrorPresent: boolean) => {
      applyRefreshLifecycleAction({ type: "reset" });
      modeSwitchRef.current = null;
      dispatchScreenLoading({ type: "reset" });
      const shouldSetDisconnectedError = !connectionIssue && (!skipWhenErrorPresent || !error);
      if (shouldSetDisconnectedError) {
        setError(DISCONNECTED_MESSAGE);
      }
    },
    [
      applyRefreshLifecycleAction,
      connectionIssue,
      dispatchScreenLoading,
      error,
      modeSwitchRef,
      setError,
    ],
  );

  const beginRefreshAttempt = useCallback((): ScreenFetchLifecycleAttempt | null => {
    const hasCurrentData =
      mode === "image" ? imageRef.current != null : screenRef.current.length > 0;
    const nextLifecycle = applyRefreshLifecycleAction({
      type: "request",
      contextKey: screenContextKey,
      mode,
      modeSwitch: modeSwitchRef.current,
      modeLoaded: modeLoadedRef.current,
      hasCurrentData,
    });
    const attempt = nextLifecycle.latestAttempt;
    if (!attempt) {
      return null;
    }
    setError(null);
    if (attempt.shouldShowLoading) {
      dispatchScreenLoading({ type: "start", mode });
    }
    return attempt;
  }, [
    applyRefreshLifecycleAction,
    dispatchScreenLoading,
    imageRef,
    mode,
    modeLoadedRef,
    modeSwitchRef,
    screenRef,
    screenContextKey,
    setError,
  ]);

  const applyRefreshResponse = useCallback(
    (response: ScreenResponse, suppressRender: boolean, immediateCommit: boolean) => {
      if (!acceptCurrentResponse(response)) {
        return;
      }
      if (!response.ok) {
        setError(response.error?.message ?? API_ERROR_MESSAGES.screenCapture);
        return;
      }
      setFallbackReason(response.fallbackReason ?? null);
      if (response.mode === "image") {
        updateImageScreen(response.imageBase64 ?? null, immediateCommit);
      } else {
        applyTextResponse(response, suppressRender, immediateCommit);
      }
      markCurrentModeLoaded();
    },
    [
      acceptCurrentResponse,
      applyTextResponse,
      markCurrentModeLoaded,
      setError,
      setFallbackReason,
      updateImageScreen,
    ],
  );

  const finishRefreshAttempt = useCallback(
    (attempt: ScreenFetchLifecycleAttempt) => {
      if (refreshLifecycleRef.current.inFlight?.id !== attempt.requestId) {
        return;
      }
      applyRefreshLifecycleAction({ type: "finish", requestId: attempt.requestId });
      if (attempt.shouldShowLoading) {
        dispatchScreenLoading({ type: "finish", mode });
      }
      if (attempt.isModeSwitch && modeSwitchRef.current === mode) {
        modeSwitchRef.current = null;
      }
    },
    [applyRefreshLifecycleAction, dispatchScreenLoading, mode, modeSwitchRef],
  );

  const refreshScreen = useCallback(async () => {
    if (!paneId) return;
    if (!connected) {
      resetDisconnectedState(false);
      return;
    }
    const attempt = beginRefreshAttempt();
    if (!attempt) {
      return;
    }
    const requestCursor = cursorRef.current;
    const requestSseGeneration = sseGenerationRef.current;
    const isCurrentAttempt = () =>
      refreshLifecycleRef.current.inFlight?.id === attempt.requestId &&
      currentContextRef.current.key === attempt.contextKey &&
      sseGenerationRef.current === requestSseGeneration &&
      cursorRef.current === requestCursor;
    try {
      const response = await requestScreen(paneId, buildScreenOptions(mode, requestCursor));
      if (!isCurrentAttempt()) {
        return;
      }
      const suppressRender = shouldSuppressTextRender(mode, isUserScrollingRef.current);
      applyRefreshResponse(response, suppressRender, attempt.shouldShowLoading);
    } catch (err) {
      if (isCurrentAttempt()) {
        setError(resolveUnknownErrorMessage(err, API_ERROR_MESSAGES.screenRequestFailed));
      }
    } finally {
      finishRefreshAttempt(attempt);
    }
  }, [
    applyRefreshResponse,
    beginRefreshAttempt,
    connected,
    cursorRef,
    finishRefreshAttempt,
    isUserScrollingRef,
    mode,
    paneId,
    requestScreen,
    resetDisconnectedState,
    setError,
  ]);
  const pollScreen = useCallback(() => {
    void refreshScreen();
  }, [refreshScreen]);

  // SSE screen event handler — applies text response without going through the
  // REST lifecycle (no in-flight tracking needed for push events).
  const handleSseScreenEvent = useCallback(
    (response: ScreenResponse) => {
      if (!acceptCurrentResponse(response)) {
        return;
      }
      if (!response.ok) {
        setFallbackReason(null);
        setError(response.error?.message ?? API_ERROR_MESSAGES.screenCapture);
        markCurrentModeLoaded();
        dispatchScreenLoading({ type: "finish", mode });
        return;
      }
      sseGenerationRef.current += 1;
      applyRefreshLifecycleAction({ type: "reset" });
      if (modeSwitchRef.current === mode) {
        modeSwitchRef.current = null;
      }
      setError(null);
      setFallbackReason(response.fallbackReason ?? null);
      const isInitialScreen = !modeLoadedRef.current[mode];
      // react-doctor-disable-next-line no-event-handler
      const suppressRender = shouldSuppressTextRender(mode, isUserScrollingRef.current);
      // The first stream frame replaces the blocking loading state and must not
      // be deferred behind later screen events. Subsequent updates stay in a
      // transition so continuous output does not interrupt interaction.
      applyTextResponse(response, suppressRender, isInitialScreen);
      // react-doctor-disable-next-line no-event-handler
      markCurrentModeLoaded();
      dispatchScreenLoading({ type: "finish", mode });
    },
    [
      acceptCurrentResponse,
      applyRefreshLifecycleAction,
      applyTextResponse,
      dispatchScreenLoading,
      isUserScrollingRef,
      markCurrentModeLoaded,
      mode,
      modeLoadedRef,
      modeSwitchRef,
      setError,
      setFallbackReason,
    ],
  );

  const { transport } = useScreenStream({
    // react-doctor-disable-next-line no-event-handler
    enabled: mode === "text" && connected,
    // react-doctor-disable-next-line no-event-handler
    paneId,
    // react-doctor-disable-next-line no-event-handler
    apiBasePath,
    // react-doctor-disable-next-line no-event-handler
    token,
    fallbackDelayMs: streamFallbackDelayMs,
    onScreenEvent: handleSseScreenEvent,
  });

  // When SSE transitions back to polling (close/reconnect), reset the cursor so
  // the next REST request fetches a full response rather than a stale delta.
  const prevTransportRef = useRef<ScreenStreamTransport>("polling");
  useEffect(() => {
    const prev = prevTransportRef.current;
    prevTransportRef.current = transport;
    if (prev === "sse" && transport !== "sse") {
      cursorRef.current = null;
    }
  }, [cursorRef, transport]);

  // False positive: initial and parameter-change screen loads are lifecycle IO,
  // not render-time data flowing back to the parent.
  useEffect(() => {
    // Text screens arrive through the stream. REST is reserved for image mode
    // and for polling fallback after the stream fails to connect.
    if (transport !== "polling") {
      return;
    }
    // react-doctor-disable-next-line no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
    void refreshScreen();
  }, [refreshScreen, transport]);

  // False positive: this reconciles connection lifecycle state owned by the
  // screen hook when the shared connection status changes.
  useEffect(() => {
    // react-doctor-disable-next-line no-event-handler, no-pass-data-to-parent
    if (!connected) {
      // react-doctor-disable-next-line no-pass-data-to-parent
      resetDisconnectedState(true);
      return;
    }
    if (error === DISCONNECTED_MESSAGE) {
      setError(null);
    }
  }, [connected, error, resetDisconnectedState, setError]);

  // Suspend REST polling while SSE is actively streaming text updates;
  // image mode always uses polling (SSE is text-only).
  useVisibilityPolling({
    enabled: Boolean(paneId) && connected && transport === "polling",
    intervalMs: resolveScreenPollIntervalMs(mode),
    shouldPoll: canPollScreen,
    onTick: pollScreen,
    onResume: pollScreen,
  });

  return {
    refreshScreen,
    error,
    setError,
    fallbackReason,
    pollingPauseReason,
    transport,
  };
};
