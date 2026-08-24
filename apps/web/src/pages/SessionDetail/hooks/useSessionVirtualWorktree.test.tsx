import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { WorktreeList } from "@vde-monitor/shared";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { createSessionDetail } from "../test-helpers";
import { useSessionVirtualWorktree } from "./useSessionVirtualWorktree";

const STORAGE_KEY_PREFIX = "vde-monitor:virtual-worktree:v1";

const buildStorageKey = (paneId: string) => `${STORAGE_KEY_PREFIX}:${paneId}`;

const createWorktreeList = (repoRoot: string): WorktreeList => ({
  repoRoot,
  currentPath: `${repoRoot}/main`,
  entries: [
    {
      path: `${repoRoot}/main`,
      branch: "main",
      dirty: false,
      locked: false,
      lockOwner: null,
      lockReason: null,
      merged: false,
    },
    {
      path: `${repoRoot}/feature-a`,
      branch: "feature/a",
      dirty: true,
      locked: false,
      lockOwner: null,
      lockReason: null,
      merged: false,
    },
  ],
});

const createEmptyWorktreeList = (repoRoot: string): WorktreeList => ({
  repoRoot,
  currentPath: `${repoRoot}/main`,
  entries: [],
});

const createMainOnlyWorktreeList = (repoRoot: string): WorktreeList => ({
  repoRoot,
  currentPath: `${repoRoot}/main`,
  entries: [
    {
      path: `${repoRoot}/main`,
      branch: "main",
      dirty: false,
      locked: false,
      lockOwner: null,
      lockReason: null,
      merged: false,
    },
  ],
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const createQueryWrapper = (queryClient = createAppQueryClient()) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useSessionVirtualWorktree", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
    window.localStorage.clear();
  });

  it("loads worktrees with the query abort signal", async () => {
    const repoRoot = "/tmp/repo-a";
    const paneId = "pane-1";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({
            paneId,
            repoRoot,
            worktreePath: `${repoRoot}/main`,
            branch: "main",
          }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.loading).toBe(false);
    });
    expect(requestWorktrees).toHaveBeenCalledWith(paneId, expect.any(AbortSignal));
  });

  it("pauses an offline cold mount without a spinner and resumes once online", async () => {
    onlineManager.setOnline(false);
    const repoRoot = "/tmp/repo-offline";
    const paneId = "pane-offline";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({
            paneId,
            repoRoot,
            worktreePath: `${repoRoot}/main`,
            branch: "main",
          }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("Offline: waiting to load worktrees");
    });
    expect(requestWorktrees).not.toHaveBeenCalled();

    act(() => {
      onlineManager.setOnline(true);
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.error).toBeNull();
    });
    expect(requestWorktrees).toHaveBeenCalledTimes(1);
  });

  it("coalesces the StrictMode replay into one active request", async () => {
    const repoRoot = "/tmp/repo-strict";
    const paneId = "pane-strict";
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let abortedRequests = 0;
    let appliedSuccesses = 0;
    const requestWorktrees = vi.fn(
      (requestPaneId: string, signal?: AbortSignal): Promise<WorktreeList> =>
        new Promise((resolve, reject) => {
          expect(requestPaneId).toBe(paneId);
          activeRequests += 1;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          const timer = window.setTimeout(() => {
            activeRequests -= 1;
            appliedSuccesses += 1;
            resolve(createWorktreeList(repoRoot));
          }, 10);
          signal?.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              activeRequests -= 1;
              abortedRequests += 1;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const queryClient = createAppQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </StrictMode>
    );
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({
            paneId,
            repoRoot,
            worktreePath: `${repoRoot}/main`,
            branch: "main",
          }),
          requestWorktrees,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    expect(requestWorktrees).toHaveBeenCalledTimes(1);
    expect(abortedRequests).toBe(0);
    expect(maxActiveRequests).toBe(1);
    expect(appliedSuccesses).toBe(1);
  });

  it("cancels an in-flight cold request before a manual refresh", async () => {
    const repoRoot = "/tmp/repo-cold-refresh";
    const paneId = "pane-cold-refresh";
    const refreshed = createDeferred<WorktreeList>();
    let initialSignal: AbortSignal | undefined;
    const requestWorktrees = vi.fn(
      (_requestPaneId: string, signal?: AbortSignal): Promise<WorktreeList> => {
        if (requestWorktrees.mock.calls.length === 1) {
          initialSignal = signal;
          return new Promise((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        return refreshed.promise;
      },
    );
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(initialSignal).toBeDefined();
    });
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshWorktrees();
    });

    await waitFor(() => {
      expect(initialSignal?.aborted).toBe(true);
      expect(requestWorktrees).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      refreshed.resolve(createMainOnlyWorktreeList(repoRoot));
      await refreshPromise;
    });
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.loading).toBe(false);
    });
  });

  it("exposes a request error without stale entries on a cold load", async () => {
    const paneId = "pane-error";
    const repoRoot = "/tmp/repo-error";
    const requestWorktrees = vi.fn(async () => {
      throw new Error("worktree api failed");
    });
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.error).toBe("worktree api failed");
    });
    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(requestWorktrees).toHaveBeenCalledTimes(1);
  });

  it("hydrates virtual selection from pane-scoped storage", async () => {
    const repoRoot = "/tmp/repo-stored";
    const paneId = "pane-stored";
    window.localStorage.setItem(
      buildStorageKey(paneId),
      JSON.stringify({
        repoRoot,
        worktreePath: `${repoRoot}/feature-a`,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({
            paneId,
            repoRoot,
            worktreePath: `${repoRoot}/main`,
            branch: "main",
          }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });
  });

  it("does not hydrate selection from another pane", async () => {
    const repoRoot = "/tmp/repo-isolated";
    window.localStorage.setItem(
      buildStorageKey("pane-1"),
      JSON.stringify({
        repoRoot,
        worktreePath: `${repoRoot}/feature-a`,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId: "pane-2",
          session: createSessionDetail({ paneId: "pane-2", repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    expect(result.current.virtualWorktreePath).toBeNull();
    expect(window.localStorage.getItem(buildStorageKey("pane-2"))).toBeNull();
  });

  it("keeps query data and virtual selection pane-scoped across A to B to A", async () => {
    const repoRoot = "/tmp/repo-pane-lifetime";
    const queryClient = createAppQueryClient();
    const wrapper = createQueryWrapper(queryClient);
    const revisitA = createDeferred<WorktreeList>();
    const requestWorktrees = vi.fn((paneId: string): Promise<WorktreeList> => {
      if (paneId === "pane-a" && requestWorktrees.mock.calls.length === 3) {
        return revisitA.promise;
      }
      return Promise.resolve(createWorktreeList(repoRoot));
    });
    const firstA = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId: "pane-a",
          session: createSessionDetail({ paneId: "pane-a", repoRoot }),
          requestWorktrees,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(firstA.result.current.entries).toHaveLength(2);
    });
    act(() => {
      firstA.result.current.selectVirtualWorktree(`${repoRoot}/feature-a`);
    });
    expect(firstA.result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    firstA.unmount();

    const paneB = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId: "pane-b",
          session: createSessionDetail({ paneId: "pane-b", repoRoot }),
          requestWorktrees,
        }),
      { wrapper },
    );
    await waitFor(() => {
      expect(paneB.result.current.entries).toHaveLength(2);
    });
    expect(paneB.result.current.virtualWorktreePath).toBeNull();
    paneB.unmount();

    await waitFor(() => {
      expect(queryClient.getQueryData(sessionDetailQueryKeys.worktrees("pane-a", repoRoot))).toBe(
        undefined,
      );
    });
    const secondA = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId: "pane-a",
          session: createSessionDetail({ paneId: "pane-a", repoRoot }),
          requestWorktrees,
        }),
      { wrapper },
    );

    expect(secondA.result.current.entries).toEqual([]);
    expect(secondA.result.current.loading).toBe(true);
    expect(secondA.result.current.virtualWorktreePath).toBeNull();
    await act(async () => {
      revisitA.resolve(createWorktreeList(repoRoot));
      await revisitA.promise;
    });
    await waitFor(() => {
      expect(secondA.result.current.entries).toHaveLength(2);
      expect(secondA.result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });
  });

  it("persists and clears a virtual selection", async () => {
    const repoRoot = "/tmp/repo-select";
    const paneId = "pane-select";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({
            paneId,
            repoRoot,
            worktreePath: `${repoRoot}/main`,
            branch: "main",
          }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    act(() => {
      result.current.selectVirtualWorktree(`${repoRoot}/feature-a`);
    });
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain(`${repoRoot}/feature-a`);

    act(() => {
      result.current.clearVirtualWorktree();
    });
    expect(result.current.virtualWorktreePath).toBeNull();
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("keeps a stored selection when a manual refresh is temporarily empty", async () => {
    const repoRoot = "/tmp/repo-empty";
    const paneId = "pane-empty";
    window.localStorage.setItem(
      buildStorageKey(paneId),
      JSON.stringify({
        repoRoot,
        worktreePath: `${repoRoot}/feature-a`,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const requestWorktrees = vi
      .fn(async () => createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createEmptyWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });
    await act(async () => {
      await result.current.refreshWorktrees();
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain(`${repoRoot}/feature-a`);
  });

  it("clears a stored selection that disappears from a non-empty refresh", async () => {
    const repoRoot = "/tmp/repo-invalidated";
    const paneId = "pane-invalidated";
    window.localStorage.setItem(
      buildStorageKey(paneId),
      JSON.stringify({
        repoRoot,
        worktreePath: `${repoRoot}/feature-a`,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const requestWorktrees = vi
      .fn(async () => createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createMainOnlyWorktreeList(repoRoot));
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });
    await act(async () => {
      await result.current.refreshWorktrees();
    });

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBeNull();
    });
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("clears a virtual selection when the actual worktree catches up", async () => {
    const repoRoot = "/tmp/repo-caught-up";
    const paneId = "pane-caught-up";
    window.localStorage.setItem(
      buildStorageKey(paneId),
      JSON.stringify({
        repoRoot,
        worktreePath: `${repoRoot}/feature-a`,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result, rerender } = renderHook(
      ({ worktreePath, branch }: { worktreePath: string; branch: string }) =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot, worktreePath, branch }),
          requestWorktrees,
        }),
      {
        initialProps: { worktreePath: `${repoRoot}/main`, branch: "main" },
        wrapper: createQueryWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });
    rerender({ worktreePath: `${repoRoot}/feature-a`, branch: "feature/a" });

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBeNull();
    });
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("keeps previous data visible and loading false during manual refresh", async () => {
    const repoRoot = "/tmp/repo-refresh";
    const paneId = "pane-refresh";
    const deferred = createDeferred<WorktreeList>();
    const requestWorktrees = vi
      .fn(async () => createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createWorktreeList(repoRoot))
      .mockImplementationOnce(async () => deferred.promise);
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    act(() => {
      void result.current.refreshWorktrees();
    });
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      deferred.resolve(createEmptyWorktreeList(repoRoot));
      await deferred.promise;
    });
    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(requestWorktrees).toHaveBeenCalledTimes(2);
  });

  it("hides a warm refresh error while retrying and keeps previous data visible", async () => {
    const repoRoot = "/tmp/repo-retry";
    const paneId = "pane-retry";
    const retried = createDeferred<WorktreeList>();
    const requestWorktrees = vi
      .fn(async () => createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createWorktreeList(repoRoot))
      .mockRejectedValueOnce(new Error("temporary worktree failure"))
      .mockImplementationOnce(async () => retried.promise);
    const { result } = renderHook(
      () =>
        useSessionVirtualWorktree({
          paneId,
          session: createSessionDetail({ paneId, repoRoot }),
          requestWorktrees,
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    await act(async () => {
      await result.current.refreshWorktrees();
    });
    await waitFor(() => {
      expect(result.current.error).toBe("temporary worktree failure");
    });

    act(() => {
      void result.current.refreshWorktrees();
    });
    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      retried.resolve(createMainOnlyWorktreeList(repoRoot));
      await retried.promise;
    });
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
  });

  it("does not auto-refresh without an explicit trigger", async () => {
    vi.useFakeTimers();
    try {
      const repoRoot = "/tmp/repo-no-poll";
      const paneId = "pane-no-poll";
      const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
      const { unmount } = renderHook(
        () =>
          useSessionVirtualWorktree({
            paneId,
            session: createSessionDetail({ paneId, repoRoot }),
            requestWorktrees,
          }),
        { wrapper: createQueryWrapper() },
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(requestWorktrees).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(requestWorktrees).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
