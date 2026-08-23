import { screenResponseSchema } from "@vde-monitor/shared";
import type { ScreenResponse } from "@vde-monitor/shared";
import { useEffect, useEffectEvent, useState } from "react";

import { createSseSubscription } from "@/lib/sse/sse-subscription";
import type { SseState } from "@/lib/sse/sse-subscription";

export type ScreenStreamTransport = "connecting" | "sse" | "polling";

type ScreenStreamState = {
  key: string | null;
  state: SseState;
};

type UseScreenStreamParams = {
  enabled: boolean;
  paneId: string;
  apiBasePath: string;
  token: string | null;
  onScreenEvent: (response: ScreenResponse) => void;
  fallbackDelayMs?: number;
};

const DEFAULT_FALLBACK_DELAY_MS = 2_000;

export const useScreenStream = ({
  enabled,
  paneId,
  apiBasePath,
  token,
  onScreenEvent,
  fallbackDelayMs = DEFAULT_FALLBACK_DELAY_MS,
}: UseScreenStreamParams): { transport: ScreenStreamTransport } => {
  const streamKey = enabled && token && paneId ? `${apiBasePath}\0${paneId}\0${token}` : null;
  const [streamState, setStreamState] = useState<ScreenStreamState>({
    key: null,
    state: "closed",
  });
  const [screenEventKey, setScreenEventKey] = useState<string | null>(null);
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const handleScreenEvent = useEffectEvent(onScreenEvent);

  useEffect(() => {
    if (streamKey == null || screenEventKey === streamKey) {
      return;
    }
    const fallbackTimer = setTimeout(() => {
      setFallbackKey(streamKey);
    }, fallbackDelayMs);
    return () => clearTimeout(fallbackTimer);
  }, [fallbackDelayMs, screenEventKey, streamKey]);

  useEffect(() => {
    if (streamKey == null || !token) {
      return;
    }

    const url = `${apiBasePath}/streams/sessions/${encodeURIComponent(paneId)}/screen`;

    const sub = createSseSubscription({
      url,
      getHeaders: () => ({ Authorization: `Bearer ${token}` }),
      onStateChange: (state) => {
        setStreamState({ key: streamKey, state });
        if (state !== "open") {
          setScreenEventKey((current) => (current === streamKey ? null : current));
        }
      },
      onEvent: (event) => {
        if (event.event !== "screen") return;
        let parsed: ReturnType<typeof screenResponseSchema.safeParse>;
        try {
          parsed = screenResponseSchema.safeParse(JSON.parse(event.data));
        } catch {
          return;
        }
        if (!parsed.success) return;
        setScreenEventKey(streamKey);
        setFallbackKey((current) => (current === streamKey ? null : current));
        handleScreenEvent(parsed.data);
      },
    });

    return () => {
      sub.close();
    };
  }, [apiBasePath, paneId, streamKey, token]);

  if (streamKey == null) {
    return { transport: "polling" };
  }
  const sseState = streamState.key === streamKey ? streamState.state : "connecting";
  if (sseState === "open" && screenEventKey === streamKey && fallbackKey !== streamKey) {
    return { transport: "sse" };
  }
  if ((sseState === "connecting" || sseState === "open") && fallbackKey !== streamKey) {
    return { transport: "connecting" };
  }
  return { transport: "polling" };
};
