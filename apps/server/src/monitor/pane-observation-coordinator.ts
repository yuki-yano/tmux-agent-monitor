import type { TextCaptureOptions, TextCaptureResult } from "@vde-monitor/shared";

export const OBSERVATION_COALESCING_WINDOW_MS = 10;
export const OBSERVATION_MAX_PENDING_REQUESTS = 128;
export const OBSERVATION_MAX_BATCH_SIZE = 64;
export const OBSERVATION_CAPTURE_TIMEOUT_MS = 5000;
export const OBSERVATION_RECONCILIATION_INTERVAL_MS = 5000;

export type PaneObservationRevision = {
  currentRevision: number;
  lastDirtyAt: number;
  lastReconciledAt: number;
};

export type PaneObservationCapturePurpose = "screen" | "fingerprint";
export type PaneObservationCapturePriority = "foreground" | "background";

export type PaneObservationCaptureRequest = {
  requestId: string;
  purpose: PaneObservationCapturePurpose;
  revision: number;
  options: TextCaptureOptions;
};

export type PaneObservationCaptureResult = {
  requestId: string;
  result?: TextCaptureResult;
  error?: string;
};

export type PaneObservationBatchExecutor = (
  requests: PaneObservationCaptureRequest[],
  signal: AbortSignal,
) => Promise<PaneObservationCaptureResult[]>;

export type PaneObservationDirtySource =
  | "pipe"
  | "hook"
  | "herdr"
  | "metadata"
  | "send"
  | "focus"
  | "subscriber";

export type PaneObservationDiagnosticEvent =
  | {
      type: "dirty";
      paneId: string;
      revision: number;
      source: PaneObservationDirtySource;
      at: number;
    }
  | {
      type: "capture-enqueued";
      paneId: string;
      purpose: PaneObservationCapturePurpose;
      revision: number;
      priority: PaneObservationCapturePriority;
      reconciliation: boolean;
      at: number;
    }
  | {
      type: "capture-cache-hit" | "capture-deduplicated";
      paneId: string;
      purpose: PaneObservationCapturePurpose;
      revision: number;
      at: number;
    }
  | {
      type: "capture-dropped";
      paneId: string;
      purpose: PaneObservationCapturePurpose;
      revision: number;
      priority: PaneObservationCapturePriority;
      reason: "queue-overflow";
      at: number;
    }
  | {
      type: "capture-requeued";
      paneId: string;
      purpose: PaneObservationCapturePurpose;
      fromRevision: number;
      toRevision: number;
      at: number;
    }
  | {
      type: "batch-started" | "batch-completed" | "batch-timeout";
      batchId: number;
      requestCount: number;
      at: number;
    }
  | {
      type: "capture-completed";
      paneId: string;
      purpose: PaneObservationCapturePurpose;
      revision: number;
      reconciliation: boolean;
      latencyMs: number;
      at: number;
    }
  | {
      type: "capture-failed";
      paneId: string;
      purpose: PaneObservationCapturePurpose;
      revision: number;
      reason: string;
      at: number;
    };

export type PaneObservationDiagnostics = {
  captureRequests: number;
  cacheHits: number;
  deduplicatedRequests: number;
  enqueuedRequests: number;
  backgroundDrops: number;
  foregroundOverflowErrors: number;
  batchesStarted: number;
  batchesCompleted: number;
  batchesTimedOut: number;
  executorRequests: number;
  capturesCompleted: number;
  capturesFailed: number;
  capturesRequeued: number;
  reconciliations: number;
  queuedRequests: number;
  inFlightRequests: number;
  batchRunning: boolean;
};

export type PaneObservationMetadata = {
  paneActivity: number | null;
  alternateOn: boolean;
  currentCommand: string | null;
};

export type PaneObservationCaptureErrorCode =
  | "QUEUE_OVERFLOW"
  | "CAPTURE_TIMEOUT"
  | "CAPTURE_FAILED"
  | "PANE_REMOVED"
  | "COORDINATOR_DISPOSED";

export class PaneObservationCaptureError extends Error {
  readonly code: PaneObservationCaptureErrorCode;

  constructor(code: PaneObservationCaptureErrorCode, message: string) {
    super(message);
    this.name = "PaneObservationCaptureError";
    this.code = code;
  }
}

type CaptureInput = {
  purpose: PaneObservationCapturePurpose;
  options: TextCaptureOptions;
  priority: PaneObservationCapturePriority;
};

type Deferred = {
  promise: Promise<TextCaptureResult | null>;
  resolve: (result: TextCaptureResult | null) => void;
  reject: (error: unknown) => void;
  settled: boolean;
};

type CaptureEntry = {
  identityKey: string;
  captureKey: string;
  requestId: string;
  purpose: PaneObservationCapturePurpose;
  options: TextCaptureOptions;
  paneId: string;
  revision: number;
  priority: PaneObservationCapturePriority;
  reconciliation: boolean;
  enqueuedAt: number;
  deferred: Deferred;
  followers: Deferred[];
  cancelled: boolean;
};

type CacheEntry = {
  paneId: string;
  revision: number;
  capturedAt: number;
  promise: Promise<TextCaptureResult>;
};

const createDeferred = (): Deferred => {
  let resolvePromise: (result: TextCaptureResult | null) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<TextCaptureResult | null>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const deferred: Deferred = {
    promise,
    settled: false,
    resolve: (result) => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise(result);
    },
    reject: (error) => {
      if (deferred.settled) return;
      deferred.settled = true;
      rejectPromise(error);
    },
  };
  return deferred;
};

const optionalValue = <T>(value: T | undefined): ["unset"] | ["set", T] =>
  value === undefined ? ["unset"] : ["set", value];

export const createPaneObservationCaptureKey = ({
  purpose,
  options,
}: {
  purpose: PaneObservationCapturePurpose;
  options: TextCaptureOptions;
}) =>
  JSON.stringify([
    purpose,
    options.paneId,
    options.lines,
    options.joinLines,
    options.includeAnsi,
    optionalValue(options.includeTruncated),
    options.altScreen,
    options.alternateOn,
    optionalValue(options.currentCommand),
  ]);

const createInitialRevision = (): PaneObservationRevision => ({
  currentRevision: 0,
  lastDirtyAt: 0,
  lastReconciledAt: 0,
});

const createInitialDiagnostics = (): Omit<
  PaneObservationDiagnostics,
  "queuedRequests" | "inFlightRequests" | "batchRunning"
> => ({
  captureRequests: 0,
  cacheHits: 0,
  deduplicatedRequests: 0,
  enqueuedRequests: 0,
  backgroundDrops: 0,
  foregroundOverflowErrors: 0,
  batchesStarted: 0,
  batchesCompleted: 0,
  batchesTimedOut: 0,
  executorRequests: 0,
  capturesCompleted: 0,
  capturesFailed: 0,
  capturesRequeued: 0,
  reconciliations: 0,
});

const asCaptureError = (message: string) =>
  new PaneObservationCaptureError("CAPTURE_FAILED", message);

const createCaptureTimeoutError = () =>
  new PaneObservationCaptureError(
    "CAPTURE_TIMEOUT",
    `observation capture batch timed out after ${OBSERVATION_CAPTURE_TIMEOUT_MS}ms`,
  );

export const createPaneObservationCoordinator = ({
  executeBatch,
  now = () => Date.now(),
  onDiagnostic,
}: {
  executeBatch: PaneObservationBatchExecutor;
  now?: () => number;
  onDiagnostic?: (event: PaneObservationDiagnosticEvent) => void;
}) => {
  const revisions = new Map<string, PaneObservationRevision>();
  const metadataByPaneId = new Map<string, PaneObservationMetadata>();
  const cache = new Map<string, CacheEntry>();
  const queuedEntries = new Map<string, CaptureEntry>();
  const pendingEntries = new Map<string, CaptureEntry>();
  const activeEntries = new Set<CaptureEntry>();
  const counters = createInitialDiagnostics();
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let batchRunning = false;
  let disposed = false;
  let requestSequence = 0;
  let batchSequence = 0;

  const emit = (event: PaneObservationDiagnosticEvent) => {
    onDiagnostic?.(event);
  };

  const ensureRevision = (paneId: string) => {
    let revision = revisions.get(paneId);
    if (!revision) {
      revision = createInitialRevision();
      revisions.set(paneId, revision);
    }
    return revision;
  };

  const settleEntry = (entry: CaptureEntry, settle: (deferred: Deferred) => void): void => {
    settle(entry.deferred);
    entry.followers.forEach(settle);
  };

  const rejectEntry = (entry: CaptureEntry, error: unknown): void => {
    settleEntry(entry, (deferred) => deferred.reject(error));
  };

  const resolveEntry = (entry: CaptureEntry, result: TextCaptureResult | null): void => {
    settleEntry(entry, (deferred) => deferred.resolve(result));
  };

  const createIdentityKey = (captureKey: string, revision: number) =>
    `${captureKey}\nrevision:${revision}`;

  const deletePendingEntry = (entry: CaptureEntry): void => {
    if (pendingEntries.get(entry.identityKey) === entry) {
      pendingEntries.delete(entry.identityKey);
    }
  };

  const dropForOverflow = (entry: CaptureEntry): void => {
    const at = now();
    emit({
      type: "capture-dropped",
      paneId: entry.paneId,
      purpose: entry.purpose,
      revision: entry.revision,
      priority: entry.priority,
      reason: "queue-overflow",
      at,
    });
    if (entry.priority === "background") {
      counters.backgroundDrops += 1;
      resolveEntry(entry, null);
      return;
    }
    counters.foregroundOverflowErrors += 1;
    rejectEntry(
      entry,
      new PaneObservationCaptureError(
        "QUEUE_OVERFLOW",
        `observation capture queue is full for pane ${entry.paneId}`,
      ),
    );
  };

  const enqueueEntry = (entry: CaptureEntry): boolean => {
    const existing = pendingEntries.get(entry.identityKey);
    if (existing) {
      existing.followers.push(entry.deferred, ...entry.followers);
      if (entry.priority === "foreground") {
        existing.priority = "foreground";
      }
      return true;
    }
    if (pendingEntries.size >= OBSERVATION_MAX_PENDING_REQUESTS) {
      dropForOverflow(entry);
      return false;
    }
    queuedEntries.set(entry.identityKey, entry);
    pendingEntries.set(entry.identityKey, entry);
    counters.enqueuedRequests += 1;
    emit({
      type: "capture-enqueued",
      paneId: entry.paneId,
      purpose: entry.purpose,
      revision: entry.revision,
      priority: entry.priority,
      reconciliation: entry.reconciliation,
      at: entry.enqueuedAt,
    });
    return true;
  };

  const scheduleDrain = (): void => {
    if (disposed || batchRunning || drainTimer !== null || queuedEntries.size === 0) return;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      void drainQueue();
    }, OBSERVATION_COALESCING_WINDOW_MS);
  };

  const requeueForCurrentRevision = (entry: CaptureEntry): void => {
    const currentRevision = ensureRevision(entry.paneId).currentRevision;
    counters.capturesRequeued += 1;
    emit({
      type: "capture-requeued",
      paneId: entry.paneId,
      purpose: entry.purpose,
      fromRevision: entry.revision,
      toRevision: currentRevision,
      at: now(),
    });
    const identityKey = createIdentityKey(entry.captureKey, currentRevision);
    const requeued: CaptureEntry = {
      ...entry,
      identityKey,
      requestId: `capture-${++requestSequence}`,
      revision: currentRevision,
      reconciliation: false,
      enqueuedAt: now(),
    };
    enqueueEntry(requeued);
  };

  const requeueQueuedEntriesForPane = (paneId: string): void => {
    const staleEntries = [...queuedEntries.values()].filter(
      (entry) => entry.paneId === paneId && entry.purpose === "fingerprint",
    );
    for (const entry of staleEntries) {
      queuedEntries.delete(entry.identityKey);
      deletePendingEntry(entry);
      requeueForCurrentRevision(entry);
    }
  };

  const handleBatchResults = (
    entries: CaptureEntry[],
    results: PaneObservationCaptureResult[],
  ): void => {
    const resultByRequestId = new Map(results.map((result) => [result.requestId, result]));
    for (const entry of entries) {
      activeEntries.delete(entry);
      deletePendingEntry(entry);
      if (entry.cancelled) continue;
      const currentRevision = ensureRevision(entry.paneId).currentRevision;
      // Fingerprints drive monitor state and must match the latest pane revision.
      // Screens are user-facing snapshots: deliver the captured frame immediately
      // and let the next stream tick follow output that arrived during capture.
      if (currentRevision !== entry.revision && entry.purpose === "fingerprint") {
        requeueForCurrentRevision(entry);
        continue;
      }

      const captured = resultByRequestId.get(entry.requestId);
      if (!captured?.result || captured.error != null) {
        const reason = captured?.error ?? "capture executor returned no result";
        counters.capturesFailed += 1;
        emit({
          type: "capture-failed",
          paneId: entry.paneId,
          purpose: entry.purpose,
          revision: entry.revision,
          reason,
          at: now(),
        });
        rejectEntry(entry, asCaptureError(reason));
        continue;
      }

      const capturedAt = now();
      const promise = Promise.resolve(captured.result);
      cache.set(entry.captureKey, {
        paneId: entry.paneId,
        revision: entry.revision,
        capturedAt,
        promise,
      });
      if (currentRevision === entry.revision) {
        ensureRevision(entry.paneId).lastReconciledAt = capturedAt;
      }
      counters.capturesCompleted += 1;
      emit({
        type: "capture-completed",
        paneId: entry.paneId,
        purpose: entry.purpose,
        revision: entry.revision,
        reconciliation: entry.reconciliation,
        latencyMs: capturedAt - entry.enqueuedAt,
        at: capturedAt,
      });
      resolveEntry(entry, captured.result);
    }
  };

  const handleBatchFailure = (entries: CaptureEntry[], error: unknown): void => {
    const captureError =
      error instanceof PaneObservationCaptureError
        ? error
        : asCaptureError(error instanceof Error ? error.message : "capture batch failed");
    const isTimeout = captureError.code === "CAPTURE_TIMEOUT";
    for (const entry of entries) {
      activeEntries.delete(entry);
      deletePendingEntry(entry);
      if (entry.cancelled) continue;
      const currentRevision = ensureRevision(entry.paneId).currentRevision;
      if (
        currentRevision !== entry.revision &&
        entry.purpose === "fingerprint" &&
        (!isTimeout || entry.priority === "background")
      ) {
        requeueForCurrentRevision(entry);
        continue;
      }
      counters.capturesFailed += 1;
      emit({
        type: "capture-failed",
        paneId: entry.paneId,
        purpose: entry.purpose,
        revision: entry.revision,
        reason: captureError.message,
        at: now(),
      });
      rejectEntry(entry, captureError);
    }
  };

  const drainQueue = async (): Promise<void> => {
    if (disposed || batchRunning || queuedEntries.size === 0) return;
    batchRunning = true;
    const entries = [...queuedEntries.values()].slice(0, OBSERVATION_MAX_BATCH_SIZE);
    entries.forEach((entry) => {
      queuedEntries.delete(entry.identityKey);
      activeEntries.add(entry);
    });
    const batchId = ++batchSequence;
    const startedAt = now();
    counters.batchesStarted += 1;
    counters.executorRequests += entries.length;
    emit({ type: "batch-started", batchId, requestCount: entries.length, at: startedAt });

    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    timeout = setTimeout(() => {
      timedOut = true;
      const timeoutError = createCaptureTimeoutError();
      entries.forEach((entry) => {
        if (entry.priority === "foreground") {
          rejectEntry(entry, timeoutError);
        }
      });
      abortController.abort();
    }, OBSERVATION_CAPTURE_TIMEOUT_MS);

    try {
      const requests = entries.map(({ requestId, purpose, revision, options }) => ({
        requestId,
        purpose,
        revision,
        options,
      }));
      const results = await executeBatch(requests, abortController.signal);
      if (timedOut) {
        throw createCaptureTimeoutError();
      }
      handleBatchResults(entries, results);
      counters.batchesCompleted += 1;
      emit({ type: "batch-completed", batchId, requestCount: entries.length, at: now() });
    } catch (error) {
      if (timedOut) {
        counters.batchesTimedOut += 1;
        emit({ type: "batch-timeout", batchId, requestCount: entries.length, at: now() });
      }
      handleBatchFailure(entries, timedOut ? createCaptureTimeoutError() : error);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      batchRunning = false;
      scheduleDrain();
    }
  };

  const requestCapture = ({ purpose, options, priority }: CaptureInput) => {
    counters.captureRequests += 1;
    if (disposed) {
      return Promise.reject<TextCaptureResult | null>(
        new PaneObservationCaptureError(
          "COORDINATOR_DISPOSED",
          "observation coordinator has been disposed",
        ),
      );
    }

    const captureKey = createPaneObservationCaptureKey({ purpose, options });
    const paneRevision = ensureRevision(options.paneId);
    const revision = paneRevision.currentRevision;
    const identityKey = createIdentityKey(captureKey, revision);
    const cached = cache.get(captureKey);
    const requestedAt = now();
    if (
      cached?.revision === revision &&
      requestedAt - cached.capturedAt < OBSERVATION_RECONCILIATION_INTERVAL_MS
    ) {
      counters.cacheHits += 1;
      emit({
        type: "capture-cache-hit",
        paneId: options.paneId,
        purpose,
        revision,
        at: requestedAt,
      });
      return cached.promise;
    }

    const pending = pendingEntries.get(identityKey);
    if (pending) {
      counters.deduplicatedRequests += 1;
      if (priority === "foreground") {
        pending.priority = "foreground";
      }
      emit({
        type: "capture-deduplicated",
        paneId: options.paneId,
        purpose,
        revision,
        at: requestedAt,
      });
      return pending.deferred.promise;
    }

    const reconciliation = cached?.revision === revision;
    if (reconciliation) {
      counters.reconciliations += 1;
    }
    const deferred = createDeferred();
    const entry: CaptureEntry = {
      identityKey,
      captureKey,
      requestId: `capture-${++requestSequence}`,
      purpose,
      options: { ...options },
      paneId: options.paneId,
      revision,
      priority,
      reconciliation,
      enqueuedAt: requestedAt,
      deferred,
      followers: [],
      cancelled: false,
    };
    enqueueEntry(entry);
    scheduleDrain();
    return deferred.promise;
  };

  const markDirty = (paneId: string, source: PaneObservationDirtySource) => {
    const revision = ensureRevision(paneId);
    revision.currentRevision += 1;
    revision.lastDirtyAt = now();
    emit({
      type: "dirty",
      paneId,
      revision: revision.currentRevision,
      source,
      at: revision.lastDirtyAt,
    });
    requeueQueuedEntriesForPane(paneId);
    return revision.currentRevision;
  };

  const observeMetadata = (paneId: string, metadata: PaneObservationMetadata) => {
    const previous = metadataByPaneId.get(paneId);
    if (
      previous?.paneActivity === metadata.paneActivity &&
      previous.alternateOn === metadata.alternateOn &&
      previous.currentCommand === metadata.currentCommand
    ) {
      return ensureRevision(paneId).currentRevision;
    }
    metadataByPaneId.set(paneId, { ...metadata });
    return markDirty(paneId, "metadata");
  };

  const getRevision = (paneId: string): PaneObservationRevision => ({
    ...ensureRevision(paneId),
  });

  const getDiagnostics = (): PaneObservationDiagnostics => ({
    ...counters,
    queuedRequests: queuedEntries.size,
    inFlightRequests: activeEntries.size,
    batchRunning,
  });

  const removePane = (paneId: string): void => {
    revisions.delete(paneId);
    metadataByPaneId.delete(paneId);
    for (const [captureKey, cached] of cache) {
      if (cached.paneId === paneId) {
        cache.delete(captureKey);
      }
    }
    const error = new PaneObservationCaptureError(
      "PANE_REMOVED",
      `pane ${paneId} was removed from observation`,
    );
    new Set(pendingEntries.values()).forEach((entry) => {
      if (entry.paneId !== paneId) return;
      entry.cancelled = true;
      queuedEntries.delete(entry.identityKey);
      pendingEntries.delete(entry.identityKey);
      activeEntries.delete(entry);
      rejectEntry(entry, error);
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (drainTimer !== null) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    const error = new PaneObservationCaptureError(
      "COORDINATOR_DISPOSED",
      "observation coordinator has been disposed",
    );
    new Set(pendingEntries.values()).forEach((entry) => {
      entry.cancelled = true;
      rejectEntry(entry, error);
    });
    queuedEntries.clear();
    pendingEntries.clear();
    activeEntries.clear();
  };

  return {
    requestCapture,
    markDirty,
    observeMetadata,
    getRevision,
    getDiagnostics,
    removePane,
    dispose,
  };
};

export type PaneObservationCoordinator = ReturnType<typeof createPaneObservationCoordinator>;
