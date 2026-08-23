import type { SessionSummary } from "@vde-monitor/shared";
import { sessionsStreamEventSchema } from "@vde-monitor/shared";
import { useEffect, useEffectEvent, useRef } from "react";

import { createSseSubscription } from "@/lib/sse/sse-subscription";
import type { SseSubscription } from "@/lib/sse/sse-subscription";

export type SessionsStreamTransport = "sse" | "polling";

type UseSessionsStreamParams = {
  enabled: boolean;
  apiBaseUrl: string | null | undefined;
  token: string | null;
  onSnapshot: (sessions: SessionSummary[]) => void;
  onUpsert: (session: SessionSummary) => void;
  onRemove: (paneId: string) => void;
  onAuthError?: () => void;
  onTransportChange: (transport: SessionsStreamTransport) => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSessionsStream = ({
  enabled,
  apiBaseUrl,
  token,
  onSnapshot,
  onUpsert,
  onRemove,
  onAuthError,
  onTransportChange,
}: UseSessionsStreamParams): void => {
  const handleSnapshot = useEffectEvent(onSnapshot);
  const handleUpsert = useEffectEvent(onUpsert);
  const handleRemove = useEffectEvent(onRemove);
  const handleAuthError = useEffectEvent(() => {
    onAuthError?.();
  });
  const handleTransportChange = useEffectEvent(onTransportChange);
  const transportRef = useRef<SessionsStreamTransport>("polling");

  // Ref to the current subscription for force-reconnect from visibility handlers.
  const subRef = useRef<SseSubscription | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Subscription lifecycle — re-creates when enabled/token/apiBaseUrl changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || !token) {
      transportRef.current = "polling";
      handleTransportChange("polling");
      return;
    }

    const normalized = apiBaseUrl?.trim();
    const basePath = normalized && normalized.length > 0 ? normalized : "/api";
    const url = `${basePath}/streams/sessions`;
    const getHeaders = (): Record<string, string> => ({
      Authorization: `Bearer ${token}`,
    });

    const handleEvent = (event: { event?: string; data: string }) => {
      if (event.event !== "sessions") return;
      let parsed: ReturnType<typeof sessionsStreamEventSchema.safeParse> | null = null;
      try {
        parsed = sessionsStreamEventSchema.safeParse(JSON.parse(event.data) as unknown);
      } catch {
        return;
      }
      if (!parsed.success) return;
      const data = parsed.data;
      if (data.type === "snapshot") {
        handleSnapshot(data.sessions);
      } else if (data.type === "upsert") {
        handleUpsert(data.session);
      } else if (data.type === "remove") {
        handleRemove(data.paneId);
      }
    };

    const handleStateChange = (state: string) => {
      const next: SessionsStreamTransport = state === "open" ? "sse" : "polling";
      transportRef.current = next;
      handleTransportChange(next);
    };

    const createSub = (): SseSubscription =>
      createSseSubscription({
        url,
        getHeaders,
        onEvent: handleEvent,
        onStateChange: handleStateChange,
        onAuthError: handleAuthError,
      });

    let activeSubscription = createSub();
    subRef.current = activeSubscription;

    // Force-reconnect bypasses the internal backoff by closing and re-creating.
    reconnectRef.current = () => {
      activeSubscription.close();
      activeSubscription = createSub();
      subRef.current = activeSubscription;
    };

    return () => {
      activeSubscription.close();
      if (subRef.current === activeSubscription) {
        subRef.current = null;
        reconnectRef.current = null;
      }
      transportRef.current = "polling";
      handleTransportChange("polling");
    };
  }, [enabled, token, apiBaseUrl]);

  // ---------------------------------------------------------------------------
  // Visibility / online recovery — bypass backoff on page-focus or reconnect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleResume = () => {
      // If SSE is already open, nothing to do.
      if (transportRef.current === "sse") return;
      reconnectRef.current?.();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      handleResume();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleResume);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleResume);
    };
  }, [enabled]);
};
