import { act, renderHook, waitFor } from "@testing-library/react";
import type { WorktreeList } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("useSessionVirtualWorktree", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("ignores an older response after revisiting a pane and loads the latest response", async () => {
    const repoRootA = "/tmp/repo-a";
    const repoRootB = "/tmp/repo-b";
    const firstADeferred = createDeferred<WorktreeList>();
    const revisitADeferred = createDeferred<WorktreeList>();
    let paneACalls = 0;
    const requestWorktrees = vi.fn((paneId: string) => {
      if (paneId === "pane-a") {
        paneACalls += 1;
        return paneACalls === 1 ? firstADeferred.promise : revisitADeferred.promise;
      }
      return Promise.resolve(createWorktreeList(repoRootB));
    });
    const { result, rerender } = renderHook(
      ({ paneId, repoRoot }: { paneId: string; repoRoot: string }) =>
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
      { initialProps: { paneId: "pane-a", repoRoot: repoRootA } },
    );

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(true);
    });
    rerender({ paneId: "pane-b", repoRoot: repoRootB });
    await waitFor(() => {
      expect(result.current.repoRoot).toBe(repoRootB);
    });
    rerender({ paneId: "pane-a", repoRoot: repoRootA });

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledTimes(3);
      expect(result.current.loading).toBe(true);
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.repoRoot).toBeNull();

    await act(async () => {
      firstADeferred.resolve(createWorktreeList("/tmp/stale-a"));
      await firstADeferred.promise;
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.repoRoot).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      revisitADeferred.resolve(createWorktreeList(repoRootA));
      await revisitADeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.repoRoot).toBe(repoRootA);
      expect(result.current.loading).toBe(false);
    });
  });

  it("requests on offline mount and manual refresh", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const repoRoot = "/tmp/repo-offline";
    const paneId = "pane-offline";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(() =>
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
    );

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.refreshWorktrees();
    });

    expect(requestWorktrees).toHaveBeenCalledTimes(2);
  });

  it("hydrates virtual selection from pane-scoped storage on initial load", async () => {
    const repoRoot = "/tmp/repo-a";
    const paneId = "pane-1";
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
      ({ paneId, session }: { paneId: string; session: ReturnType<typeof createSessionDetail> }) =>
        useSessionVirtualWorktree({
          paneId,
          session,
          requestWorktrees,
        }),
      {
        initialProps: {
          paneId,
          session: createSessionDetail({
            paneId,
            repoRoot,
            worktreePath: `${repoRoot}/main`,
            branch: "main",
          }),
        },
      },
    );

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });
  });

  it("does not hydrate virtual selection from another pane storage", async () => {
    const repoRoot = "/tmp/repo-x";
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
    const { result } = renderHook(() =>
      useSessionVirtualWorktree({
        paneId: "pane-2",
        session: createSessionDetail({
          paneId: "pane-2",
          repoRoot,
          worktreePath: `${repoRoot}/main`,
          branch: "main",
        }),
        requestWorktrees,
      }),
    );

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledWith("pane-2");
    });
    expect(result.current.virtualWorktreePath).toBeNull();
  });

  it("does not copy the current virtual selection into a pane switched to the same repo", async () => {
    const repoRoot = "/tmp/repo-shared";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result, rerender } = renderHook(
      ({ paneId }: { paneId: string }) =>
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
      { initialProps: { paneId: "pane-1" } },
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    act(() => {
      result.current.selectVirtualWorktree(`${repoRoot}/feature-a`);
    });
    await waitFor(() => {
      expect(window.localStorage.getItem(buildStorageKey("pane-1"))).toContain(
        `${repoRoot}/feature-a`,
      );
    });

    rerender({ paneId: "pane-2" });

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledWith("pane-2");
    });
    expect(result.current.virtualWorktreePath).toBeNull();
    expect(window.localStorage.getItem(buildStorageKey("pane-2"))).toBeNull();
  });

  it("clears pane-scoped storage when clearing virtual worktree", async () => {
    const repoRoot = "/tmp/repo-b";
    const paneId = "pane-1";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(() =>
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
    );

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledWith(paneId);
    });

    act(() => {
      result.current.selectVirtualWorktree(`${repoRoot}/feature-a`);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain(
        `${repoRoot}/feature-a`,
      );
    });

    act(() => {
      result.current.clearVirtualWorktree();
    });

    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("resets stale entries when worktree loading fails after pane switch", async () => {
    const requestWorktrees = vi.fn(async (paneId: string) => {
      if (paneId === "pane-1") {
        return createWorktreeList("/tmp/repo-a");
      }
      throw new Error("worktree api failed");
    });

    const { result, rerender } = renderHook(
      ({ paneId, repoRoot }: { paneId: string; repoRoot: string }) =>
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
      {
        initialProps: {
          paneId: "pane-1",
          repoRoot: "/tmp/repo-a",
        },
      },
    );

    await waitFor(() => {
      expect(result.current.entries.length).toBeGreaterThan(0);
    });

    rerender({
      paneId: "pane-2",
      repoRoot: "/tmp/repo-b",
    });

    await waitFor(() => {
      expect(result.current.error).toContain("worktree api failed");
    });
    expect(result.current.entries).toEqual([]);
  });

  it("keeps stored virtual selection when worktree list is temporarily empty", async () => {
    const repoRoot = "/tmp/repo-c";
    const paneId = "pane-1";
    window.localStorage.setItem(
      buildStorageKey(paneId),
      JSON.stringify({
        repoRoot,
        worktreePath: `${repoRoot}/feature-a`,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const requestWorktreesReady = vi.fn(async () => createWorktreeList(repoRoot));
    const requestWorktreesEmpty = vi.fn(async () => createEmptyWorktreeList(repoRoot));
    const { result, rerender } = renderHook(
      ({ requestWorktrees }: { requestWorktrees: (paneId: string) => Promise<WorktreeList> }) =>
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
      {
        initialProps: {
          requestWorktrees: requestWorktreesReady,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    });

    rerender({
      requestWorktrees: requestWorktreesEmpty,
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(result.current.virtualWorktreePath).toBe(`${repoRoot}/feature-a`);
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain(`${repoRoot}/feature-a`);
  });

  it("refreshes worktrees when refreshWorktrees is called", async () => {
    const repoRoot = "/tmp/repo-refresh";
    const paneId = "pane-refresh";
    const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
    const { result } = renderHook(() =>
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
    );

    await waitFor(() => {
      expect(requestWorktrees).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refreshWorktrees();
    });

    expect(requestWorktrees).toHaveBeenCalledTimes(2);
  });

  it("keeps previous entries visible during background refresh", async () => {
    const repoRoot = "/tmp/repo-background-refresh";
    const paneId = "pane-background-refresh";
    const deferred = createDeferred<WorktreeList>();
    const requestWorktrees = vi
      .fn(async () => createWorktreeList(repoRoot))
      .mockResolvedValueOnce(createWorktreeList(repoRoot))
      .mockImplementationOnce(async () => deferred.promise);
    const { result } = renderHook(() =>
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
    );

    await waitFor(() => {
      expect(result.current.entries.length).toBe(2);
    });

    act(() => {
      void result.current.refreshWorktrees();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.entries.length).toBe(2);

    await act(async () => {
      deferred.resolve(createEmptyWorktreeList(repoRoot));
      await deferred.promise;
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
  });

  it("does not auto-refresh worktrees without explicit trigger", async () => {
    vi.useFakeTimers();
    try {
      const repoRoot = "/tmp/repo-auto-refresh";
      const paneId = "pane-auto-refresh";
      const requestWorktrees = vi.fn(async () => createWorktreeList(repoRoot));
      const { unmount } = renderHook(() =>
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(requestWorktrees).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
