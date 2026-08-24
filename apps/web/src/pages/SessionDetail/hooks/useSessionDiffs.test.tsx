import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { AUTO_REFRESH_INTERVAL_MS, buildDiffSummarySnapshot } from "../sessionDetailUtils";
import { createDiffFile, createDiffSummary } from "../test-helpers";
import { type UseSessionDiffsParams, useSessionDiffs } from "./useSessionDiffs";

type HookProps = {
  paneId: string;
  repoRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
  connected: boolean;
};

const createControllable = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (error: unknown) => reject?.(error),
  };
};

const createSummaryWithPaths = (paths: string[], rev = "HEAD") =>
  createDiffSummary({
    rev,
    files: paths.map((path) => ({
      path,
      status: "M" as const,
      staged: false,
      additions: 1,
      deletions: 0,
    })),
  });

const renderDiffs = ({
  strict = false,
  requestDiffSummary = vi.fn<UseSessionDiffsParams["requestDiffSummary"]>(async () =>
    createDiffSummary(),
  ),
  requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(async (_paneId, path, rev) =>
    createDiffFile({ path, rev: rev ?? null }),
  ),
  initialProps = {},
}: {
  strict?: boolean;
  requestDiffSummary?: UseSessionDiffsParams["requestDiffSummary"];
  requestDiffFile?: UseSessionDiffsParams["requestDiffFile"];
  initialProps?: Partial<HookProps>;
} = {}) => {
  const queryClient = createAppQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
  const rendered = renderHook<ReturnType<typeof useSessionDiffs>, HookProps>(
    ({ paneId, repoRoot, worktreePath, branch, connected }) =>
      useSessionDiffs({
        paneId,
        repoRoot,
        worktreePath,
        branch,
        connected,
        requestDiffSummary,
        requestDiffFile,
      }),
    {
      wrapper: Wrapper,
      initialProps: {
        paneId: "pane-1",
        repoRoot: "/repo",
        worktreePath: null,
        branch: null,
        connected: true,
        ...initialProps,
      },
    },
  );
  return { ...rendered, queryClient, requestDiffSummary, requestDiffFile };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

describe("useSessionDiffs summary Query", () => {
  it("uses the full summary scope key and forwards its AbortSignal", async () => {
    let signal: AbortSignal | undefined;
    const requestDiffSummary = vi.fn<UseSessionDiffsParams["requestDiffSummary"]>(
      async (_paneId, _options, requestSignal) => {
        signal = requestSignal;
        return createDiffSummary();
      },
    );
    const { result, queryClient } = renderDiffs({
      requestDiffSummary,
      initialProps: { worktreePath: "/worktree" },
    });

    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    expect(signal).toBeInstanceOf(AbortSignal);
    const key = sessionDetailQueryKeys.diffSummary("pane-1", {
      repoRoot: "/repo",
      worktreePath: "/worktree",
      branch: null,
      mode: "total",
    });
    expect(queryClient.getQueryData(key)).toEqual(createDiffSummary());
  });

  it("switches worktree modes and keeps branch inspection committed", async () => {
    const requestDiffSummary = vi.fn<UseSessionDiffsParams["requestDiffSummary"]>(async () =>
      createDiffSummary(),
    );
    const { result, rerender } = renderDiffs({ requestDiffSummary });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());

    act(() => result.current.setDiffMode("uncommitted"));
    await waitFor(() =>
      expect(requestDiffSummary).toHaveBeenLastCalledWith(
        "pane-1",
        { force: true, mode: "uncommitted" },
        expect.any(AbortSignal),
      ),
    );
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: "feature/a",
      connected: true,
    });
    await waitFor(() => expect(result.current.diffMode).toBe("committed"));
    expect(requestDiffSummary).toHaveBeenLastCalledWith(
      "pane-1",
      { branch: "feature/a", force: true, mode: "committed" },
      expect.any(AbortSignal),
    );
  });

  it("shows a cold offline reason without a request or spinner and resumes online", async () => {
    onlineManager.setOnline(false);
    const { result, requestDiffSummary } = renderDiffs();
    await waitFor(() => expect(result.current.diffError).toBe("Offline: waiting to load diffs"));
    expect(result.current.diffLoading).toBe(false);
    expect(requestDiffSummary).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    expect(requestDiffSummary).toHaveBeenCalledTimes(1);
  });

  it("polls an equal summary without refetching an open file", async () => {
    vi.useFakeTimers();
    const summary = createDiffSummary();
    const requestDiffSummary = vi.fn(async () => summary);
    const requestDiffFile = vi.fn(async () => createDiffFile());
    const { result } = renderDiffs({ requestDiffSummary, requestDiffFile });
    await act(async () => Promise.resolve());
    act(() => result.current.toggleDiff("src/index.ts"));
    await act(async () => Promise.resolve());
    expect(requestDiffFile).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(requestDiffSummary).toHaveBeenCalledTimes(2);
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
  });

  it("keeps only the latest manual summary result", async () => {
    const first = createControllable<ReturnType<typeof createDiffSummary>>();
    const second = createControllable<ReturnType<typeof createDiffSummary>>();
    const signals: AbortSignal[] = [];
    const requestDiffSummary = vi
      .fn<UseSessionDiffsParams["requestDiffSummary"]>()
      .mockResolvedValueOnce(createDiffSummary({ rev: "initial" }))
      .mockImplementationOnce((_pane, _options, signal) => {
        signals.push(signal!);
        return first.promise;
      })
      .mockImplementationOnce((_pane, _options, signal) => {
        signals.push(signal!);
        return second.promise;
      });
    const { result } = renderDiffs({ requestDiffSummary });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("initial"));

    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(signals).toHaveLength(1));
    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals.some((signal) => signal.aborted)).toBe(true);
    await act(async () => second.resolve(createDiffSummary({ rev: "latest" })));
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("latest"));
    await act(async () => first.resolve(createDiffSummary({ rev: "stale" })));
    expect(result.current.diffSummary?.rev).toBe("latest");
  });

  it("does not request on a disconnected cold mount and blocks once on reconnect", async () => {
    const summary = createControllable<ReturnType<typeof createDiffSummary>>();
    const requestDiffSummary = vi.fn(() => summary.promise);
    const { result, rerender } = renderDiffs({
      requestDiffSummary,
      initialProps: { connected: false },
    });
    await act(async () => Promise.resolve());
    expect(requestDiffSummary).not.toHaveBeenCalled();
    expect(result.current.diffLoading).toBe(false);

    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(requestDiffSummary).toHaveBeenCalledTimes(1));
    expect(result.current.diffLoading).toBe(true);
    await act(async () => summary.resolve(createDiffSummary()));
    await waitFor(() => expect(result.current.diffLoading).toBe(false));
  });

  it("aborts a consumed summary signal on scope change and unmount", async () => {
    const signals: AbortSignal[] = [];
    let paneBCalls = 0;
    const requestDiffSummary = vi.fn<UseSessionDiffsParams["requestDiffSummary"]>(
      async (paneId, _options, signal) => {
        signals.push(signal!);
        if (paneId === "pane-b") {
          paneBCalls += 1;
          if (paneBCalls === 1) return createDiffSummary({ rev: "pane-b" });
        }
        return new Promise<ReturnType<typeof createDiffSummary>>(() => undefined);
      },
    );
    const { result, rerender, unmount } = renderDiffs({
      requestDiffSummary,
      initialProps: { paneId: "pane-a" },
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({
      paneId: "pane-b",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-b"));
    expect(signals[0]?.aborted).toBe(true);
    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(signals).toHaveLength(3));
    unmount();
    expect(signals[2]?.aborted).toBe(true);
  });

  it("keeps a manual error across an equal poll and clears it on snapshot change", async () => {
    vi.useFakeTimers();
    const warm = createDiffSummary({ rev: "warm" });
    const changed = createDiffSummary({ rev: "changed" });
    const requestDiffSummary = vi
      .fn<UseSessionDiffsParams["requestDiffSummary"]>()
      .mockResolvedValueOnce(warm)
      .mockRejectedValueOnce(new Error("manual failed"))
      .mockResolvedValueOnce(warm)
      .mockResolvedValueOnce(changed);
    const { result } = renderDiffs({ requestDiffSummary });
    await act(async () => Promise.resolve());
    await act(async () => result.current.refreshDiff());
    expect(result.current.diffError).toBe("manual failed");

    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(result.current.diffSummary?.rev).toBe("warm");
    expect(result.current.diffError).toBe("manual failed");
    await act(async () => vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS));
    expect(result.current.diffSummary?.rev).toBe("changed");
    expect(result.current.diffError).toBeNull();
  });

  it("does not re-expose an old A manual request after A to B to A", async () => {
    const staleA = createControllable<ReturnType<typeof createDiffSummary>>();
    let paneACalls = 0;
    const requestDiffSummary = vi.fn((paneId: string) => {
      if (paneId === "pane-b") return Promise.resolve(createDiffSummary({ rev: "pane-b" }));
      paneACalls += 1;
      if (paneACalls === 1) return Promise.resolve(createDiffSummary({ rev: "pane-a-initial" }));
      if (paneACalls === 2) return staleA.promise;
      return Promise.resolve(createDiffSummary({ rev: "pane-a-revisit" }));
    });
    const { result, rerender } = renderDiffs({
      requestDiffSummary,
      initialProps: { paneId: "pane-a" },
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-a-initial"));
    act(() => void result.current.refreshDiff());
    await waitFor(() => expect(result.current.diffLoading).toBe(true));
    rerender({
      paneId: "pane-b",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-b"));
    rerender({
      paneId: "pane-a",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("pane-a-revisit"));
    await act(async () => staleA.resolve(createDiffSummary({ rev: "pane-a-stale" })));
    expect(result.current.diffSummary?.rev).toBe("pane-a-revisit");
    expect(result.current.diffLoading).toBe(false);
    expect(result.current.diffError).toBeNull();
  });
});

describe("useSessionDiffs diff-file Query", () => {
  it("uses the full key/options, one StrictMode observer, and forwards AbortSignal", async () => {
    let fileSignal: AbortSignal | undefined;
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_paneId, path, rev, _options, signal) => {
        fileSignal = signal;
        return createDiffFile({ path, rev: rev ?? null });
      },
    );
    const { result, queryClient } = renderDiffs({ strict: true, requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => {
      result.current.toggleDiff("src/index.ts");
      void result.current.ensureDiffFile("src/index.ts");
      void result.current.ensureDiffFile("src/index.ts");
    });
    await waitFor(() => expect(result.current.diffFiles["src/index.ts"]).toBeDefined());
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
    expect(fileSignal).toBeInstanceOf(AbortSignal);

    const summary = result.current.diffSummary!;
    const key = sessionDetailQueryKeys.diffFile("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      mode: "total",
      revision: summary.rev,
      summarySnapshot: buildDiffSummarySnapshot(summary),
      path: "src/index.ts",
    });
    const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
    expect(query?.getObserversCount()).toBe(1);
    expect(query?.options).toMatchObject({
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
      networkMode: "online",
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    expect(requestDiffFile).toHaveBeenCalledWith(
      "pane-1",
      "src/index.ts",
      "HEAD",
      { force: true, mode: "total" },
      expect.any(AbortSignal),
    );
  });

  it("keeps a pending observer after close, completes it, and reopens with zero requests", async () => {
    const file = createControllable<ReturnType<typeof createDiffFile>>();
    const requestDiffFile = vi.fn(() => file.promise);
    const { result, queryClient } = renderDiffs({ requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(1));
    act(() => result.current.toggleDiff("src/index.ts"));
    expect(result.current.diffOpen["src/index.ts"]).toBe(false);

    await act(async () => file.resolve(createDiffFile()));
    await waitFor(() => expect(result.current.diffFiles["src/index.ts"]).toBeDefined());
    const query = queryClient
      .getQueryCache()
      .findAll({ queryKey: sessionDetailQueryKeys.diffFileRoot("pane-1") })[0];
    expect(query?.getObserversCount()).toBe(1);
    act(() => result.current.toggleDiff("src/index.ts"));
    await act(async () => Promise.resolve());
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
  });

  it("manual equal-snapshot refresh refetches every open successful file", async () => {
    const summary = createSummaryWithPaths(["src/a.ts", "src/b.ts"]);
    const requestDiffSummary = vi.fn(async () => summary);
    let fileRequestCount = 0;
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_pane, path, rev) => {
        fileRequestCount += 1;
        return createDiffFile({
          path,
          rev: rev ?? null,
          patch: `${path}:${fileRequestCount}`,
        });
      },
    );
    const { result } = renderDiffs({ requestDiffSummary, requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => {
      result.current.toggleDiff("src/a.ts");
      result.current.toggleDiff("src/b.ts");
    });
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(2));

    await act(async () => result.current.refreshDiff());
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(4));
    expect(requestDiffSummary).toHaveBeenCalledTimes(2);
  });

  it("carries only still-present open paths to a changed snapshot", async () => {
    const initial = createSummaryWithPaths(
      ["src/open.ts", "src/removed.ts", "src/external.ts"],
      "rev-1",
    );
    const changed = createSummaryWithPaths(["src/open.ts", "src/external.ts"], "rev-2");
    const openRequest = createControllable<ReturnType<typeof createDiffFile>>();
    const signals: AbortSignal[] = [];
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_pane, path, rev, _options, signal) => {
        signals.push(signal!);
        if (path === "src/open.ts" && rev === "rev-1") return openRequest.promise;
        return createDiffFile({ path, rev: rev ?? null });
      },
    );
    const { result, queryClient } = renderDiffs({
      requestDiffSummary: vi.fn(async () => initial),
      requestDiffFile,
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("rev-1"));
    act(() => {
      result.current.toggleDiff("src/open.ts");
      result.current.toggleDiff("src/removed.ts");
      void result.current.ensureDiffFile("src/external.ts");
    });
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(3));

    const summaryKey = sessionDetailQueryKeys.diffSummary("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      mode: "total",
    });
    const oldOpenKey = sessionDetailQueryKeys.diffFile("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      mode: "total",
      revision: "rev-1",
      summarySnapshot: buildDiffSummarySnapshot(initial),
      path: "src/open.ts",
    });
    act(() => void queryClient.setQueryData(summaryKey, changed));
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("rev-2"));
    await waitFor(() =>
      expect(
        requestDiffFile.mock.calls.some(
          ([, path, rev]) => path === "src/open.ts" && rev === "rev-2",
        ),
      ).toBe(true),
    );
    expect(result.current.diffOpen["src/open.ts"]).toBe(true);
    expect(result.current.diffOpen["src/removed.ts"]).toBeUndefined();
    expect(result.current.diffFiles["src/removed.ts"]).toBeUndefined();
    expect(result.current.diffFiles["src/external.ts"]).toBeUndefined();
    expect(signals.some((signal) => signal.aborted)).toBe(true);
    await waitFor(() => expect(queryClient.getQueryData(oldOpenKey)).toBeUndefined());
    expect(
      requestDiffFile.mock.calls.some(
        ([, path, rev]) => path === "src/removed.ts" && rev === "rev-2",
      ),
    ).toBe(false);
  });

  it("drops every file resource on scope change and ignores an A to B to A stale response", async () => {
    const staleA = createControllable<ReturnType<typeof createDiffFile>>();
    let firstA = true;
    let oldSignal: AbortSignal | undefined;
    const requestDiffSummary = vi.fn(async (paneId: string) =>
      createDiffSummary({ rev: paneId === "pane-a" ? "rev-a" : "rev-b" }),
    );
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (paneId, path, rev, _options, signal) => {
        if (paneId === "pane-a" && firstA) {
          firstA = false;
          oldSignal = signal;
          return staleA.promise;
        }
        return createDiffFile({ path, rev: rev ?? null, patch: paneId });
      },
    );
    const { result, rerender, queryClient } = renderDiffs({
      requestDiffSummary,
      requestDiffFile,
      initialProps: { paneId: "pane-a" },
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("rev-a"));
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(1));

    rerender({
      paneId: "pane-b",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("rev-b"));
    expect(result.current.diffOpen).toEqual({});
    expect(oldSignal?.aborted).toBe(true);
    rerender({
      paneId: "pane-a",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(result.current.diffSummary?.rev).toBe("rev-a"));
    await act(async () => staleA.resolve(createDiffFile({ rev: "rev-a", patch: "stale" })));
    expect(result.current.diffFiles).toEqual({});
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: sessionDetailQueryKeys.diffFileRoot("pane-a") }),
    ).toEqual([]);
  });

  it.each([
    ["revision", createDiffFile({ rev: "wrong-rev" })],
    ["path", createDiffFile({ path: "src/wrong.ts" })],
  ])("rejects a %s mismatch and refreshes the exact summary once", async (_kind, response) => {
    const summary = createDiffSummary();
    const requestDiffSummary = vi.fn(async () => summary);
    const requestDiffFile = vi.fn(async () => response);
    const { result, queryClient } = renderDiffs({ requestDiffSummary, requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(result.current.diffError).toBe("Failed to load diff file"));
    await waitFor(() => expect(requestDiffSummary).toHaveBeenCalledTimes(2));
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
    const key = sessionDetailQueryKeys.diffFile("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      mode: "total",
      revision: "HEAD",
      summarySnapshot: buildDiffSummarySnapshot(summary),
      path: "src/index.ts",
    });
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  it("reconnects only open missing/error files and reuses open success", async () => {
    const summary = createSummaryWithPaths(["src/success.ts", "src/error.ts", "src/missing.ts"]);
    const pathCalls = new Map<string, number>();
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_pane, path, rev) => {
        const count = (pathCalls.get(path) ?? 0) + 1;
        pathCalls.set(path, count);
        if (path === "src/error.ts" && count === 1) throw new Error("file error");
        return createDiffFile({ path, rev: rev ?? null });
      },
    );
    const { result, rerender } = renderDiffs({
      requestDiffSummary: vi.fn(async () => summary),
      requestDiffFile,
    });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => {
      result.current.toggleDiff("src/success.ts");
      result.current.toggleDiff("src/error.ts");
    });
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(2));
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: false,
    });
    act(() => result.current.toggleDiff("src/missing.ts"));
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(requestDiffFile).toHaveBeenCalledTimes(4));
    expect(pathCalls.get("src/success.ts")).toBe(1);
    expect(pathCalls.get("src/error.ts")).toBe(2);
    expect(pathCalls.get("src/missing.ts")).toBe(1);
  });

  it("starts a disconnected external missing request once after reconnect", async () => {
    const summary = createSummaryWithPaths(["src/success.ts", "src/cold.ts"]);
    const pathCalls = new Map<string, number>();
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_pane, path, rev) => {
        pathCalls.set(path, (pathCalls.get(path) ?? 0) + 1);
        return createDiffFile({ path, rev: rev ?? null });
      },
    );
    const { result, rerender } = renderDiffs({
      requestDiffSummary: vi.fn(async () => summary),
      requestDiffFile,
    });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    await act(async () => result.current.ensureDiffFile("src/success.ts"));
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: false,
    });
    await act(async () => result.current.ensureDiffFile("src/cold.ts"));
    expect(pathCalls.get("src/cold.ts")).toBeUndefined();

    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await waitFor(() => expect(pathCalls.get("src/cold.ts")).toBe(1));
    expect(pathCalls.get("src/success.ts")).toBe(1);
  });

  it("retries an external error only on another ensure", async () => {
    const requestDiffFile = vi
      .fn<UseSessionDiffsParams["requestDiffFile"]>()
      .mockRejectedValueOnce(new Error("external failed"))
      .mockResolvedValueOnce(createDiffFile());
    const { result, rerender } = renderDiffs({ requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    await act(async () => result.current.ensureDiffFile("src/index.ts"));
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: false,
    });
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: true,
    });
    await act(async () => Promise.resolve());
    expect(requestDiffFile).toHaveBeenCalledTimes(1);
    await act(async () => result.current.ensureDiffFile("src/index.ts"));
    expect(requestDiffFile).toHaveBeenCalledTimes(2);
  });

  it("does not show a paused cold file as loading", async () => {
    const summary = createSummaryWithPaths(["src/index.ts", "src/offline.ts"]);
    const requestDiffFile = vi.fn(async (_pane: string, path: string) => createDiffFile({ path }));
    const { result } = renderDiffs({
      requestDiffSummary: vi.fn(async () => summary),
      requestDiffFile,
    });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    onlineManager.setOnline(false);
    act(() => void result.current.ensureDiffFile("src/offline.ts"));
    await act(async () => Promise.resolve());
    expect(requestDiffFile).not.toHaveBeenCalled();
    expect(result.current.diffLoadingFiles["src/offline.ts"]).toBe(false);
  });

  it("hides an old file error while manual summary refresh blocks and then shows its failure", async () => {
    const summary = createSummaryWithPaths(["src/index.ts"]);
    const manualSummary = createControllable<ReturnType<typeof createDiffSummary>>();
    const requestDiffSummary = vi
      .fn<UseSessionDiffsParams["requestDiffSummary"]>()
      .mockResolvedValueOnce(summary)
      .mockImplementationOnce(() => manualSummary.promise);
    const requestDiffFile = vi.fn(async () => {
      throw new Error("file failed");
    });
    const { result } = renderDiffs({ requestDiffSummary, requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(result.current.diffError).toBe("file failed"));

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshDiff();
    });
    await waitFor(() => expect(requestDiffSummary).toHaveBeenCalledTimes(2));
    expect(result.current.diffLoading).toBe(true);
    expect(result.current.diffError).toBeNull();
    manualSummary.reject(new Error("summary failed"));
    await act(async () => refresh);
    expect(result.current.diffError).toBe("summary failed");
  });

  it.each(["disconnect", "unmount", "snapshot"] as const)(
    "uses the committed lifetime guard before cancellation settles after %s",
    async (boundary) => {
      const initialSummary = createDiffSummary({ rev: "rev-1" });
      const changedSummary = createDiffSummary({ rev: "rev-2" });
      const oldFile = createControllable<ReturnType<typeof createDiffFile>>();
      let oldSignal: AbortSignal | undefined;
      let fileCalls = 0;
      const requestDiffSummary = vi.fn(async () => initialSummary);
      const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
        async (_pane, path, rev, _options, signal) => {
          fileCalls += 1;
          if (fileCalls === 1) {
            oldSignal = signal;
            return oldFile.promise;
          }
          return createDiffFile({ path, rev: rev ?? null });
        },
      );
      const rendered = renderDiffs({ requestDiffSummary, requestDiffFile });
      await waitFor(() => expect(rendered.result.current.diffSummary).not.toBeNull());
      act(() => rendered.result.current.toggleDiff("src/index.ts"));
      await waitFor(() => expect(oldSignal).toBeDefined());
      Object.defineProperty(oldSignal!, "aborted", { value: false, configurable: true });

      if (boundary === "disconnect") {
        rendered.rerender({
          paneId: "pane-1",
          repoRoot: "/repo",
          worktreePath: null,
          branch: null,
          connected: false,
        });
      } else if (boundary === "unmount") {
        rendered.unmount();
      } else {
        const summaryKey = sessionDetailQueryKeys.diffSummary("pane-1", {
          repoRoot: "/repo",
          worktreePath: null,
          branch: null,
          mode: "total",
        });
        act(() => void rendered.queryClient.setQueryData(summaryKey, changedSummary));
      }
      expect(oldSignal?.aborted).toBe(false);
      await act(async () => {
        oldFile.resolve(createDiffFile({ path: "src/wrong.ts", rev: "wrong-rev" }));
        await Promise.resolve();
      });
      expect(requestDiffSummary).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts summary and file roots on disconnect", async () => {
    const file = createControllable<ReturnType<typeof createDiffFile>>();
    const manual = createControllable<ReturnType<typeof createDiffSummary>>();
    let fileSignal: AbortSignal | undefined;
    let summarySignal: AbortSignal | undefined;
    const requestDiffSummary = vi
      .fn<UseSessionDiffsParams["requestDiffSummary"]>()
      .mockResolvedValueOnce(createDiffSummary())
      .mockImplementationOnce((_pane, _options, signal) => {
        summarySignal = signal;
        return manual.promise;
      });
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_pane, _path, _rev, _options, signal) => {
        fileSignal = signal;
        return file.promise;
      },
    );
    const { result, rerender } = renderDiffs({ requestDiffSummary, requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => {
      result.current.toggleDiff("src/index.ts");
      void result.current.refreshDiff();
    });
    await waitFor(() => expect(fileSignal).toBeDefined());
    await waitFor(() => expect(summarySignal).toBeDefined());
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      connected: false,
    });
    await waitFor(() => {
      expect(fileSignal?.aborted).toBe(true);
      expect(summarySignal?.aborted).toBe(true);
    });
    expect(result.current.diffError).toBeNull();
  });

  it("aborts and garbage-collects a file Query on unmount", async () => {
    const file = createControllable<ReturnType<typeof createDiffFile>>();
    let signal: AbortSignal | undefined;
    const requestDiffFile = vi.fn<UseSessionDiffsParams["requestDiffFile"]>(
      async (_pane, _path, _rev, _options, requestSignal) => {
        signal = requestSignal;
        return file.promise;
      },
    );
    const { result, unmount, queryClient } = renderDiffs({ requestDiffFile });
    await waitFor(() => expect(result.current.diffSummary).not.toBeNull());
    act(() => result.current.toggleDiff("src/index.ts"));
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => file.resolve(createDiffFile({ patch: "ignored" })));
    await waitFor(() =>
      expect(
        queryClient
          .getQueryCache()
          .findAll({ queryKey: sessionDetailQueryKeys.diffFileRoot("pane-1") }),
      ).toEqual([]),
    );
  });
});
