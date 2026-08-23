import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  diffErrorAtom,
  diffFilesAtom,
  diffLoadingAtom,
  diffLoadingFilesAtom,
  diffOpenAtom,
  diffSummaryAtom,
} from "../atoms/diffAtoms";
import { AUTO_REFRESH_INTERVAL_MS } from "../sessionDetailUtils";
import { createDeferred, createDiffFile, createDiffSummary } from "../test-helpers";
import { useSessionDiffs } from "./useSessionDiffs";

describe("useSessionDiffs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  const createWrapper = () => {
    const store = createStore();
    store.set(diffSummaryAtom, null);
    store.set(diffErrorAtom, null);
    store.set(diffLoadingAtom, false);
    store.set(diffFilesAtom, {});
    store.set(diffOpenAtom, {});
    store.set(diffLoadingFilesAtom, {});
    return ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
  };

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

    expect(requestDiffSummary).toHaveBeenCalledWith("pane-1", { force: true, mode: "total" });
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
      expect(requestDiffSummary).toHaveBeenLastCalledWith("pane-1", {
        force: true,
        mode: "uncommitted",
      });
    });

    rerender({ branch: "feature/virtual" });
    await waitFor(() => {
      expect(result.current.diffMode).toBe("committed");
      expect(requestDiffSummary).toHaveBeenLastCalledWith("pane-1", {
        branch: "feature/virtual",
        force: true,
        mode: "committed",
      });
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

    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(1);
    });

    rerender({ connected: true });

    await waitFor(() => {
      expect(requestDiffSummary).toHaveBeenCalledTimes(2);
    });
    expect(requestDiffSummary).toHaveBeenLastCalledWith("pane-1", {
      force: true,
      mode: "total",
    });
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
});
