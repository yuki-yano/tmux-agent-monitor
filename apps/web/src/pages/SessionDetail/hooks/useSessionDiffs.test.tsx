import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import {
  diffErrorAtom,
  diffFilesAtom,
  diffLoadingFilesAtom,
  diffOpenAtom,
} from "../atoms/diffAtoms";
import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { AUTO_REFRESH_INTERVAL_MS } from "../sessionDetailUtils";
import { createDeferred, createDiffFile, createDiffSummary } from "../test-helpers";
import { useSessionDiffs as useSessionDiffsBase } from "./useSessionDiffs";

const useSessionDiffs = (
  params: Omit<Parameters<typeof useSessionDiffsBase>[0], "repoRoot"> & {
    repoRoot?: string | null;
  },
) => useSessionDiffsBase({ repoRoot: "/repo", ...params });

describe("useSessionDiffs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  const createHarness = (store = createStore(), strict = false) => {
    const queryClient = createAppQueryClient();
    store.set(diffErrorAtom, null);
    store.set(diffFilesAtom, {});
    store.set(diffOpenAtom, {});
    store.set(diffLoadingFilesAtom, {});
    const Wrapper = ({ children }: { children: ReactNode }) => {
      const content = (
        <QueryClientProvider client={queryClient}>
          <JotaiProvider store={store}>{children}</JotaiProvider>
        </QueryClientProvider>
      );
      return strict ? <StrictMode>{content}</StrictMode> : content;
    };
    return { queryClient, Wrapper };
  };
  const createWrapper = (store = createStore(), strict = false) =>
    createHarness(store, strict).Wrapper;

  it("loads diff summary on mount", async () => {
    const diffSummary = createDiffSummary();
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary).not.toBeNull();
    });

    expect(requestDiffSummary).toHaveBeenCalledWith(
      "pane-1",
      { force: true, mode: "total" },
      expect.any(AbortSignal),
    );
  });

  it("switches worktree diff layers and keeps branch inspection committed", async () => {
    const requestDiffSummary = vi.fn().mockResolvedValue(createDiffSummary());
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());
    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ branch }: { branch: string | null }) =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          branch,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper, initialProps: { branch: null as string | null } },
    );

    await waitFor(() => {
      expect(result.current.diffMode).toBe("total");
    });

    act(() => {
      result.current.setDiffMode("uncommitted");
    });
    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenLastCalledWith(
        "pane-1",
        {
          force: true,
          mode: "uncommitted",
        },
        expect.any(AbortSignal),
      );
    });

    rerender({ branch: "feature/virtual" });
    await waitFor(() => {
      expect(result.current.diffMode).toBe("committed");
      expect(requestDiffSummary).toHaveBeenLastCalledWith(
        "pane-1",
        {
          branch: "feature/virtual",
          force: true,
          mode: "committed",
        },
        expect.any(AbortSignal),
      );
    });
  });

  it("loads diff file when toggled open", async () => {
    const diffSummary = createDiffSummary();
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary).not.toBeNull();
    });

    result.current.toggleDiff("src/index.ts");

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledWith("pane-1", "src/index.ts", "HEAD", {
        force: true,
        mode: "total",
      });
    });
  });

  it("loads diff file without toggling open state", async () => {
    const diffSummary = createDiffSummary();
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary).not.toBeNull();
    });

    void result.current.ensureDiffFile("src/index.ts");

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledWith("pane-1", "src/index.ts", "HEAD", {
        force: true,
        mode: "total",
      });
    });
    expect(result.current.diffOpen["src/index.ts"]).toBeUndefined();
  });

  it("reloads diff summary when reconnected", async () => {
    const diffSummary = createDiffSummary();
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { rerender } = renderHook(
      ({ connected }) =>
        useSessionDiffs({
          paneId: "pane-1",
          connected,
          requestDiffSummary,
          requestDiffFile,
        }),
      {
        wrapper,
        initialProps: { connected: false },
      },
    );

    expect(requestDiffSummary).not.toHaveBeenCalled();

    rerender({ connected: true });

    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(1);
    });
    expect(requestDiffSummary).toHaveBeenLastCalledWith(
      "pane-1",
      { force: true, mode: "total" },
      expect.any(AbortSignal),
    );
  });

  it("resumes summary polling after visibility returns without an immediate request", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const requestDiffSummary = vi.fn().mockResolvedValue(createDiffSummary());
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(requestDiffSummary).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS);
    });
    expect(requestDiffSummary).toHaveBeenCalledTimes(2);
  });

  it("stops summary polling while offline", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const requestDiffSummary = vi.fn().mockResolvedValue(createDiffSummary());
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS);
    });
    expect(requestDiffSummary).toHaveBeenCalledTimes(2);

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS * 2);
    });

    expect(requestDiffSummary).toHaveBeenCalledTimes(2);
  });

  it("discards the previous summary and reloads when revisiting a pane", async () => {
    const paneAInitial = createDiffSummary({ rev: "rev-a-initial" });
    const paneARevisit = createDiffSummary({ rev: "rev-a-revisit" });
    const paneBSummary = createDiffSummary({ rev: "rev-b" });
    const paneARevisitDeferred = createDeferred<typeof paneARevisit>();
    let paneACalls = 0;
    const requestDiffSummary = vi.fn((paneId: string) => {
      if (paneId === "pane-a") {
        paneACalls += 1;
        return paneACalls === 1 ? Promise.resolve(paneAInitial) : paneARevisitDeferred.promise;
      }
      return Promise.resolve(paneBSummary);
    });
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper, initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-a-initial");
    });
    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-b");
    });

    rerender({ paneId: "pane-a" });

    expect(result.current.diffSummary).toBeNull();
    expect(result.current.diffLoading).toBe(true);
    expect(requestDiffSummary).toHaveBeenCalledTimes(3);

    await act(async () => {
      paneARevisitDeferred.resolve(paneARevisit);
      await paneARevisitDeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-a-revisit");
      expect(result.current.diffLoading).toBe(false);
    });
  });

  it("exposes a rejected summary request through diffError", async () => {
    const requestDiffSummary = vi.fn().mockRejectedValue(new Error("summary unavailable"));
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffError).toBe("summary unavailable");
      expect(result.current.diffLoading).toBe(false);
    });
  });

  it("ignores stale diff summary responses from previous pane", async () => {
    const pane1Summary = createDiffSummary({ rev: "rev-pane-1", files: [] });
    const pane2Summary = createDiffSummary({
      rev: "rev-pane-2",
      files: [{ path: "pane-2.ts", status: "M", staged: false, additions: 1, deletions: 0 }],
    });
    const pane1Deferred = createDeferred<typeof pane1Summary>();
    const requestDiffSummary = vi.fn((paneId: string) =>
      paneId === "pane-1" ? pane1Deferred.promise : Promise.resolve(pane2Summary),
    );
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      {
        wrapper,
        initialProps: { paneId: "pane-1" },
      },
    );

    rerender({ paneId: "pane-2" });

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-pane-2");
    });

    pane1Deferred.resolve(pane1Summary);

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-pane-2");
    });
  });

  it("keeps the newest summary when refresh requests resolve out of order", async () => {
    const staleSummary = createDiffSummary({ rev: "rev-stale" });
    const freshSummary = createDiffSummary({ rev: "rev-fresh" });
    const staleDeferred = createDeferred<typeof staleSummary>();
    const freshDeferred = createDeferred<typeof freshSummary>();
    const requestDiffSummary = vi
      .fn()
      .mockImplementationOnce(() => staleDeferred.promise)
      .mockImplementationOnce(() => freshDeferred.promise);
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    void result.current.refreshDiff();
    freshDeferred.resolve(freshSummary);

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-fresh");
    });

    staleDeferred.resolve(staleSummary);

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-fresh");
    });
  });

  it("clears previous pane diff-file cache on pane switch", async () => {
    const pane1Summary = createDiffSummary({ rev: "rev-pane-1" });
    const pane2Summary = createDiffSummary({ rev: "rev-pane-2" });
    const requestDiffSummary = vi.fn((paneId: string) =>
      Promise.resolve(paneId === "pane-1" ? pane1Summary : pane2Summary),
    );
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      {
        wrapper,
        initialProps: { paneId: "pane-1" },
      },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-pane-1");
    });

    result.current.toggleDiff("src/index.ts");

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(1);
    });

    rerender({ paneId: "pane-2" });

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-pane-2");
    });

    rerender({ paneId: "pane-1" });

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-pane-1");
    });

    result.current.toggleDiff("src/index.ts");

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(2);
    });
    expect(requestDiffFile).toHaveBeenLastCalledWith("pane-1", "src/index.ts", "rev-pane-1", {
      force: true,
      mode: "total",
    });
  });

  it("reuses cached open diff files when summary refresh keeps same rev", async () => {
    const diffSummary = createDiffSummary({
      rev: "HEAD",
      files: [{ path: "src/index.ts", status: "M", staged: false, additions: 1, deletions: 0 }],
    });
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn().mockResolvedValue(createDiffFile());

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("HEAD");
    });

    result.current.toggleDiff("src/index.ts");

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(1);
    });

    await result.current.refreshDiff();

    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(2);
    });
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
  });

  it("keeps an open-file refresh when a same-revision poll starts later", async () => {
    const initialSummary = createDiffSummary({ rev: "rev-1" });
    const refreshedSummary = createDiffSummary({ rev: "rev-2" });
    const refreshedFileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(initialSummary)
      .mockResolvedValue(refreshedSummary);
    const requestDiffFile = vi
      .fn()
      .mockResolvedValueOnce(createDiffFile({ rev: "rev-1", patch: "initial" }))
      .mockImplementationOnce(() => refreshedFileDeferred.promise);
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    try {
      const wrapper = createWrapper();
      const { result } = renderHook(
        () =>
          useSessionDiffs({
            paneId: "pane-1",
            connected: true,
            requestDiffSummary,
            requestDiffFile,
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.diffSummary?.rev).toBe("rev-1");
      });
      act(() => {
        result.current.toggleDiff("src/index.ts");
      });
      await waitFor(() => {
        expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("initial");
      });
      const pollHandler = setIntervalSpy.mock.calls.find(
        ([, delay]) => delay === AUTO_REFRESH_INTERVAL_MS,
      )?.[0];
      expect(typeof pollHandler).toBe("function");

      act(() => {
        void result.current.refreshDiff();
      });
      await waitFor(() => {
        expect(requestDiffFile).toHaveBeenCalledTimes(2);
        expect(result.current.diffSummary?.rev).toBe("rev-2");
        expect(result.current.diffLoading).toBe(false);
      });

      act(() => {
        if (typeof pollHandler === "function") pollHandler();
      });
      await waitFor(() => {
        expect(requestDiffSummary).toHaveBeenCalledTimes(3);
        expect(result.current.diffLoading).toBe(false);
      });
      expect(requestDiffFile).toHaveBeenCalledTimes(2);

      await act(async () => {
        refreshedFileDeferred.resolve(createDiffFile({ rev: "rev-2", patch: "fresh" }));
      });

      await waitFor(() => {
        expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");
      });
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("tracks loading while a cache-miss open file is hydrated for a new revision", async () => {
    const initialSummary = createDiffSummary({ rev: "rev-1" });
    const refreshedSummary = createDiffSummary({ rev: "rev-2" });
    const refreshedFileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(initialSummary)
      .mockResolvedValueOnce(refreshedSummary);
    const requestDiffFile = vi
      .fn()
      .mockResolvedValueOnce(createDiffFile({ rev: "rev-1", patch: "initial" }))
      .mockImplementationOnce(() => refreshedFileDeferred.promise);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-1");
    });
    act(() => {
      result.current.toggleDiff("src/index.ts");
    });
    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("initial");
    });

    act(() => {
      void result.current.refreshDiff();
    });
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-2");
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(true);
    });

    await act(async () => {
      refreshedFileDeferred.resolve(createDiffFile({ rev: "rev-2", patch: "refreshed" }));
      await refreshedFileDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("refreshed");
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(false);
    });
  });

  it("deduplicates in-flight file requests for the same generation", async () => {
    const diffSummary = createDiffSummary({ rev: "rev-1" });
    const fileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn(() => fileDeferred.promise);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-1");
    });

    act(() => {
      void result.current.ensureDiffFile("src/index.ts");
      void result.current.ensureDiffFile("src/index.ts");
    });

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(1);
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(true);
    });

    await act(async () => {
      fileDeferred.resolve(createDiffFile({ rev: "rev-1", patch: "deduplicated" }));
      await fileDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("deduplicated");
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(false);
    });
  });

  it("keeps the same generation when a same-revision summary snapshot is unchanged", async () => {
    const diffSummary = createDiffSummary({ rev: "rev-1" });
    const fileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    const requestDiffSummary = vi.fn().mockResolvedValue(diffSummary);
    const requestDiffFile = vi.fn(() => fileDeferred.promise);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-1");
    });
    act(() => {
      result.current.toggleDiff("src/index.ts");
    });
    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(1);
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(true);
    });

    await act(async () => {
      await result.current.refreshDiff();
    });

    expect(requestDiffFile).toHaveBeenCalledTimes(1);
    expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(true);

    await act(async () => {
      fileDeferred.resolve(createDiffFile({ rev: "rev-1", patch: "deduplicated" }));
      await fileDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("deduplicated");
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(false);
    });
  });

  it("refetches a cached file when the same-revision summary snapshot changes", async () => {
    const initialSummary = createDiffSummary({
      rev: "rev-1",
      files: [{ path: "src/index.ts", status: "M", staged: false, additions: 1, deletions: 0 }],
    });
    const changedSummary = createDiffSummary({
      rev: "rev-1",
      files: [{ path: "src/index.ts", status: "M", staged: false, additions: 2, deletions: 0 }],
    });
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(initialSummary)
      .mockResolvedValueOnce(changedSummary);
    const requestDiffFile = vi
      .fn()
      .mockResolvedValueOnce(createDiffFile({ rev: "rev-1", patch: "cached" }))
      .mockResolvedValueOnce(createDiffFile({ rev: "rev-1", patch: "refetched" }));

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.files[0]?.additions).toBe(1);
    });
    act(() => {
      result.current.toggleDiff("src/index.ts");
    });
    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("cached");
    });

    await act(async () => {
      await result.current.refreshDiff();
    });

    await waitFor(() => {
      expect(result.current.diffSummary?.files[0]?.additions).toBe(2);
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("refetched");
    });
    expect(requestDiffFile).toHaveBeenCalledTimes(2);
  });

  it("starts a new file request and ignores the old response when a same-revision snapshot changes", async () => {
    const initialSummary = createDiffSummary({
      rev: "rev-1",
      files: [{ path: "src/index.ts", status: "M", staged: false, additions: 1, deletions: 0 }],
    });
    const changedSummary = createDiffSummary({
      rev: "rev-1",
      files: [{ path: "src/index.ts", status: "M", staged: false, additions: 2, deletions: 0 }],
    });
    const staleFileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    const freshFileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(initialSummary)
      .mockResolvedValueOnce(changedSummary);
    const requestDiffFile = vi
      .fn()
      .mockImplementationOnce(() => staleFileDeferred.promise)
      .mockImplementationOnce(() => freshFileDeferred.promise);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-1",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.files[0]?.additions).toBe(1);
    });
    act(() => {
      result.current.toggleDiff("src/index.ts");
    });
    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refreshDiff();
    });
    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(2);
      expect(result.current.diffSummary?.files[0]?.additions).toBe(2);
    });

    await act(async () => {
      freshFileDeferred.resolve(createDiffFile({ rev: "rev-1", patch: "fresh" }));
      await freshFileDeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");
      expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(false);
    });

    await act(async () => {
      staleFileDeferred.resolve(createDiffFile({ rev: "rev-1", patch: "stale" }));
      await staleFileDeferred.promise;
    });

    expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");
    expect(result.current.diffLoadingFiles["src/index.ts"]).toBe(false);
  });

  it("does not restore a stale file cache entry after leaving and revisiting a scope", async () => {
    const paneAInitial = createDiffSummary({ rev: "rev-a-1" });
    const paneARefresh = createDiffSummary({ rev: "rev-a-2" });
    const paneBSummary = createDiffSummary({ rev: "rev-b" });
    const staleFileDeferred = createDeferred<ReturnType<typeof createDiffFile>>();
    let paneACalls = 0;
    const requestDiffSummary = vi.fn((paneId: string) => {
      if (paneId === "pane-a") {
        paneACalls += 1;
        return Promise.resolve(paneACalls === 1 ? paneAInitial : paneARefresh);
      }
      return Promise.resolve(paneBSummary);
    });
    const requestDiffFile = vi
      .fn()
      .mockResolvedValueOnce(createDiffFile({ rev: "rev-a-1", patch: "initial" }))
      .mockImplementationOnce(() => staleFileDeferred.promise)
      .mockResolvedValueOnce(createDiffFile({ rev: "rev-a-2", patch: "fresh" }));

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper, initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-a-1");
    });
    act(() => {
      result.current.toggleDiff("src/index.ts");
    });
    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(1);
    });

    act(() => {
      void result.current.refreshDiff();
    });
    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(2);
    });

    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-b");
    });

    rerender({ paneId: "pane-a" });
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("rev-a-2");
    });
    act(() => {
      void result.current.ensureDiffFile("src/index.ts");
    });

    await waitFor(() => {
      expect(requestDiffFile).toHaveBeenCalledTimes(3);
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");
    });

    await act(async () => {
      staleFileDeferred.resolve(createDiffFile({ rev: "rev-a-2", patch: "stale" }));
      await staleFileDeferred.promise;
      await Promise.resolve();
    });

    expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");

    act(() => {
      void result.current.ensureDiffFile("src/index.ts");
    });
    await waitFor(() => {
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");
    });
    expect(requestDiffFile).toHaveBeenCalledTimes(3);
  });

  it("ignores a previous mount response after revisiting the same scope", async () => {
    const staleSummaryDeferred = createDeferred<ReturnType<typeof createDiffSummary>>();
    const staleSummary = createDiffSummary({ rev: "rev-stale" });
    const freshSummary = createDiffSummary({ rev: "rev-fresh" });
    const freshFile = createDiffFile({ rev: "rev-fresh", patch: "fresh" });
    const requestDiffSummary = vi
      .fn()
      .mockImplementationOnce(() => staleSummaryDeferred.promise)
      .mockResolvedValueOnce(freshSummary);
    const requestDiffFile = vi.fn().mockResolvedValue(freshFile);
    const store = createStore();
    const wrapper = createWrapper(store);
    const renderDiffHook = () =>
      renderHook(
        () =>
          useSessionDiffs({
            paneId: "pane-a",
            connected: true,
            requestDiffSummary,
            requestDiffFile,
          }),
        { wrapper },
      );

    const staleMount = renderDiffHook();
    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(1);
    });
    staleMount.unmount();

    const freshMount = renderDiffHook();
    await waitFor(() => {
      expect(freshMount.result.current.diffSummary?.rev).toBe("rev-fresh");
    });
    act(() => {
      freshMount.result.current.toggleDiff("src/index.ts");
    });
    await waitFor(() => {
      expect(freshMount.result.current.diffFiles["src/index.ts"]?.patch).toBe("fresh");
    });

    await act(async () => {
      staleSummaryDeferred.resolve(staleSummary);
      await staleSummaryDeferred.promise;
      await Promise.resolve();
    });

    expect(freshMount.result.current.diffSummary?.rev).toBe("rev-fresh");
    expect(store.get(diffFilesAtom)["src/index.ts"]?.patch).toBe("fresh");
  });

  it("stores the summary under the full query key and forwards the query AbortSignal", async () => {
    let receivedSignal: AbortSignal | undefined;
    const summary = createDiffSummary({ rev: "query-rev" });
    const requestDiffSummary = vi.fn(
      async (_paneId: string, _options: unknown, signal?: AbortSignal) => {
        receivedSignal = signal;
        return summary;
      },
    );
    const { queryClient, Wrapper } = createHarness();

    renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-query",
          repoRoot: "/repo/query",
          connected: true,
          worktreePath: "/repo/query/wt",
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: Wrapper },
    );

    const queryKey = sessionDetailQueryKeys.diffSummary("pane-query", {
      repoRoot: "/repo/query",
      worktreePath: "/repo/query/wt",
      branch: null,
      mode: "total",
    });
    await waitFor(() => expect(queryClient.getQueryData(queryKey)).toEqual(summary));
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(queryClient.getQueryCache().find({ queryKey, exact: true })?.options).toMatchObject({
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "online",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: "always",
      refetchInterval: AUTO_REFRESH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    });
  });

  it("shows a cold offline reason without a request or spinner, then resumes once online", async () => {
    onlineManager.setOnline(false);
    const requestDiffSummary = vi.fn().mockResolvedValue(createDiffSummary());
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-offline",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.diffError).toBe("Offline: waiting to load diffs");
      expect(result.current.diffLoading).toBe(false);
    });
    expect(requestDiffSummary).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);
  });

  it("waits until the next interval after a warm browser reconnect", async () => {
    vi.useFakeTimers();
    const requestDiffSummary = vi.fn().mockResolvedValue(createDiffSummary());
    renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-online",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );
    await act(async () => Promise.resolve());
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(false));
    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS * 2));
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(true));
    await act(async () => Promise.resolve());
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(requestDiffSummary).toHaveBeenCalledTimes(2);
  });

  it("coalesces a StrictMode replay into one summary request", async () => {
    const requestDiffSummary = vi.fn(async () => createDiffSummary());
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-strict",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper(createStore(), true) },
    );

    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);
  });

  it("aborts the consumed summary signal on unmount and scope change", async () => {
    const signals: AbortSignal[] = [];
    const requestDiffSummary = vi.fn((_paneId: string, _options: unknown, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<ReturnType<typeof createDiffSummary>>(() => {});
    });
    const hook = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper(), initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);
    hook.rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(signals[0]?.aborted).toBe(true);
      expect(signals).toHaveLength(2);
    });
    expect(signals[1]?.aborted).toBe(false);
    hook.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("clears legacy file state before painting a new summary scope", async () => {
    const paneB = createDeferred<ReturnType<typeof createDiffSummary>>();
    const requestDiffSummary = vi.fn((paneId: string) =>
      paneId === "pane-a" ? Promise.resolve(createDiffSummary({ rev: "rev-a" })) : paneB.promise,
    );
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi
            .fn()
            .mockResolvedValue(createDiffFile({ rev: "rev-a", patch: "pane-a" })),
        }),
      { wrapper: createWrapper(), initialProps: { paneId: "pane-a" } },
    );
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("rev-a"));
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("pane-a"));

    rerender({ paneId: "pane-b" });

    expect(result.current.diffSummary).toBeNull();
    expect(result.current.diffFiles).toEqual({});
    expect(result.current.diffOpen).toEqual({});
    expect(result.current.diffLoadingFiles).toEqual({});
  });

  it("cancels the pending automatic request before a manual refresh", async () => {
    const initial = createDeferred<ReturnType<typeof createDiffSummary>>();
    let initialSignal: AbortSignal | undefined;
    const requestDiffSummary = vi
      .fn()
      .mockImplementationOnce((_paneId, _options, signal?: AbortSignal) => {
        initialSignal = signal;
        return initial.promise;
      })
      .mockResolvedValueOnce(createDiffSummary({ rev: "manual" }));
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-manual-cancel",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(initialSignal).toBeInstanceOf(AbortSignal));
    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("manual"));
    expect(initialSignal?.aborted).toBe(true);
    expect(requestDiffSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps warm summary data and a manual error across a later silent poll failure", async () => {
    vi.useFakeTimers();
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(createDiffSummary({ rev: "warm" }))
      .mockRejectedValueOnce(new Error("manual failed"))
      .mockRejectedValueOnce(new Error("poll failed"));
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-errors",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );
    await act(async () => Promise.resolve());
    expect(result.current.diffSummary?.rev).toBe("warm");

    await act(async () => result.current.refreshDiff());
    expect(result.current.diffSummary?.rev).toBe("warm");
    expect(result.current.diffError).toBe("manual failed");

    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(result.current.diffSummary?.rev).toBe("warm");
    expect(result.current.diffError).toBe("manual failed");
  });

  it("retries an open cache miss for manual equal-snapshot refresh but not for polling", async () => {
    vi.useFakeTimers();
    const summary = createDiffSummary({ rev: "same" });
    const requestDiffSummary = vi.fn().mockResolvedValue(summary);
    const requestDiffFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("file failed"))
      .mockResolvedValueOnce(createDiffFile({ rev: "same", patch: "retried" }));
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-force-hydrate",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper: createWrapper() },
    );
    await act(async () => Promise.resolve());
    act(() => result.current.toggleDiff("src/index.ts"));
    await act(async () => Promise.resolve());
    expect(result.current.diffError).toBe("file failed");
    expect(requestDiffFile).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
    expect(result.current.diffError).toBe("file failed");

    await act(async () => result.current.refreshDiff());
    await act(async () => Promise.resolve());
    expect(requestDiffFile).toHaveBeenCalledTimes(2);
    expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("retried");
    expect(result.current.diffError).toBeNull();
  });

  it("cancels a pending summary on app disconnect and starts a fresh reconnect request", async () => {
    const disconnectedRequest = createDeferred<ReturnType<typeof createDiffSummary>>();
    const reconnectedRequest = createDeferred<ReturnType<typeof createDiffSummary>>();
    const signals: AbortSignal[] = [];
    const requestDiffSummary = vi
      .fn()
      .mockImplementationOnce((_paneId, _options, signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return disconnectedRequest.promise;
      })
      .mockImplementationOnce((_paneId, _options, signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return reconnectedRequest.promise;
      });
    const { result, rerender } = renderHook(
      ({ connected }) =>
        useSessionDiffs({
          paneId: "pane-disconnect",
          connected,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper(), initialProps: { connected: true } },
    );

    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);
    rerender({ connected: false });
    await waitFor(() => expect(signals[0]?.aborted).toBe(true));

    rerender({ connected: true });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[1]?.aborted).toBe(false);
    expect(result.current.diffLoading).toBe(true);

    await act(async () => {
      disconnectedRequest.resolve(createDiffSummary({ rev: "stale-disconnected" }));
      await disconnectedRequest.promise;
    });
    expect(result.current.diffSummary).toBeNull();

    await act(async () => {
      reconnectedRequest.resolve(createDiffSummary({ rev: "fresh-reconnected" }));
      await reconnectedRequest.promise;
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("fresh-reconnected"));
    expect(result.current.diffLoading).toBe(false);
  });

  it("keeps an offline app reconnect non-loading until the paused query resumes", async () => {
    onlineManager.setOnline(false);
    const reconnectRequest = createDeferred<ReturnType<typeof createDiffSummary>>();
    const requestDiffSummary = vi.fn(() => reconnectRequest.promise);
    const { result, rerender } = renderHook(
      ({ connected }) =>
        useSessionDiffs({
          paneId: "pane-offline-reconnect",
          connected,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper(), initialProps: { connected: false } },
    );

    rerender({ connected: true });
    await waitFor(() => {
      expect(result.current.diffError).toBe("Offline: waiting to load diffs");
      expect(result.current.diffLoading).toBe(false);
    });
    expect(requestDiffSummary).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(1);
      expect(result.current.diffLoading).toBe(true);
    });
    await act(async () => reconnectRequest.resolve(createDiffSummary({ rev: "online" })));
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("online");
      expect(result.current.diffLoading).toBe(false);
    });
  });

  it("keeps a cold offline manual refresh non-loading until its query resumes", async () => {
    onlineManager.setOnline(false);
    const manualRequest = createDeferred<ReturnType<typeof createDiffSummary>>();
    const requestDiffSummary = vi.fn(() => manualRequest.promise);
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-offline-manual",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.diffError).toBe("Offline: waiting to load diffs"));
    act(() => void result.current.refreshDiff());
    expect(result.current.diffLoading).toBe(false);
    expect(requestDiffSummary).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(1);
      expect(result.current.diffLoading).toBe(true);
    });
    await act(async () => manualRequest.resolve(createDiffSummary({ rev: "manual-online" })));
    await waitFor(() => {
      expect(result.current.diffSummary?.rev).toBe("manual-online");
      expect(result.current.diffLoading).toBe(false);
    });
  });

  it("clears a legacy file error before exposing the latest manual summary failure", async () => {
    let rejectManualSummary: ((reason: unknown) => void) | undefined;
    const manualSummary = new Promise<ReturnType<typeof createDiffSummary>>((_resolve, reject) => {
      rejectManualSummary = reject;
    });
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(createDiffSummary({ rev: "warm" }))
      .mockImplementationOnce(() => manualSummary);
    const requestDiffFile = vi.fn().mockRejectedValue(new Error("old file failed"));
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-error-precedence",
          connected: true,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("warm"));
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(result.current.diffError).toBe("old file failed"));

    act(() => void result.current.refreshDiff());
    expect(result.current.diffError).toBeNull();
    await act(async () => rejectManualSummary?.(new Error("latest summary failed")));
    await waitFor(() => expect(result.current.diffError).toBe("latest summary failed"));
  });

  it("retains a manual error for equal automatic success and clears it on snapshot change", async () => {
    vi.useFakeTimers();
    const warm = createDiffSummary({ rev: "warm" });
    const changed = createDiffSummary({ rev: "changed" });
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(warm)
      .mockRejectedValueOnce(new Error("manual remains"))
      .mockResolvedValueOnce(warm)
      .mockResolvedValueOnce(changed);
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-error-clear",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );
    await act(async () => Promise.resolve());
    await act(async () => result.current.refreshDiff());
    expect(result.current.diffError).toBe("manual remains");

    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(result.current.diffSummary?.rev).toBe("warm");
    expect(result.current.diffError).toBe("manual remains");

    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(result.current.diffSummary?.rev).toBe("changed");
    expect(result.current.diffError).toBeNull();
  });

  it("keeps only the latest of two reverse-order manual refreshes", async () => {
    const firstManual = createDeferred<ReturnType<typeof createDiffSummary>>();
    const secondManual = createDeferred<ReturnType<typeof createDiffSummary>>();
    const manualSignals: AbortSignal[] = [];
    const requestDiffSummary = vi
      .fn()
      .mockResolvedValueOnce(createDiffSummary({ rev: "initial" }))
      .mockImplementationOnce((_paneId, _options, signal?: AbortSignal) => {
        if (signal) manualSignals.push(signal);
        return firstManual.promise;
      })
      .mockImplementationOnce((_paneId, _options, signal?: AbortSignal) => {
        if (signal) manualSignals.push(signal);
        return secondManual.promise;
      });
    const { result } = renderHook(
      () =>
        useSessionDiffs({
          paneId: "pane-double-manual",
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("initial"));

    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(manualSignals).toHaveLength(1));
    expect(manualSignals[0]?.aborted).toBe(false);
    act(() => void result.current.refreshDiff());
    await waitFor(() => {
      expect(manualSignals[0]?.aborted).toBe(true);
      expect(manualSignals).toHaveLength(2);
    });
    expect(manualSignals[1]?.aborted).toBe(false);

    await act(async () => secondManual.resolve(createDiffSummary({ rev: "latest" })));
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("latest"));
    await act(async () => firstManual.resolve(createDiffSummary({ rev: "stale" })));
    expect(result.current.diffSummary?.rev).toBe("latest");
    expect(result.current.diffLoading).toBe(false);
  });

  it("does not re-expose a pending manual refresh after A to B to A", async () => {
    const staleManual = createDeferred<ReturnType<typeof createDiffSummary>>();
    let paneACalls = 0;
    const requestDiffSummary = vi.fn((paneId: string) => {
      if (paneId === "pane-b") {
        return Promise.resolve(createDiffSummary({ rev: "pane-b" }));
      }
      paneACalls += 1;
      if (paneACalls === 1) return Promise.resolve(createDiffSummary({ rev: "pane-a-initial" }));
      if (paneACalls === 2) return staleManual.promise;
      return Promise.resolve(createDiffSummary({ rev: "pane-a-revisit" }));
    });
    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionDiffs({
          paneId,
          connected: true,
          requestDiffSummary,
          requestDiffFile: vi.fn().mockResolvedValue(createDiffFile()),
        }),
      { wrapper: createWrapper(), initialProps: { paneId: "pane-a" } },
    );
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-a-initial"));
    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(result.current.diffLoading).toBe(true));

    rerender({ paneId: "pane-b" });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-b"));
    rerender({ paneId: "pane-a" });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-a-revisit"));
    expect(result.current.diffLoading).toBe(false);
    expect(result.current.diffError).toBeNull();

    await act(async () => staleManual.resolve(createDiffSummary({ rev: "pane-a-stale" })));
    expect(result.current.diffSummary?.rev).toBe("pane-a-revisit");
    expect(result.current.diffLoading).toBe(false);
    expect(result.current.diffError).toBeNull();
  });

  it("force-hydrates an equal snapshot cache miss after app reconnect", async () => {
    const summary = createDiffSummary({ rev: "same-reconnect" });
    const requestDiffSummary = vi.fn().mockResolvedValue(summary);
    const requestDiffFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("file unavailable"))
      .mockResolvedValueOnce(createDiffFile({ rev: "same-reconnect", patch: "reconnected" }));
    const { result, rerender } = renderHook(
      ({ connected }) =>
        useSessionDiffs({
          paneId: "pane-reconnect-hydrate",
          connected,
          requestDiffSummary,
          requestDiffFile,
        }),
      { wrapper: createWrapper(), initialProps: { connected: true } },
    );
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("same-reconnect"));
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(result.current.diffError).toBe("file unavailable"));

    rerender({ connected: false });
    rerender({ connected: true });
    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(2);
      expect(requestDiffFile).toHaveBeenCalledTimes(2);
      expect(result.current.diffFiles["src/index.ts"]?.patch).toBe("reconnected");
      expect(result.current.diffError).toBeNull();
    });
  });
});
