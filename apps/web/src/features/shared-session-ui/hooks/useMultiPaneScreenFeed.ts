import type { ScreenResponse } from "@vde-monitor/shared";
import { useCallback, useEffect, useMemo } from "react";

import { findStalePaneIds } from "@/features/shared-session-ui/model/pane-record-utils";
import { useVisibilityPolling } from "@/lib/use-visibility-polling";

import { useScreenCache } from "./useScreenCache";

type PaneFetchOptions = {
  force?: boolean;
  loading?: "always" | "if-empty";
  lines?: number;
};

type UseMultiPaneScreenFeedParams = {
  paneIds: string[];
  retainedPaneIds?: string[];
  enabled: boolean;
  connected: boolean;
  connectionIssue: string | null;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  intervalMs?: number;
  concurrency?: number;
  lines?: number;
  ttlMs?: number | null;
  cacheKey?: string;
  errorMessages?: {
    load: string;
    requestFailed: string;
  };
  shouldPoll?: () => boolean;
  fetchOnMount?: boolean;
};

const normalizePaneIds = (paneIds: string[]) =>
  Array.from(new Set(paneIds.filter((paneId) => paneId.length > 0)));

const splitPaneIdSignature = (signature: string) =>
  signature.length > 0 ? signature.split("\u0000") : [];

const resolveConcurrency = (concurrency: number | undefined) =>
  Math.max(1, Math.floor(concurrency ?? 2));

const fetchPaneIdsInBatches = async ({
  paneIds,
  concurrency,
  fetchPane,
}: {
  paneIds: string[];
  concurrency: number;
  fetchPane: (paneId: string) => Promise<void>;
}) => {
  for (let start = 0; start < paneIds.length; start += concurrency) {
    const batch = paneIds.slice(start, start + concurrency);
    // False positive: batches are intentionally sequential to enforce concurrency.
    await Promise.all(batch.map((paneId) => fetchPane(paneId)));
  }
};

export const useMultiPaneScreenFeed = ({
  paneIds,
  retainedPaneIds,
  enabled,
  connected,
  connectionIssue,
  requestScreen,
  intervalMs = 2000,
  concurrency = 2,
  lines,
  ttlMs = null,
  cacheKey = "default",
  errorMessages,
  shouldPoll,
  fetchOnMount = true,
}: UseMultiPaneScreenFeedParams) => {
  const paneIdsSignature = paneIds.join("\u0000");
  const normalizedPaneIds = useMemo(
    () => normalizePaneIds(splitPaneIdSignature(paneIdsSignature)),
    [paneIdsSignature],
  );
  const retainedPaneIdsSignature = (retainedPaneIds ?? normalizedPaneIds).join("\u0000");
  const normalizedRetainedPaneIds = useMemo(
    () => normalizePaneIds(splitPaneIdSignature(retainedPaneIdsSignature)),
    [retainedPaneIdsSignature],
  );

  const { cache, loading, error, fetchScreen, clearCache } = useScreenCache({
    connected,
    connectionIssue,
    requestScreen,
    lines,
    ttlMs,
    cacheKey,
    errorMessages,
  });

  const fetchPane = useCallback(
    async (paneId: string, options: PaneFetchOptions = {}) => {
      await fetchScreen(paneId, options);
    },
    [fetchScreen],
  );

  const pollNow = useCallback(async () => {
    if (normalizedPaneIds.length === 0) {
      return;
    }
    await fetchPaneIdsInBatches({
      paneIds: normalizedPaneIds,
      concurrency: resolveConcurrency(concurrency),
      fetchPane: (paneId) => fetchPane(paneId, { loading: "if-empty" }),
    });
  }, [concurrency, fetchPane, normalizedPaneIds]);

  const canPoll = useCallback(() => {
    if (!enabled) {
      return false;
    }
    if (!shouldPoll) {
      return true;
    }
    return shouldPoll();
  }, [enabled, shouldPoll]);

  useVisibilityPolling({
    enabled: enabled && normalizedPaneIds.length > 0,
    intervalMs,
    shouldPoll: canPoll,
    onTick: () => {
      void pollNow();
    },
    onResume: () => {
      void pollNow();
    },
  });

  useEffect(() => {
    if (!fetchOnMount || !canPoll() || normalizedPaneIds.length === 0) {
      return;
    }
    void pollNow();
  }, [canPoll, fetchOnMount, normalizedPaneIds.length, pollNow]);

  useEffect(() => {
    const activePaneIds = new Set(normalizedRetainedPaneIds);
    const stalePaneIds = findStalePaneIds(
      {
        ...cache,
        ...loading,
        ...error,
      },
      activePaneIds,
    );
    stalePaneIds.forEach((paneId) => {
      clearCache(paneId);
    });
  }, [cache, clearCache, error, loading, normalizedRetainedPaneIds]);

  return {
    cache,
    loading,
    error,
    fetchPane,
    pollNow,
    clearPane: clearCache,
  };
};
