import type { TextCaptureOptions, TextCaptureResult } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OBSERVATION_CAPTURE_TIMEOUT_MS,
  OBSERVATION_COALESCING_WINDOW_MS,
  OBSERVATION_MAX_BATCH_SIZE,
  OBSERVATION_MAX_PENDING_REQUESTS,
  OBSERVATION_RECONCILIATION_INTERVAL_MS,
  type PaneObservationCaptureRequest,
  type PaneObservationCaptureResult,
  type PaneObservationDiagnosticEvent,
  createPaneObservationCaptureKey,
  createPaneObservationCoordinator,
} from "./pane-observation-coordinator";

const captureOptions = (
  paneId: string,
  overrides: Partial<TextCaptureOptions> = {},
): TextCaptureOptions => ({
  paneId,
  lines: 100,
  joinLines: true,
  includeAnsi: true,
  includeTruncated: false,
  altScreen: "auto",
  alternateOn: false,
  currentCommand: "codex",
  ...overrides,
});

const captureResult = (screen: string): TextCaptureResult => ({
  screen,
  truncated: false,
  alternateOn: false,
});

const successfulResults = (requests: PaneObservationCaptureRequest[]) =>
  requests.map(({ requestId, options }) => ({
    requestId,
    result: captureResult(options.paneId),
  }));

type LatencySample = {
  sampleId: string;
  startedAt: number;
  completedAt?: number;
  latencyMs?: number;
};

const completeLatencySample = (
  samplesByPaneId: Map<string, LatencySample>,
  event: Extract<PaneObservationDiagnosticEvent, { type: "capture-completed" }>,
) => {
  const sample = samplesByPaneId.get(event.paneId);
  if (!sample) return;
  sample.completedAt = event.at;
  sample.latencyMs = event.at - sample.startedAt;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createPaneObservationCaptureKey", () => {
  it("includes every capture option and purpose", () => {
    const base = captureOptions("%1");
    const screenKey = createPaneObservationCaptureKey({ purpose: "screen", options: base });

    expect(
      new Set([
        screenKey,
        createPaneObservationCaptureKey({ purpose: "fingerprint", options: base }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, lines: 99 },
        }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, joinLines: false },
        }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, includeAnsi: false },
        }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, includeTruncated: undefined },
        }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, altScreen: "on" },
        }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, alternateOn: true },
        }),
        createPaneObservationCaptureKey({
          purpose: "screen",
          options: { ...base, currentCommand: null },
        }),
      ]).size,
    ).toBe(9);
  });
});

describe("createPaneObservationCoordinator", () => {
  it("coalesces and shares the same promise for the same key and revision", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(async (requests) => successfulResults(requests));
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const input = {
      purpose: "screen" as const,
      options: captureOptions("%1"),
      priority: "foreground" as const,
    };

    const first = coordinator.requestCapture(input);
    const second = coordinator.requestCapture(input);

    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS - 1);
    expect(executeBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toEqual(captureResult("%1"));
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch.mock.calls[0]?.[0]).toHaveLength(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      captureRequests: 2,
      deduplicatedRequests: 1,
      batchesStarted: 1,
      batchesCompleted: 1,
      executorRequests: 1,
      capturesCompleted: 1,
    });
  });

  it("does not deduplicate different options or purposes", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(async (requests) => successfulResults(requests));
    const coordinator = createPaneObservationCoordinator({ executeBatch });

    const captures = [
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions("%1"),
        priority: "background",
      }),
      coordinator.requestCapture({
        purpose: "fingerprint",
        options: captureOptions("%1"),
        priority: "background",
      }),
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions("%1", { lines: 20 }),
        priority: "background",
      }),
    ];

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    await expect(Promise.all(captures)).resolves.toHaveLength(3);
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it("requeues a fingerprint when its pane becomes dirty while the batch is running", async () => {
    vi.useFakeTimers();
    let resolveFirst: ((results: ReturnType<typeof successfulResults>) => void) | undefined;
    const executeBatch = vi.fn((requests: PaneObservationCaptureRequest[]) => {
      if (executeBatch.mock.calls.length === 1) {
        return new Promise<ReturnType<typeof successfulResults>>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(
        requests.map(({ requestId }) => ({ requestId, result: captureResult("fresh") })),
      );
    });
    const diagnostics: string[] = [];
    const coordinator = createPaneObservationCoordinator({
      executeBatch,
      onDiagnostic: (event) => diagnostics.push(event.type),
    });
    const capture = coordinator.requestCapture({
      purpose: "fingerprint",
      options: captureOptions("%1"),
      priority: "foreground",
    });

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    coordinator.markDirty("%1", "pipe");
    resolveFirst?.(
      successfulResults(executeBatch.mock.calls[0]?.[0] as Parameters<typeof successfulResults>[0]),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      capturesRequeued: 1,
      queuedRequests: 1,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);

    await expect(capture).resolves.toEqual(captureResult("fresh"));
    expect(executeBatch).toHaveBeenCalledTimes(2);
    expect(executeBatch.mock.calls[1]?.[0][0]?.revision).toBe(1);
    expect(diagnostics).toContain("capture-requeued");
  });

  it("delivers a screen captured while its pane revision changes", async () => {
    vi.useFakeTimers();
    let resolveCapture!: (results: PaneObservationCaptureResult[]) => void;
    const executeBatch = vi.fn(
      (_requests: PaneObservationCaptureRequest[]) =>
        new Promise<PaneObservationCaptureResult[]>((resolve) => {
          resolveCapture = (results) => resolve(results);
        }),
    );
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const capture = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%active"),
      priority: "foreground",
    });

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    coordinator.markDirty("%active", "pipe");
    resolveCapture(
      executeBatch.mock.calls[0]?.[0].map(({ requestId }) => ({
        requestId,
        result: captureResult("visible-snapshot"),
      })) ?? [],
    );
    await vi.advanceTimersByTimeAsync(0);

    await expect(capture).resolves.toEqual(captureResult("visible-snapshot"));
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      capturesRequeued: 0,
      queuedRequests: 0,
    });
  });

  it("moves queued fingerprints directly to the newest dirty revision", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(async (requests) => successfulResults(requests));
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const capture = coordinator.requestCapture({
      purpose: "fingerprint",
      options: captureOptions("%1"),
      priority: "background",
    });

    coordinator.markDirty("%1", "hook");
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);

    await expect(capture).resolves.toEqual(captureResult("%1"));
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch.mock.calls[0]?.[0][0]?.revision).toBe(1);
    expect(coordinator.getDiagnostics().capturesRequeued).toBe(1);
  });

  it("keeps a queued screen request when its pane becomes dirty", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(async (requests) => successfulResults(requests));
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const capture = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%active"),
      priority: "foreground",
    });

    coordinator.markDirty("%active", "hook");
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);

    await expect(capture).resolves.toEqual(captureResult("%active"));
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch.mock.calls[0]?.[0][0]?.revision).toBe(0);
    expect(coordinator.getDiagnostics().capturesRequeued).toBe(0);
  });

  it("uses a fresh cache until the five second reconciliation interval", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(async (requests) => successfulResults(requests));
    const coordinator = createPaneObservationCoordinator({ executeBatch, now: () => Date.now() });
    const input = {
      purpose: "screen" as const,
      options: captureOptions("%1"),
      priority: "background" as const,
    };

    const first = coordinator.requestCapture(input);
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    await first;
    await vi.advanceTimersByTimeAsync(OBSERVATION_RECONCILIATION_INTERVAL_MS - 1);
    await expect(coordinator.requestCapture(input)).resolves.toEqual(captureResult("%1"));
    expect(executeBatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const reconciled = coordinator.requestCapture(input);
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    await expect(reconciled).resolves.toEqual(captureResult("%1"));
    expect(executeBatch).toHaveBeenCalledTimes(2);
    expect(coordinator.getDiagnostics()).toMatchObject({ cacheHits: 1, reconciliations: 1 });
    expect(coordinator.getRevision("%1").lastReconciledAt).toBe(Date.now());
  });

  it("bounds the queue and applies background drop and foreground error policies", async () => {
    vi.useFakeTimers();
    const coordinator = createPaneObservationCoordinator({
      executeBatch: async (requests) => successfulResults(requests),
    });
    const queued = Array.from({ length: OBSERVATION_MAX_PENDING_REQUESTS }, (_, index) =>
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions(`%${index}`),
        priority: "background",
      }),
    );

    const duplicate = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%0"),
      priority: "background",
    });
    expect(duplicate).toBe(queued[0]);
    await expect(
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions("%background-overflow"),
        priority: "background",
      }),
    ).resolves.toBeNull();
    await expect(
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions("%foreground-overflow"),
        priority: "foreground",
      }),
    ).rejects.toMatchObject({ code: "QUEUE_OVERFLOW" });
    expect(coordinator.getDiagnostics()).toMatchObject({
      queuedRequests: OBSERVATION_MAX_PENDING_REQUESTS,
      backgroundDrops: 1,
      foregroundOverflowErrors: 1,
    });
  });

  it("runs at most one batch of 64 requests concurrently", async () => {
    vi.useFakeTimers();
    const resolvers: Array<(results: ReturnType<typeof successfulResults>) => void> = [];
    let running = 0;
    let maximumRunning = 0;
    const executeBatch = vi.fn((_requests: PaneObservationCaptureRequest[]) => {
      running += 1;
      maximumRunning = Math.max(maximumRunning, running);
      return new Promise<ReturnType<typeof successfulResults>>((resolve) => {
        resolvers.push((results) => {
          running -= 1;
          resolve(results);
        });
      });
    });
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const captures = Array.from({ length: OBSERVATION_MAX_PENDING_REQUESTS }, (_, index) =>
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions(`%${index}`),
        priority: "foreground",
      }),
    );

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch.mock.calls[0]?.[0]).toHaveLength(OBSERVATION_MAX_BATCH_SIZE);
    await expect(
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions("%overflow-while-running"),
        priority: "background",
      }),
    ).resolves.toBeNull();
    expect(coordinator.getDiagnostics()).toMatchObject({
      queuedRequests: OBSERVATION_MAX_BATCH_SIZE,
      inFlightRequests: OBSERVATION_MAX_BATCH_SIZE,
      backgroundDrops: 1,
    });
    resolvers[0]?.(successfulResults(executeBatch.mock.calls[0]?.[0] ?? []));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);

    expect(executeBatch).toHaveBeenCalledTimes(2);
    expect(executeBatch.mock.calls[1]?.[0]).toHaveLength(OBSERVATION_MAX_BATCH_SIZE);
    expect(maximumRunning).toBe(1);
    resolvers[1]?.(successfulResults(executeBatch.mock.calls[1]?.[0] ?? []));
    await vi.advanceTimersByTimeAsync(0);
    await expect(Promise.all(captures)).resolves.toHaveLength(OBSERVATION_MAX_PENDING_REQUESTS);
  });

  it("aborts on timeout and waits for executor settlement before starting the next batch", async () => {
    vi.useFakeTimers();
    let running = 0;
    let maximumRunning = 0;
    let firstSignal: AbortSignal | undefined;
    const executeBatch = vi.fn((requests: PaneObservationCaptureRequest[], signal: AbortSignal) => {
      running += 1;
      maximumRunning = Math.max(maximumRunning, running);
      if (executeBatch.mock.calls.length === 1) {
        firstSignal = signal;
        return new Promise<PaneObservationCaptureResult[]>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              setTimeout(() => {
                running -= 1;
                reject(new Error("executor settled after abort"));
              }, 25);
            },
            { once: true },
          );
        });
      }
      running -= 1;
      return Promise.resolve(successfulResults(requests));
    });
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const timedOut = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%timeout"),
      priority: "foreground",
    });
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({ code: "CAPTURE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    const next = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%next"),
      priority: "foreground",
    });

    await vi.advanceTimersByTimeAsync(OBSERVATION_CAPTURE_TIMEOUT_MS);
    await timeoutAssertion;
    expect(firstSignal?.aborted).toBe(true);
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      batchesTimedOut: 0,
      queuedRequests: 1,
      inFlightRequests: 1,
      batchRunning: true,
    });
    await vi.advanceTimersByTimeAsync(24);
    expect(executeBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      batchesTimedOut: 1,
      queuedRequests: 1,
      inFlightRequests: 0,
      batchRunning: false,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS - 1);
    expect(executeBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toEqual(captureResult("%next"));
    expect(executeBatch).toHaveBeenCalledTimes(2);
    expect(maximumRunning).toBe(1);
  });

  it("does not extend a foreground deadline when the revision changes before timeout", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(
      (_requests: PaneObservationCaptureRequest[], signal: AbortSignal) =>
        new Promise<PaneObservationCaptureResult[]>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              setTimeout(() => reject(new Error("aborted")), 25);
            },
            { once: true },
          );
        }),
    );
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const capture = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%dirty-timeout"),
      priority: "foreground",
    });
    const timeoutAssertion = expect(capture).rejects.toMatchObject({ code: "CAPTURE_TIMEOUT" });

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    coordinator.markDirty("%dirty-timeout", "pipe");
    await vi.advanceTimersByTimeAsync(OBSERVATION_CAPTURE_TIMEOUT_MS);
    await timeoutAssertion;

    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      capturesRequeued: 0,
      queuedRequests: 0,
      inFlightRequests: 1,
      batchRunning: true,
    });
    await vi.advanceTimersByTimeAsync(25);
    expect(coordinator.getDiagnostics()).toMatchObject({
      capturesRequeued: 0,
      batchesTimedOut: 1,
      queuedRequests: 0,
      inFlightRequests: 0,
      batchRunning: false,
    });
  });

  it("removes pane state and ignores a late result from an active capture", async () => {
    vi.useFakeTimers();
    let resolveFirst: ((results: PaneObservationCaptureResult[]) => void) | undefined;
    const executeBatch = vi.fn((requests: PaneObservationCaptureRequest[]) => {
      if (executeBatch.mock.calls.length === 1) {
        return new Promise<PaneObservationCaptureResult[]>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(successfulResults(requests));
    });
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const capture = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%removed"),
      priority: "foreground",
    });
    const removedAssertion = expect(capture).rejects.toMatchObject({ code: "PANE_REMOVED" });

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    const firstRequests = executeBatch.mock.calls[0]?.[0] ?? [];
    coordinator.removePane("%removed");
    await removedAssertion;
    resolveFirst?.(successfulResults(firstRequests));
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getDiagnostics()).toMatchObject({
      capturesCompleted: 0,
      queuedRequests: 0,
      inFlightRequests: 0,
      batchRunning: false,
    });
    expect(coordinator.getRevision("%removed").currentRevision).toBe(0);

    const recaptured = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%removed"),
      priority: "foreground",
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    await expect(recaptured).resolves.toEqual(captureResult("%removed"));
    expect(executeBatch).toHaveBeenCalledTimes(2);
  });

  it("keeps request-level failures isolated and continues with later batches", async () => {
    vi.useFakeTimers();
    const executeBatch = vi.fn(
      async (requests: PaneObservationCaptureRequest[]) =>
        requests.map(({ requestId, options }) =>
          options.paneId === "%invalid"
            ? { requestId, error: "invalid pane" }
            : { requestId, result: captureResult(options.paneId) },
        ) satisfies PaneObservationCaptureResult[],
    );
    const coordinator = createPaneObservationCoordinator({ executeBatch });
    const invalid = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%invalid"),
      priority: "background",
    });
    const invalidAssertion = expect(invalid).rejects.toMatchObject({ code: "CAPTURE_FAILED" });
    const valid = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%valid"),
      priority: "background",
    });

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    await invalidAssertion;
    await expect(valid).resolves.toEqual(captureResult("%valid"));

    const later = coordinator.requestCapture({
      purpose: "screen",
      options: captureOptions("%later"),
      priority: "background",
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS);
    await expect(later).resolves.toEqual(captureResult("%later"));
    expect(executeBatch).toHaveBeenCalledTimes(2);
  });

  it("increments revisions only when tracked pane metadata changes", () => {
    const coordinator = createPaneObservationCoordinator({
      executeBatch: async (requests) => successfulResults(requests),
    });
    const metadata = {
      paneActivity: 10,
      alternateOn: false,
      currentCommand: "codex",
    };

    expect(coordinator.observeMetadata("%1", metadata)).toBe(1);
    expect(coordinator.observeMetadata("%1", metadata)).toBe(1);
    expect(coordinator.observeMetadata("%1", { ...metadata, paneActivity: 11 })).toBe(2);
    expect(coordinator.observeMetadata("%1", { ...metadata, paneActivity: 11 })).toBe(2);
    expect(coordinator.markDirty("%1", "subscriber")).toBe(3);
    expect(coordinator.getRevision("%1")).toMatchObject({
      currentRevision: 3,
    });
  });

  it("completes all 20 active screen dirty-to-delivery samples within two seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const executorLatencyMs = 1500;
    const samplesByPaneId = new Map<string, LatencySample>();
    const executeBatch = vi.fn(
      (requests: PaneObservationCaptureRequest[]) =>
        new Promise<PaneObservationCaptureResult[]>((resolve) => {
          setTimeout(() => resolve(successfulResults(requests)), executorLatencyMs);
        }),
    );
    const coordinator = createPaneObservationCoordinator({
      executeBatch,
      now: () => Date.now(),
      onDiagnostic: (event) => {
        if (event.type === "dirty" && event.source === "subscriber") {
          samplesByPaneId.set(event.paneId, {
            sampleId: event.paneId.slice(1),
            startedAt: event.at,
          });
        }
        if (event.type === "capture-completed" && !event.reconciliation) {
          completeLatencySample(samplesByPaneId, event);
        }
      },
    });

    const captures = Array.from({ length: 20 }, (_, index) => {
      const sampleId = `active-${String(index + 1).padStart(2, "0")}`;
      const paneId = `%${sampleId}`;
      coordinator.markDirty(paneId, "subscriber");
      return coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions(paneId),
        priority: "background",
      });
    });

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS + executorLatencyMs);
    await expect(Promise.all(captures)).resolves.toHaveLength(20);
    const samples = [...samplesByPaneId.values()];

    expect(samples).toEqual(
      Array.from({ length: 20 }, (_, index) => ({
        sampleId: `active-${String(index + 1).padStart(2, "0")}`,
        startedAt: Date.parse("2026-07-11T00:00:00.000Z"),
        completedAt:
          Date.parse("2026-07-11T00:00:00.000Z") +
          OBSERVATION_COALESCING_WINDOW_MS +
          executorLatencyMs,
        latencyMs: OBSERVATION_COALESCING_WINDOW_MS + executorLatencyMs,
      })),
    );
    expect(samples.every(({ latencyMs }) => latencyMs != null && latencyMs <= 2000)).toBe(true);
  });

  it("completes all 20 idle reconciliation enqueue-to-completion samples within five seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const executorLatencyMs = 4900;
    const samplesByPaneId = new Map<string, LatencySample>();
    const executeBatch = vi.fn(
      (requests: PaneObservationCaptureRequest[]) =>
        new Promise<PaneObservationCaptureResult[]>((resolve) => {
          setTimeout(() => resolve(successfulResults(requests)), executorLatencyMs);
        }),
    );
    const coordinator = createPaneObservationCoordinator({
      executeBatch,
      now: () => Date.now(),
      onDiagnostic: (event) => {
        if (event.type === "capture-enqueued" && event.reconciliation) {
          samplesByPaneId.set(event.paneId, {
            sampleId: event.paneId.slice(1),
            startedAt: event.at,
          });
        }
        if (event.type === "capture-completed" && event.reconciliation) {
          completeLatencySample(samplesByPaneId, event);
        }
      },
    });
    const paneIds = Array.from(
      { length: 20 },
      (_, index) => `%idle-${String(index + 1).padStart(2, "0")}`,
    );
    const initialCaptures = paneIds.map((paneId) =>
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions(paneId),
        priority: "background",
      }),
    );

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS + executorLatencyMs);
    await expect(Promise.all(initialCaptures)).resolves.toHaveLength(20);
    await vi.advanceTimersByTimeAsync(OBSERVATION_RECONCILIATION_INTERVAL_MS + 1);
    const reconciliationEnqueuedAt = Date.now();
    const reconciliations = paneIds.map((paneId) =>
      coordinator.requestCapture({
        purpose: "screen",
        options: captureOptions(paneId),
        priority: "background",
      }),
    );

    await vi.advanceTimersByTimeAsync(OBSERVATION_COALESCING_WINDOW_MS + executorLatencyMs);
    await expect(Promise.all(reconciliations)).resolves.toHaveLength(20);
    const samples = [...samplesByPaneId.values()];

    expect(samples).toEqual(
      paneIds.map((paneId) => ({
        sampleId: paneId.slice(1),
        startedAt: reconciliationEnqueuedAt,
        completedAt:
          reconciliationEnqueuedAt + OBSERVATION_COALESCING_WINDOW_MS + executorLatencyMs,
        latencyMs: OBSERVATION_COALESCING_WINDOW_MS + executorLatencyMs,
      })),
    );
    expect(samples.every(({ latencyMs }) => latencyMs != null && latencyMs <= 5000)).toBe(true);
  });
});
