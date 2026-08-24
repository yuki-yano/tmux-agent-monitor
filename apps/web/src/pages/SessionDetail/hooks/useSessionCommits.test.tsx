import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { buildCommitLogSnapshot } from "../sessionDetailUtils";
import {
  createCommitDetail,
  createCommitFileDiff,
  createCommitLog,
  createDeferred,
} from "../test-helpers";
import { type UseSessionCommitsParams, useSessionCommits } from "./useSessionCommits";

const createCommit = (hash: string) => ({
  ...createCommitLog().commits[0]!,
  hash,
  shortHash: hash,
});

const createHarness = (strict = false) => {
  const queryClient = createAppQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
  return { queryClient, Wrapper };
};

type HookProps = {
  paneId: string;
  repoRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
  isConnected: boolean;
};

const renderCommits = ({
  connected = true,
  strict = false,
  requestCommitLog = vi.fn<UseSessionCommitsParams["requestCommitLog"]>(async () =>
    createCommitLog(),
  ),
  requestCommitDetail = vi.fn<UseSessionCommitsParams["requestCommitDetail"]>(async () =>
    createCommitDetail(),
  ),
  requestCommitFile = vi.fn<UseSessionCommitsParams["requestCommitFile"]>(async () =>
    createCommitFileDiff(),
  ),
}: {
  connected?: boolean;
  strict?: boolean;
  requestCommitLog?: UseSessionCommitsParams["requestCommitLog"];
  requestCommitDetail?: UseSessionCommitsParams["requestCommitDetail"];
  requestCommitFile?: UseSessionCommitsParams["requestCommitFile"];
} = {}) => {
  const { queryClient, Wrapper } = createHarness(strict);
  const rendered = renderHook<ReturnType<typeof useSessionCommits>, HookProps>(
    ({ paneId, repoRoot, worktreePath, branch, isConnected }) =>
      useSessionCommits({
        paneId,
        repoRoot,
        connected: isConnected,
        worktreePath,
        branch,
        requestCommitLog,
        requestCommitDetail,
        requestCommitFile,
      }),
    {
      wrapper: Wrapper,
      initialProps: {
        paneId: "pane-1",
        repoRoot: "/repo",
        worktreePath: null as string | null,
        branch: null as string | null,
        isConnected: connected,
      },
    },
  );
  return { ...rendered, queryClient, requestCommitLog, requestCommitDetail, requestCommitFile };
};

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("useSessionCommits Query resources", () => {
  it("loads one head observer with the exact key/options and AbortSignal", async () => {
    const requestCommitLog = vi.fn(async () => createCommitLog());
    const { result, queryClient } = renderCommits({ requestCommitLog, strict: true });

    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    expect(requestCommitLog).toHaveBeenCalledTimes(1);
    expect(requestCommitLog).toHaveBeenCalledWith(
      "pane-1",
      { limit: 10, skip: 0, force: true },
      expect.any(AbortSignal),
    );
    const key = sessionDetailQueryKeys.commitLogHead("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      limit: 10,
    });
    const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
    expect(query?.getObserversCount()).toBe(1);
    expect(query?.options).toMatchObject({
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "online",
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchIntervalInBackground: false,
    });
    const tailKey = sessionDetailQueryKeys.commitLogTail("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      expectedRev: result.current.commitLog?.rev ?? null,
      headSnapshot: buildCommitLogSnapshot(result.current.commitLog!),
      limit: 10,
    });
    const tailQuery = queryClient.getQueryCache().find({ queryKey: tailKey, exact: true });
    expect(tailQuery?.getObserversCount()).toBe(1);
    expect(tailQuery?.options).toMatchObject({
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
      networkMode: "online",
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });

  it("does not request on a disconnected cold mount and requests once when reconnected", async () => {
    const requestCommitLog = vi.fn(async () => createCommitLog());
    const { result, rerender } = renderCommits({ connected: false, requestCommitLog });

    await act(async () => Promise.resolve());
    expect(requestCommitLog).not.toHaveBeenCalled();
    expect(result.current.commitLoading).toBe(false);

    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      isConnected: true,
    });
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    expect(requestCommitLog).toHaveBeenCalledTimes(1);
  });

  it("keeps a connected cold query paused offline and requests once when the browser is online", async () => {
    onlineManager.setOnline(false);
    const requestCommitLog = vi.fn(async () => createCommitLog());
    const { result } = renderCommits({ requestCommitLog });

    await waitFor(() =>
      expect(result.current.commitError).toBe("Offline: waiting to load commits"),
    );
    expect(requestCommitLog).not.toHaveBeenCalled();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    expect(requestCommitLog).toHaveBeenCalledTimes(1);
  });

  it("loads with repoRoot null and never mixes worktreePath into a branch request", async () => {
    const requestCommitLog = vi.fn<UseSessionCommitsParams["requestCommitLog"]>(async () =>
      createCommitLog({ repoRoot: null }),
    );
    const { result, rerender } = renderCommits({ requestCommitLog });
    rerender({
      paneId: "pane-1",
      repoRoot: null,
      worktreePath: "/repo/worktree",
      branch: "feature/a",
      isConnected: true,
    });
    await waitFor(() => expect(result.current.commitLog?.repoRoot).toBeNull());
    const branchCall = requestCommitLog.mock.calls.find(([, options]) => options?.branch != null);
    expect(branchCall?.[1]).toEqual({
      limit: 10,
      skip: 0,
      force: true,
      branch: "feature/a",
    });
    expect(branchCall?.[1]).not.toHaveProperty("worktreePath");
  });

  it("copies a commit hash and exposes the copied indicator", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderCommits();

    await act(async () => result.current.copyHash("abc123"));
    expect(writeText).toHaveBeenCalledWith("abc123");
    expect(result.current.copiedHash).toBe("abc123");
  });

  it("clears only the latest copied hash timer and ignores an old-scope timer", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result, rerender } = renderCommits();
    vi.useFakeTimers();
    try {
      await act(async () => result.current.copyHash("first"));
      await act(async () => vi.advanceTimersByTimeAsync(600));
      await act(async () => result.current.copyHash("second"));
      await act(async () => vi.advanceTimersByTimeAsync(600));
      expect(result.current.copiedHash).toBe("second");

      rerender({
        paneId: "pane-2",
        repoRoot: "/repo-2",
        worktreePath: null,
        branch: null,
        isConnected: true,
      });
      await act(async () => result.current.copyHash("new-scope"));
      await act(async () => vi.advanceTimersByTimeAsync(600));
      expect(result.current.copiedHash).toBe("new-scope");
      await act(async () => vi.advanceTimersByTimeAsync(600));
      expect(result.current.copiedHash).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps detail/file observers after close, coalesces toggles, and retries failures on reopen", async () => {
    const detailFailure = new Error("detail failed");
    const fileFailure = new Error("file failed");
    const requestCommitDetail = vi
      .fn()
      .mockRejectedValueOnce(detailFailure)
      .mockResolvedValue(createCommitDetail());
    const requestCommitFile = vi
      .fn()
      .mockRejectedValueOnce(fileFailure)
      .mockResolvedValue(createCommitFileDiff());
    const { result, queryClient } = renderCommits({ requestCommitDetail, requestCommitFile });
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());

    act(() => result.current.toggleCommit("abc123"));
    await waitFor(() => expect(requestCommitDetail).toHaveBeenCalledTimes(1));
    expect(requestCommitDetail).toHaveBeenCalledWith(
      "pane-1",
      "abc123",
      { force: true },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(result.current.commitError).toContain("detail failed"));
    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommit("abc123"));
    await waitFor(() => expect(requestCommitDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.commitDetails.abc123).toBeDefined());

    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(requestCommitFile).toHaveBeenCalledTimes(1));
    expect(requestCommitFile).toHaveBeenCalledWith(
      "pane-1",
      "abc123",
      "src/index.ts",
      { force: true },
      expect.any(AbortSignal),
    );
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(requestCommitFile).toHaveBeenCalledTimes(2));
    const activeQueries = queryClient
      .getQueryCache()
      .findAll({ queryKey: sessionDetailQueryKeys.commitsRoot("pane-1") })
      .filter((query) => query.getObserversCount() > 0);
    expect(activeQueries).toHaveLength(4);
    expect(activeQueries.every((query) => query.getObserversCount() === 1)).toBe(true);
    const detailQuery = queryClient.getQueryCache().find({
      queryKey: sessionDetailQueryKeys.commitDetail("pane-1", {
        repoRoot: "/repo",
        worktreePath: null,
        branch: null,
        hash: "abc123",
      }),
      exact: true,
    });
    const fileQuery = queryClient.getQueryCache().find({
      queryKey: sessionDetailQueryKeys.commitFile("pane-1", {
        repoRoot: "/repo",
        worktreePath: null,
        branch: null,
        hash: "abc123",
        path: "src/index.ts",
      }),
      exact: true,
    });
    expect(detailQuery?.options).toMatchObject({
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
      networkMode: "online",
    });
    expect(fileQuery?.options).toMatchObject({
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
      networkMode: "online",
    });
  });

  it("prioritizes a manual head error over the last interactive detail/file error", async () => {
    const requestCommitLog = vi
      .fn()
      .mockResolvedValueOnce(createCommitLog())
      .mockRejectedValueOnce(new Error("manual head failed"));
    const requestCommitDetail = vi.fn().mockRejectedValue(new Error("detail failed"));
    const requestCommitFile = vi.fn().mockRejectedValue(new Error("file failed"));
    const { result } = renderCommits({
      requestCommitLog,
      requestCommitDetail,
      requestCommitFile,
    });
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    act(() => result.current.toggleCommit("abc123"));
    await waitFor(() => expect(result.current.commitError).toContain("detail failed"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(result.current.commitError).toContain("file failed"));

    await act(async () => result.current.refreshCommitLog());
    expect(result.current.commitError).toContain("manual head failed");
  });

  it("does not retry closed detail/file errors on reconnect and retries only when reopened", async () => {
    const requestCommitDetail = vi
      .fn()
      .mockRejectedValueOnce(new Error("detail failed"))
      .mockResolvedValue(createCommitDetail());
    const requestCommitFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("file failed"))
      .mockResolvedValue(createCommitFileDiff());
    const { result, rerender } = renderCommits({ requestCommitDetail, requestCommitFile });
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(requestCommitDetail).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(requestCommitFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.commitError).toContain("file failed"));
    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));

    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      isConnected: false,
    });
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      isConnected: true,
    });
    await act(async () => Promise.resolve());
    expect(requestCommitDetail).toHaveBeenCalledTimes(1);
    expect(requestCommitFile).toHaveBeenCalledTimes(1);

    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(requestCommitDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(requestCommitFile).toHaveBeenCalledTimes(2));
  });

  it("keeps successful closed detail/file observers and reopens without another request", async () => {
    const requestCommitDetail = vi.fn(async () => createCommitDetail());
    const requestCommitFile = vi.fn(async () => createCommitFileDiff());
    const { result, queryClient } = renderCommits({ requestCommitDetail, requestCommitFile });
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(result.current.commitDetails.abc123).toBeDefined());
    await waitFor(() =>
      expect(result.current.commitFileDetails["abc123:src/index.ts"]).toBeDefined(),
    );
    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));

    const detailKey = sessionDetailQueryKeys.commitDetail("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      hash: "abc123",
    });
    const fileKey = sessionDetailQueryKeys.commitFile("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      hash: "abc123",
      path: "src/index.ts",
    });
    expect(
      queryClient.getQueryCache().find({ queryKey: detailKey, exact: true })?.getObserversCount(),
    ).toBe(1);
    expect(
      queryClient.getQueryCache().find({ queryKey: fileKey, exact: true })?.getObserversCount(),
    ).toBe(1);

    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await act(async () => Promise.resolve());
    expect(requestCommitDetail).toHaveBeenCalledTimes(1);
    expect(requestCommitFile).toHaveBeenCalledTimes(1);
  });

  it("uses raw page lengths for tail skips and preserves tail/open state after an unchanged refresh", async () => {
    const head = createCommitLog({
      rev: "rev-1",
      commits: Array.from({ length: 10 }, (_, index) => createCommit(`h${index}`)),
      totalCount: 22,
    });
    const tail1 = createCommitLog({
      rev: "rev-1",
      commits: [createCommit("h10"), createCommit("h11"), createCommit("h11")],
      totalCount: 22,
    });
    const tail2 = createCommitLog({
      rev: "rev-1",
      commits: [createCommit("h13")],
      totalCount: 14,
    });
    const requestCommitLog = vi
      .fn()
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(tail1)
      .mockResolvedValueOnce(tail2)
      .mockResolvedValueOnce({ ...head, generatedAt: new Date(1).toISOString() });
    const requestCommitDetail = vi.fn(async () => createCommitDetail({ hash: "h0" }));
    const requestCommitFile = vi.fn(async () => createCommitFileDiff({ path: "src/index.ts" }));
    const { result } = renderCommits({
      requestCommitLog,
      requestCommitDetail,
      requestCommitFile,
    });
    await waitFor(() => expect(result.current.commitLog?.commits).toHaveLength(10));
    act(() => result.current.toggleCommit("h0"));
    act(() => result.current.toggleCommitFile("h0", "src/index.ts"));
    await waitFor(() => expect(result.current.commitDetails.h0).toBeDefined());
    await waitFor(() => expect(result.current.commitFileDetails["h0:src/index.ts"]).toBeDefined());
    await act(async () => result.current.loadMoreCommits());
    await act(async () => result.current.loadMoreCommits());
    expect(requestCommitLog.mock.calls[1]?.[1]?.skip).toBe(10);
    expect(requestCommitLog.mock.calls[2]?.[1]?.skip).toBe(13);
    await waitFor(() =>
      expect(result.current.commitLog?.commits.map(({ hash }) => hash)).toContain("h13"),
    );

    await act(async () => result.current.refreshCommitLog());
    expect(result.current.commitOpen.h0).toBe(true);
    expect(result.current.commitFileOpen["h0:src/index.ts"]).toBe(true);
    expect(result.current.commitDetails.h0).toBeDefined();
    expect(result.current.commitFileDetails["h0:src/index.ts"]).toBeDefined();
    expect(requestCommitDetail).toHaveBeenCalledTimes(1);
    expect(requestCommitFile).toHaveBeenCalledTimes(1);
    expect(result.current.commitLog?.commits.map(({ hash }) => hash)).toContain("h13");
  });

  it("drops tail and prunes requested/open data when the head snapshot changes", async () => {
    const oldHead = createCommitLog({
      rev: "rev-old",
      commits: Array.from({ length: 10 }, (_, index) => createCommit(`old${index}`)),
      totalCount: 11,
    });
    const tail = createCommitLog({
      rev: "rev-old",
      commits: [createCommit("old10")],
      totalCount: 11,
    });
    const nextHead = createCommitLog({
      rev: "rev-new",
      commits: [createCommit("new0")],
      totalCount: 1,
    });
    const requestCommitLog = vi
      .fn()
      .mockResolvedValueOnce(oldHead)
      .mockResolvedValueOnce(tail)
      .mockResolvedValueOnce(nextHead);
    const { result } = renderCommits({ requestCommitLog });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("rev-old"));
    act(() => result.current.toggleCommit("old0"));
    await act(async () => result.current.loadMoreCommits());
    await waitFor(() => expect(result.current.commitLog?.commits).toHaveLength(11));

    await act(async () => result.current.refreshCommitLog());
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("rev-new"));
    expect(result.current.commitLog?.commits.map(({ hash }) => hash)).toEqual(["new0"]);
    expect(result.current.commitOpen).toEqual({});
    expect(result.current.commitDetails).toEqual({});
  });

  it("cold-switches the tail and resets its skip when the head snapshot changes at the same rev", async () => {
    const oldHead = createCommitLog({
      rev: "same-rev",
      commits: Array.from({ length: 10 }, (_, index) => createCommit(`old${index}`)),
      totalCount: 11,
    });
    const oldTail = createCommitLog({
      rev: "same-rev",
      commits: [createCommit("old10")],
      totalCount: 11,
    });
    const nextHead = createCommitLog({
      rev: "same-rev",
      commits: ["old0", "new1", "new2", "new3", "new4"].map(createCommit),
      totalCount: 6,
    });
    const nextTail = createCommitLog({
      rev: "same-rev",
      commits: [createCommit("new5")],
      totalCount: 6,
    });
    const requestCommitLog = vi
      .fn()
      .mockResolvedValueOnce(oldHead)
      .mockResolvedValueOnce(oldTail)
      .mockResolvedValueOnce(nextHead)
      .mockResolvedValueOnce(nextTail);
    const requestCommitDetail = vi.fn(async (_paneId: string, hash: string) =>
      createCommitDetail({ hash }),
    );
    const requestCommitFile = vi.fn(async () => createCommitFileDiff());
    const { result, queryClient } = renderCommits({
      requestCommitLog,
      requestCommitDetail,
      requestCommitFile,
    });
    await waitFor(() => expect(result.current.commitLog?.commits).toHaveLength(10));
    act(() => {
      result.current.toggleCommit("old0");
      result.current.toggleCommit("old9");
      result.current.toggleCommitFile("old9", "src/old.ts");
    });
    await waitFor(() => expect(result.current.commitDetails.old9).toBeDefined());
    await act(async () => result.current.loadMoreCommits());
    await waitFor(() => expect(result.current.commitLog?.commits).toHaveLength(11));
    const oldTailKey = sessionDetailQueryKeys.commitLogTail("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      expectedRev: "same-rev",
      headSnapshot: buildCommitLogSnapshot(oldHead),
      limit: 10,
    });
    expect(queryClient.getQueryData(oldTailKey)).toBeDefined();

    await act(async () => result.current.refreshCommitLog());
    await waitFor(() =>
      expect(result.current.commitLog?.commits.map(({ hash }) => hash)).toEqual([
        "old0",
        "new1",
        "new2",
        "new3",
        "new4",
      ]),
    );
    expect(result.current.commitOpen.old0).toBe(true);
    expect(result.current.commitDetails.old0).toBeDefined();
    expect(result.current.commitOpen.old9).toBeUndefined();
    expect(result.current.commitDetails.old9).toBeUndefined();
    expect(result.current.commitFileOpen["old9:src/old.ts"]).toBeUndefined();
    expect(queryClient.getQueryData(oldTailKey)).toBeUndefined();

    await act(async () => result.current.loadMoreCommits());
    expect(requestCommitLog.mock.calls[3]?.[1]?.skip).toBe(5);
    await waitFor(() =>
      expect(result.current.commitLog?.commits.map(({ hash }) => hash)).toContain("new5"),
    );
  });

  it("rejects a mismatched tail, resets it, and force-refreshes the head", async () => {
    const head = createCommitLog({
      rev: "rev-1",
      commits: Array.from({ length: 10 }, (_, index) => createCommit(`h${index}`)),
      totalCount: 20,
    });
    const mismatch = createCommitLog({
      rev: "rev-2",
      commits: [createCommit("wrong")],
    });
    const refreshed = createCommitLog({ rev: "rev-2", commits: [createCommit("new")] });
    const requestCommitLog = vi
      .fn()
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(mismatch)
      .mockResolvedValueOnce(refreshed);
    const { result } = renderCommits({ requestCommitLog });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("rev-1"));
    await act(async () => result.current.loadMoreCommits());
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("rev-2"));
    expect(result.current.commitLog?.commits.map(({ hash }) => hash)).toEqual(["new"]);
    expect(requestCommitLog).toHaveBeenCalledTimes(3);
  });

  it("keeps the newest manual head refresh when cancelled requests resolve out of order", async () => {
    let rejectStale: ((error: Error) => void) | undefined;
    const stalePromise = new Promise<ReturnType<typeof createCommitLog>>((_resolve, reject) => {
      rejectStale = reject;
    });
    const fresh = createDeferred<ReturnType<typeof createCommitLog>>();
    const requestCommitLog = vi
      .fn<UseSessionCommitsParams["requestCommitLog"]>()
      .mockResolvedValueOnce(createCommitLog({ rev: "initial" }))
      .mockImplementationOnce(() => stalePromise)
      .mockImplementationOnce(() => fresh.promise);
    const { result } = renderCommits({ requestCommitLog });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("initial"));

    let firstRefresh: Promise<void>;
    act(() => {
      firstRefresh = result.current.refreshCommitLog();
    });
    await waitFor(() => expect(requestCommitLog).toHaveBeenCalledTimes(2));
    let secondRefresh: Promise<void>;
    act(() => {
      secondRefresh = result.current.refreshCommitLog();
    });
    await waitFor(() => expect(requestCommitLog).toHaveBeenCalledTimes(3));
    rejectStale?.(new Error("stale manual failure"));
    await act(async () => firstRefresh!);
    expect(result.current.commitLoading).toBe(true);
    expect(result.current.commitError).toBeNull();

    fresh.resolve(createCommitLog({ rev: "fresh" }));
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("fresh"));
    await act(async () => secondRefresh!);
    expect(result.current.commitLog?.rev).toBe("fresh");
    expect(result.current.commitLoading).toBe(false);
    expect(result.current.commitError).toBeNull();
  });

  it("does not apply an old A manual failure or finally after an A to B to A transition", async () => {
    let rejectOldA: ((error: Error) => void) | undefined;
    const oldAPromise = new Promise<ReturnType<typeof createCommitLog>>((_resolve, reject) => {
      rejectOldA = reject;
    });
    const freshA = createDeferred<ReturnType<typeof createCommitLog>>();
    let aCalls = 0;
    const requestCommitLog = vi.fn((paneId: string) => {
      if (paneId === "pane-2") return Promise.resolve(createCommitLog({ rev: "pane-b" }));
      aCalls += 1;
      if (aCalls === 1) return Promise.resolve(createCommitLog({ rev: "pane-a-initial" }));
      if (aCalls === 2) return oldAPromise;
      return freshA.promise;
    });
    const { result, rerender } = renderCommits({ requestCommitLog });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("pane-a-initial"));
    let oldARefresh: Promise<void>;
    act(() => {
      oldARefresh = result.current.refreshCommitLog();
    });
    await waitFor(() => expect(aCalls).toBe(2));

    rerender({
      paneId: "pane-2",
      repoRoot: "/repo-b",
      worktreePath: null,
      branch: null,
      isConnected: true,
    });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("pane-b"));
    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      isConnected: true,
    });
    let freshARefresh: Promise<void>;
    act(() => {
      freshARefresh = result.current.refreshCommitLog();
    });
    await waitFor(() => expect(aCalls).toBe(3));

    rejectOldA?.(new Error("old A failure"));
    await act(async () => oldARefresh!);
    expect(result.current.commitLoading).toBe(true);
    expect(result.current.commitError).toBeNull();

    freshA.resolve(createCommitLog({ rev: "pane-a-fresh" }));
    await act(async () => freshARefresh!);
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("pane-a-fresh"));
    expect(result.current.commitLoading).toBe(false);
    expect(result.current.commitError).toBeNull();
  });

  it("cancels the commits root on disconnect and isolates stale scope responses", async () => {
    const pane1 = createDeferred<ReturnType<typeof createCommitLog>>();
    const requestCommitLog = vi.fn((paneId: string) =>
      paneId === "pane-1" ? pane1.promise : Promise.resolve(createCommitLog({ rev: "pane-2" })),
    );
    const { result, rerender, queryClient } = renderCommits({ requestCommitLog });
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    rerender({
      paneId: "pane-2",
      repoRoot: "/repo-2",
      worktreePath: null,
      branch: null,
      isConnected: true,
    });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("pane-2"));
    pane1.resolve(createCommitLog({ rev: "pane-1" }));
    await act(async () => Promise.resolve());
    expect(result.current.commitLog?.rev).toBe("pane-2");

    rerender({
      paneId: "pane-2",
      repoRoot: "/repo-2",
      worktreePath: null,
      branch: null,
      isConnected: false,
    });
    await waitFor(() =>
      expect(cancelSpy).toHaveBeenCalledWith({
        queryKey: sessionDetailQueryKeys.commitsRoot("pane-2"),
      }),
    );
  });

  it("aborts and discards old detail/file responses after a scope change", async () => {
    const detail = createDeferred<ReturnType<typeof createCommitDetail>>();
    const file = createDeferred<ReturnType<typeof createCommitFileDiff>>();
    const detailSignals: AbortSignal[] = [];
    const fileSignals: AbortSignal[] = [];
    const requestCommitLog = vi.fn<UseSessionCommitsParams["requestCommitLog"]>(
      async (_paneId, options) =>
        createCommitLog({
          rev: options?.branch == null ? "main-rev" : "branch-rev",
          commits: [createCommit(options?.branch == null ? "abc123" : "branch123")],
        }),
    );
    const requestCommitDetail = vi.fn<UseSessionCommitsParams["requestCommitDetail"]>(
      async (_paneId, _hash, _options, signal) => {
        detailSignals.push(signal!);
        return detail.promise;
      },
    );
    const requestCommitFile = vi.fn<UseSessionCommitsParams["requestCommitFile"]>(
      async (_paneId, _hash, _path, _options, signal) => {
        fileSignals.push(signal!);
        return file.promise;
      },
    );
    const { result, rerender, queryClient } = renderCommits({
      requestCommitLog,
      requestCommitDetail,
      requestCommitFile,
    });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("main-rev"));
    act(() => result.current.toggleCommit("abc123"));
    act(() => result.current.toggleCommitFile("abc123", "src/index.ts"));
    await waitFor(() => expect(detailSignals).toHaveLength(1));
    await waitFor(() => expect(fileSignals).toHaveLength(1));

    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: "feature/a",
      isConnected: true,
    });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("branch-rev"));
    expect(detailSignals[0]?.aborted).toBe(true);
    expect(fileSignals[0]?.aborted).toBe(true);
    detail.resolve(createCommitDetail({ hash: "abc123" }));
    file.resolve(createCommitFileDiff({ path: "src/index.ts" }));
    await act(async () => Promise.resolve());

    const oldDetailKey = sessionDetailQueryKeys.commitDetail("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      hash: "abc123",
    });
    const oldFileKey = sessionDetailQueryKeys.commitFile("pane-1", {
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      hash: "abc123",
      path: "src/index.ts",
    });
    expect(queryClient.getQueryData(oldDetailKey)).toBeUndefined();
    expect(queryClient.getQueryData(oldFileKey)).toBeUndefined();
    expect(result.current.commitDetails).toEqual({});
    expect(result.current.commitFileDetails).toEqual({});
  });

  it("aborts active head-tail/detail/file requests when disconnected", async () => {
    const head = createCommitLog({
      rev: "rev-abort",
      commits: Array.from({ length: 10 }, (_, index) => createCommit(`h${index}`)),
      totalCount: 20,
    });
    const signals: AbortSignal[] = [];
    const waitForAbort = <T,>(signal: AbortSignal) =>
      new Promise<T>((_resolve, reject) => {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const requestCommitLog = vi.fn<UseSessionCommitsParams["requestCommitLog"]>(
      async (_paneId, options, signal) => {
        if ((options?.skip ?? 0) === 0 && signals.length === 0) return head;
        return waitForAbort<ReturnType<typeof createCommitLog>>(signal!);
      },
    );
    const requestCommitDetail = vi.fn<UseSessionCommitsParams["requestCommitDetail"]>(
      async (_paneId, _hash, _options, signal) =>
        waitForAbort<ReturnType<typeof createCommitDetail>>(signal!),
    );
    const requestCommitFile = vi.fn<UseSessionCommitsParams["requestCommitFile"]>(
      async (_paneId, _hash, _path, _options, signal) =>
        waitForAbort<ReturnType<typeof createCommitFileDiff>>(signal!),
    );
    const { result, rerender } = renderCommits({
      requestCommitLog,
      requestCommitDetail,
      requestCommitFile,
    });
    await waitFor(() => expect(result.current.commitLog?.rev).toBe("rev-abort"));
    act(() => {
      result.current.toggleCommit("h0");
      result.current.toggleCommitFile("h0", "src/index.ts");
      void result.current.loadMoreCommits();
      void result.current.refreshCommitLog();
    });
    await waitFor(() => expect(signals).toHaveLength(4));

    rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      branch: null,
      isConnected: false,
    });
    await waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
    expect(result.current.commitError).toBeNull();
  });

  it("aborts and discards active detail/file responses on unmount", async () => {
    const detail = createDeferred<ReturnType<typeof createCommitDetail>>();
    const file = createDeferred<ReturnType<typeof createCommitFileDiff>>();
    let detailSignal: AbortSignal | undefined;
    let fileSignal: AbortSignal | undefined;
    const requestCommitLog = vi.fn<UseSessionCommitsParams["requestCommitLog"]>(async () =>
      createCommitLog({ commits: [createCommit("abc123")] }),
    );
    const requestCommitDetail = vi.fn<UseSessionCommitsParams["requestCommitDetail"]>(
      async (_paneId, _hash, _options, signal) => {
        detailSignal = signal;
        return detail.promise;
      },
    );
    const requestCommitFile = vi.fn<UseSessionCommitsParams["requestCommitFile"]>(
      async (_paneId, _hash, _path, _options, signal) => {
        fileSignal = signal;
        return file.promise;
      },
    );
    const { result, unmount, queryClient } = renderCommits({
      requestCommitLog,
      requestCommitDetail,
      requestCommitFile,
    });
    await waitFor(() => expect(result.current.commitLog).not.toBeNull());
    act(() => {
      result.current.toggleCommit("abc123");
      result.current.toggleCommitFile("abc123", "src/index.ts");
    });
    await waitFor(() => expect(detailSignal).toBeDefined());
    await waitFor(() => expect(fileSignal).toBeDefined());

    unmount();
    expect(detailSignal?.aborted).toBe(true);
    expect(fileSignal?.aborted).toBe(true);
    detail.resolve(createCommitDetail({ hash: "abc123" }));
    file.resolve(createCommitFileDiff({ path: "src/index.ts" }));
    await act(async () => Promise.resolve());

    expect(
      queryClient.getQueryData(
        sessionDetailQueryKeys.commitDetail("pane-1", {
          repoRoot: "/repo",
          worktreePath: null,
          branch: null,
          hash: "abc123",
        }),
      ),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(
        sessionDetailQueryKeys.commitFile("pane-1", {
          repoRoot: "/repo",
          worktreePath: null,
          branch: null,
          hash: "abc123",
          path: "src/index.ts",
        }),
      ),
    ).toBeUndefined();
  });

  it("aborts an active cold head request on unmount", async () => {
    let headSignal: AbortSignal | undefined;
    const requestCommitLog = vi.fn<UseSessionCommitsParams["requestCommitLog"]>(
      async (_paneId, _options, signal) => {
        headSignal = signal;
        return new Promise<ReturnType<typeof createCommitLog>>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    );
    const { unmount } = renderCommits({ requestCommitLog });
    await waitFor(() => expect(headSignal).toBeDefined());
    unmount();
    expect(headSignal?.aborted).toBe(true);
  });
});
