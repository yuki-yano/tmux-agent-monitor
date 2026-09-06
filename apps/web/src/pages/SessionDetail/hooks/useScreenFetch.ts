import type { ScreenResponse } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import {
  type Dispatch,
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import type { ScreenLoadingEvent, ScreenMode } from "@/lib/screen-loading";
import { resolveScreenPollIntervalMs } from "@/lib/screen-polling";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { screenErrorAtom, screenFallbackReasonAtom } from "../atoms/screenAtoms";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";
import type { ScreenContent } from "./screen-content";
import {
  type ScreenFetchLifecycleAction,
  type ScreenFetchLifecycleAttempt,
  initialScreenFetchLifecycleState,
  screenFetchLifecycleReducer,
} from "./screen-fetch-lifecycle";
import {
  type AppliedScreenResponse,
  type ScreenResponseContext,
  canAcceptScreenResponse,
  isCurrentScreenRequest,
} from "./screen-response-policy";
import { useScreenPollingPauseReason } from "./useScreenPollingPauseReason";
import { type ScreenStreamTransport, useScreenStream } from "./useScreenStream";

const buildScreenOptions = (mode: ScreenMode, cursor: string | null) => {
  const options: { mode: ScreenMode; cursor?: string } = { mode };
  if (mode === "text" && cursor) {
    options.cursor = cursor;
  }
  return options;
};

type UseScreenFetchParams = {
  paneId: string;
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  mode: ScreenMode;
  isUserScrolling: () => boolean;
  content: ScreenContent;
  modeLoadedRef: MutableRefObject<{ text: boolean; image: boolean }>;
  modeSwitchRef: MutableRefObject<ScreenMode | null>;
  dispatchScreenLoading: Dispatch<ScreenLoadingEvent>;
  onModeLoaded: (mode: ScreenMode) => void;
  /** Base path for API calls (e.g. "/api" or "https://host/api"). Defaults to "/api". */
  apiBasePath?: string;
  /** Bearer token for SSE authentication. SSE is disabled when null. */
  token?: string | null;
  /** Initial SSE screen deadline before REST polling takes over. */
  streamFallbackDelayMs?: number;
};

export const useScreenFetch = ({
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
  onModeLoaded,
  apiBasePath = "/api",
  token = null,
  streamFallbackDelayMs,
}: UseScreenFetchParams) => {
  const [fallbackReason, setFallbackReason] = useAtom(screenFallbackReasonAtom);
  const [error, setError] = useAtom(screenErrorAtom);
  const screenContextKey = `${paneId}\0${mode}`;
  const currentContextRef = useRef<ScreenResponseContext>({
    key: screenContextKey,
    paneId,
    mode,
  });
  const refreshLifecycleRef = useRef(initialScreenFetchLifecycleState);
  useLayoutEffect(() => {
    currentContextRef.current = { key: screenContextKey, paneId, mode };
    return () => {
      currentContextRef.current = { key: "", paneId: "", mode };
      refreshLifecycleRef.current = screenFetchLifecycleReducer(refreshLifecycleRef.current, {
        type: "reset",
      });
    };
  }, [mode, paneId, screenContextKey]);
  const pollingPauseReason = useScreenPollingPauseReason({
    connected,
    connectionIssue,
  });
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
    if (!canAcceptScreenResponse(response, currentContext, latestAppliedResponseRef.current)) {
      return false;
    }

    if (response.ok) {
      latestAppliedResponseRef.current = {
        contextKey: currentContext.key,
        capturedAtMs: Date.parse(response.capturedAt),
      };
    }
    return true;
  }, []);

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
    const hasCurrentData = content.hasContent(mode);
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
    content,
    mode,
    modeLoadedRef,
    modeSwitchRef,
    screenContextKey,
    setError,
  ]);

  const applyRefreshResponse = useCallback(
    (response: ScreenResponse, immediateCommit: boolean) => {
      if (!acceptCurrentResponse(response)) {
        return;
      }
      if (!response.ok) {
        setError(response.error?.message ?? API_ERROR_MESSAGES.screenCapture);
        return;
      }
      setFallbackReason(response.fallbackReason ?? null);
      content.applyResponse(response, {
        isUserScrolling: isUserScrolling(),
        immediate: immediateCommit,
      });
      markCurrentModeLoaded();
    },
    [
      acceptCurrentResponse,
      content,
      isUserScrolling,
      markCurrentModeLoaded,
      setError,
      setFallbackReason,
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
    const requestBasis = {
      requestId: attempt.requestId,
      contextKey: attempt.contextKey,
      sseGeneration: sseGenerationRef.current,
      cursor: content.getCursor(),
    };
    const isCurrentAttempt = () =>
      isCurrentScreenRequest(requestBasis, {
        requestId: refreshLifecycleRef.current.inFlight?.id ?? null,
        contextKey: currentContextRef.current.key,
        sseGeneration: sseGenerationRef.current,
        cursor: content.getCursor(),
      });
    try {
      const response = await requestScreen(paneId, buildScreenOptions(mode, requestBasis.cursor));
      if (!isCurrentAttempt()) {
        return;
      }
      applyRefreshResponse(response, attempt.shouldShowLoading);
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
    content,
    finishRefreshAttempt,
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
      // The first stream frame replaces the blocking loading state and must not
      // be deferred behind later screen events. Subsequent updates stay in a
      // transition so continuous output does not interrupt interaction.
      content.applyResponse(response, {
        isUserScrolling: isUserScrolling(),
        immediate: isInitialScreen,
      });
      markCurrentModeLoaded();
      dispatchScreenLoading({ type: "finish", mode });
    },
    [
      acceptCurrentResponse,
      applyRefreshLifecycleAction,
      content,
      dispatchScreenLoading,
      isUserScrolling,
      markCurrentModeLoaded,
      mode,
      modeLoadedRef,
      modeSwitchRef,
      setError,
      setFallbackReason,
    ],
  );

  const { transport } = useScreenStream({
    enabled: mode === "text" && connected,
    paneId,
    apiBasePath,
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
      content.invalidateCursor();
    }
  }, [content, transport]);

  // False positive: initial and parameter-change screen loads are lifecycle IO,
  // not render-time data flowing back to the parent.
  useEffect(() => {
    // Text screens arrive through the stream. REST is reserved for image mode
    // and for polling fallback after the stream fails to connect.
    if (transport !== "polling") {
      return;
    }
    // react-doctor-disable-next-line no-pass-live-state-to-parent
    void refreshScreen();
  }, [refreshScreen, transport]);

  // False positive: this reconciles connection lifecycle state owned by the
  // screen hook when the shared connection status changes.
  useEffect(() => {
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
