import type { ScreenResponse } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  getScreenCacheAtom,
  getScreenCacheErrorAtom,
  getScreenCacheLoadingAtom,
  type ScreenCacheEntry,
} from "../atoms/screenCacheAtoms";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";

type UseScreenCacheParams = {
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  mode?: "text" | "image";
  lines?: number;
  ttlMs?: number | null;
  cacheKey?: string;
  errorMessages?: {
    load: string;
    requestFailed: string;
  };
};

type FetchOptions = {
  force?: boolean;
  loading?: "always" | "if-empty";
  lines?: number;
};

type FetchRequestArgs = {
  paneId: string;
  options: FetchOptions;
  requestId: number;
};

const shouldUseCachedResponse = ({
  cached,
  options,
  ttlMs,
}: {
  cached: ScreenCacheEntry | undefined;
  options: FetchOptions;
  ttlMs: number | null;
}) => !options.force && ttlMs != null && cached != null && Date.now() - cached.updatedAt < ttlMs;

const shouldShowLoadingState = (options: FetchOptions, cached: ScreenCacheEntry | undefined) =>
  options.loading === "if-empty" ? !cached : true;

const buildScreenCacheEntry = (response: ScreenResponse): ScreenCacheEntry => ({
  screen: response.screen ?? "",
  capturedAt: response.capturedAt,
  truncated: response.truncated ?? null,
  updatedAt: Date.now(),
});

const resolveDisconnectedMessage = (connectionIssue: string | null) =>
  connectionIssue ?? DISCONNECTED_MESSAGE;

const resolveRequestLines = (options: FetchOptions, lines?: number) => options.lines ?? lines;

const resolveResponseErrorMessage = (response: ScreenResponse, fallback: string) =>
  response.error?.message ?? fallback;

const resolveThrownErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

const isLatestRequest = (
  latestRequests: Record<string, number>,
  paneId: string,
  requestId: number,
) => latestRequests[paneId] === requestId;

export const useScreenCache = ({
  connected,
  connectionIssue,
  requestScreen,
  mode = "text",
  lines,
  ttlMs = null,
  cacheKey = "default",
  errorMessages = {
    load: API_ERROR_MESSAGES.requestFailed,
    requestFailed: API_ERROR_MESSAGES.requestFailed,
  },
}: UseScreenCacheParams) => {
  const { load: loadErrorMessage, requestFailed: requestFailedMessage } = errorMessages;
  const [cache, setCache] = useAtom(getScreenCacheAtom(cacheKey));
  const [loading, setLoading] = useAtom(getScreenCacheLoadingAtom(cacheKey));
  const [error, setError] = useAtom(getScreenCacheErrorAtom(cacheKey));

  const cacheRef = useRef<Record<string, ScreenCacheEntry>>({});
  const inflightRef = useRef(new Set<string>());
  const requestIdRef = useRef(0);
  const latestRequestRef = useRef<Record<string, number>>({});

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const executeFetchRequest = useCallback(
    async ({ paneId, options, requestId }: FetchRequestArgs) => {
      try {
        const response = await requestScreen(paneId, {
          mode,
          lines: resolveRequestLines(options, lines),
        });
        if (!isLatestRequest(latestRequestRef.current, paneId, requestId)) {
          return;
        }
        if (!response.ok) {
          setError((prev) => ({
            ...prev,
            [paneId]: resolveResponseErrorMessage(response, loadErrorMessage),
          }));
          return;
        }
        setCache((prev) => ({
          ...prev,
          [paneId]: buildScreenCacheEntry(response),
        }));
      } catch (err) {
        if (!isLatestRequest(latestRequestRef.current, paneId, requestId)) {
          return;
        }
        setError((prev) => ({
          ...prev,
          [paneId]: resolveThrownErrorMessage(err, requestFailedMessage),
        }));
      } finally {
        inflightRef.current.delete(paneId);
        if (isLatestRequest(latestRequestRef.current, paneId, requestId)) {
          setLoading((prev) => ({ ...prev, [paneId]: false }));
        }
      }
    },
    [
      lines,
      loadErrorMessage,
      mode,
      requestFailedMessage,
      requestScreen,
      setCache,
      setError,
      setLoading,
    ],
  );

  const fetchScreen = useCallback(
    async (paneId: string, options: FetchOptions = {}) => {
      if (!paneId) return;
      if (!connected) {
        setError((prev) => ({
          ...prev,
          [paneId]: resolveDisconnectedMessage(connectionIssue),
        }));
        return;
      }
      if (inflightRef.current.has(paneId)) {
        return;
      }
      const cached = cacheRef.current[paneId];
      if (shouldUseCachedResponse({ cached, options, ttlMs })) {
        return;
      }
      inflightRef.current.add(paneId);
      const requestId = (requestIdRef.current += 1);
      latestRequestRef.current[paneId] = requestId;
      if (shouldShowLoadingState(options, cached)) {
        setLoading((prev) => ({ ...prev, [paneId]: true }));
      }
      setError((prev) => ({ ...prev, [paneId]: null }));
      await executeFetchRequest({ paneId, options, requestId });
    },
    [connected, connectionIssue, executeFetchRequest, setError, setLoading, ttlMs],
  );

  const clearCache = useCallback(
    (paneId?: string) => {
      if (!paneId) {
        cacheRef.current = {};
        inflightRef.current.clear();
        latestRequestRef.current = {};
        setCache({});
        setLoading({});
        setError({});
        return;
      }

      if (cacheRef.current[paneId]) {
        const nextCache = { ...cacheRef.current };
        delete nextCache[paneId];
        cacheRef.current = nextCache;
      }
      inflightRef.current.delete(paneId);
      latestRequestRef.current[paneId] = Number.MAX_SAFE_INTEGER;

      setCache((prev) => {
        if (!(paneId in prev)) return prev;
        const next = { ...prev };
        delete next[paneId];
        return next;
      });
      setLoading((prev) => {
        if (!(paneId in prev)) return prev;
        const next = { ...prev };
        delete next[paneId];
        return next;
      });
      setError((prev) => {
        if (!(paneId in prev)) return prev;
        const next = { ...prev };
        delete next[paneId];
        return next;
      });
    },
    [setCache, setError, setLoading],
  );

  return {
    cache,
    loading,
    error,
    fetchScreen,
    clearCache,
  };
};
