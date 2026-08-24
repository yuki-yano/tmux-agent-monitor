import type { ScreenResponse } from "@vde-monitor/shared";
import { useAtom, useStore } from "jotai";
import { useCallback, useLayoutEffect, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveResultErrorMessage, resolveUnknownErrorMessage } from "@/lib/api-utils";
import { useLazyRef } from "@/lib/use-lazy-ref";

import {
  type ScreenCacheEntry,
  getScreenCacheAtom,
  getScreenCacheErrorAtom,
  getScreenCacheLoadingAtom,
} from "../atoms/screenCacheAtoms";

const DISCONNECTED_MESSAGE = "Disconnected. Reconnecting...";

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
  requestOwner: symbol;
};

type ScreenCacheStore = ReturnType<typeof useStore>;

const loadingRequestOwners = new WeakMap<ScreenCacheStore, Map<string, symbol>>();

const getLoadingRequestOwners = (store: ScreenCacheStore) => {
  const existing = loadingRequestOwners.get(store);
  if (existing) {
    return existing;
  }
  const created = new Map<string, symbol>();
  loadingRequestOwners.set(store, created);
  return created;
};

const buildLoadingOwnerKey = (cacheKey: string, paneId: string) => `${cacheKey}\0${paneId}`;

const isCurrentLoadingOwner = (
  store: ScreenCacheStore,
  cacheKey: string,
  paneId: string,
  requestOwner: symbol,
) => getLoadingRequestOwners(store).get(buildLoadingOwnerKey(cacheKey, paneId)) === requestOwner;

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
  const store = useStore();

  const cacheRef = useRef<Record<string, ScreenCacheEntry>>({});
  const inflightRef = useLazyRef(() => new Set<string>());
  const ownedLoadingRequestsRef = useLazyRef(() => new Map<string, symbol>());
  const requestIdRef = useRef(0);
  const latestRequestRef = useRef<Record<string, number>>({});
  const activeRef = useRef(true);

  useLayoutEffect(() => {
    activeRef.current = true;
    cacheRef.current = cache;
    const ownedLoadingRequests = ownedLoadingRequestsRef.current;

    return () => {
      activeRef.current = false;
      const ownedRequests = [...ownedLoadingRequests];
      queueMicrotask(() => {
        // React Strict Mode and cache updates replay this lifecycle on the same mount.
        // Only a mount that stayed inactive may release its global loading ownership.
        if (activeRef.current) {
          return;
        }
        const owners = getLoadingRequestOwners(store);
        const releasedPaneIds = ownedRequests.flatMap(([paneId, requestOwner]) => {
          const ownerKey = buildLoadingOwnerKey(cacheKey, paneId);
          if (owners.get(ownerKey) !== requestOwner) {
            return [];
          }
          owners.delete(ownerKey);
          return [paneId];
        });
        if (releasedPaneIds.length === 0) {
          return;
        }
        setLoading((prev) => {
          const next = { ...prev };
          for (const paneId of releasedPaneIds) {
            next[paneId] = false;
          }
          return next;
        });
      });
    };
  }, [cache, cacheKey, ownedLoadingRequestsRef, setLoading, store]);

  const executeFetchRequest = useCallback(
    async ({ paneId, options, requestId, requestOwner }: FetchRequestArgs) => {
      try {
        const response = await requestScreen(paneId, {
          mode,
          lines: resolveRequestLines(options, lines),
        });
        if (
          !activeRef.current ||
          !isLatestRequest(latestRequestRef.current, paneId, requestId) ||
          !isCurrentLoadingOwner(store, cacheKey, paneId, requestOwner)
        ) {
          return;
        }
        if (!response.ok) {
          setError((prev) => ({
            ...prev,
            [paneId]: resolveResultErrorMessage(response, loadErrorMessage),
          }));
          return;
        }
        setCache((prev) => ({
          ...prev,
          [paneId]: buildScreenCacheEntry(response),
        }));
      } catch (err) {
        if (
          !activeRef.current ||
          !isLatestRequest(latestRequestRef.current, paneId, requestId) ||
          !isCurrentLoadingOwner(store, cacheKey, paneId, requestOwner)
        ) {
          return;
        }
        setError((prev) => ({
          ...prev,
          [paneId]: resolveUnknownErrorMessage(err, requestFailedMessage),
        }));
      } finally {
        inflightRef.current.delete(paneId);
        if (ownedLoadingRequestsRef.current.get(paneId) === requestOwner) {
          ownedLoadingRequestsRef.current.delete(paneId);
        }
        const owners = getLoadingRequestOwners(store);
        const ownerKey = buildLoadingOwnerKey(cacheKey, paneId);
        if (owners.get(ownerKey) === requestOwner) {
          owners.delete(ownerKey);
          setLoading((prev) => ({ ...prev, [paneId]: false }));
        }
      }
    },
    [
      lines,
      cacheKey,
      inflightRef,
      loadErrorMessage,
      mode,
      ownedLoadingRequestsRef,
      requestFailedMessage,
      requestScreen,
      setCache,
      setError,
      setLoading,
      store,
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
      const requestOwner = Symbol(paneId);
      latestRequestRef.current[paneId] = requestId;
      ownedLoadingRequestsRef.current.set(paneId, requestOwner);
      getLoadingRequestOwners(store).set(buildLoadingOwnerKey(cacheKey, paneId), requestOwner);
      if (shouldShowLoadingState(options, cached)) {
        setLoading((prev) => ({ ...prev, [paneId]: true }));
      }
      setError((prev) => ({ ...prev, [paneId]: null }));
      await executeFetchRequest({ paneId, options, requestId, requestOwner });
    },
    [
      cacheKey,
      connected,
      connectionIssue,
      executeFetchRequest,
      inflightRef,
      ownedLoadingRequestsRef,
      setError,
      setLoading,
      store,
      ttlMs,
    ],
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
    [inflightRef, setCache, setError, setLoading],
  );

  return {
    cache,
    loading,
    error,
    fetchScreen,
    clearCache,
  };
};
