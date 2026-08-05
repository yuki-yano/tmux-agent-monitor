import { createSseParser } from "./parse-sse-stream";
import type { SseEvent } from "./parse-sse-stream";

export type { SseEvent };

export type SseState = "connecting" | "open" | "reconnecting" | "closed";

export type SseSubscriptionOptions = {
  url: string;
  getHeaders: () => Record<string, string>;
  lastEventId?: string | null;
  onEvent: (event: SseEvent) => void;
  onStateChange?: (state: SseState) => void;
  /** Called once on 401/403; the subscription closes and does NOT auto-retry. */
  onAuthError?: () => void;
  /** How long to wait without receiving any event before treating the connection
   *  as stale and reconnecting. Defaults to 45 000 ms. */
  heartbeatTimeoutMs?: number;
  /** When aborted the subscription closes immediately (same as calling close()). */
  signal?: AbortSignal;
};

export type SseSubscription = {
  close: () => void;
};

// ---------------------------------------------------------------------------
// Back-off parameters
// ---------------------------------------------------------------------------
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_FACTOR = 2;
/** Jitter band: ±20 % of the computed delay */
const BACKOFF_JITTER = 0.2;

const computeBackoffDelay = (attempt: number): number => {
  const base = Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempt, BACKOFF_MAX_MS);
  // Random value in [-jitter, +jitter] range
  const jitter = base * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.max(0, base + jitter);
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSseSubscription = (options: SseSubscriptionOptions): SseSubscription => {
  const { url, getHeaders, onEvent, onStateChange, onAuthError, signal: externalSignal } = options;

  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

  let lastEventId: string | undefined =
    options.lastEventId != null ? options.lastEventId : undefined;

  let isClosed = false;
  let reconnectAttempt = 0;
  let currentController: AbortController | null = null;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const setState = (state: SseState) => {
    onStateChange?.(state);
  };

  const clearHeartbeatTimer = () => {
    if (heartbeatTimer != null) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const abortCurrent = () => {
    // Explicitly cancel the reader so reader.read() resolves even in
    // environments where AbortController abort does not propagate to the body
    // reader (e.g. MSW node interceptors in tests).
    currentReader?.cancel().catch(() => {});
    currentController?.abort();
  };

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    clearHeartbeatTimer();
    clearReconnectTimer();
    abortCurrent();
    setState("closed");
  };

  const resetHeartbeatTimer = () => {
    clearHeartbeatTimer();
    if (isClosed) return;
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      // Abort the current connection; the connect loop will schedule a reconnect.
      if (!isClosed) {
        abortCurrent();
      }
    }, heartbeatTimeoutMs);
  };

  const scheduleReconnect = () => {
    if (isClosed) return;
    const delay = computeBackoffDelay(reconnectAttempt);
    reconnectAttempt++;
    setState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  // -------------------------------------------------------------------------
  // Core connection loop
  // -------------------------------------------------------------------------

  const connect = async () => {
    if (isClosed) return;

    const controller = new AbortController();
    currentController = controller;

    setState(reconnectAttempt === 0 ? "connecting" : "reconnecting");
    if (isClosed) return;

    try {
      const extraHeaders: Record<string, string> =
        lastEventId != null ? { "Last-Event-ID": lastEventId } : {};

      const response = await fetch(url, {
        headers: {
          ...getHeaders(),
          Accept: "text/event-stream",
          ...extraHeaders,
        },
        signal: controller.signal,
      });
      if (isClosed) return;

      // Auth failure: close permanently, notify caller
      if (response.status === 401 || response.status === 403) {
        isClosed = true;
        clearHeartbeatTimer();
        setState("closed");
        onAuthError?.();
        return;
      }

      if (!response.ok || response.body == null) {
        throw new Error(`SSE HTTP error: ${response.status}`);
      }
      if (isClosed) return;

      // Connection established
      setState("open");
      if (isClosed) return;
      reconnectAttempt = 0;
      resetHeartbeatTimer();

      currentReader = response.body.getReader();
      const reader = currentReader;
      const decoder = new TextDecoder();
      const parser = createSseParser((event) => {
        if (isClosed) return;
        // Keep the last event ID up to date for reconnect
        if (event.id != null) {
          lastEventId = event.id;
        }
        // Any received event (including heartbeat) resets the stale-connection timer
        resetHeartbeatTimer();
        onEvent(event);
      });

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (isClosed) break;
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        // Flush any multibyte sequence that was split across the last chunk
        if (!isClosed) {
          const remaining = decoder.decode();
          if (remaining) {
            parser.push(remaining);
          }
        }
      } finally {
        // Always clear the heartbeat timer when the read loop exits
        clearHeartbeatTimer();
        // reader.cancel() is a no-op if already done/cancelled; ignore errors
        reader.cancel().catch(() => {});
        currentReader = null;
      }
    } catch {
      // Network error, AbortError from heartbeat/close, or non-OK response
      clearHeartbeatTimer();
      currentReader = null;
    }

    // Schedule reconnect unless we closed intentionally
    scheduleReconnect();
  };

  // -------------------------------------------------------------------------
  // External signal wiring (done once at construction)
  // -------------------------------------------------------------------------

  if (externalSignal?.aborted === true) {
    // Already aborted before we even started — return a no-op subscription
    isClosed = true;
    return { close };
  }

  externalSignal?.addEventListener("abort", () => {
    close();
  });

  void connect();

  return { close };
};
