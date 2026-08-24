import { QueryObserver, isCancelledError } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import {
  createCommittedFilesLifetimeRef,
  createContentQueryCleanupCoordinator,
  createPreviewLeaseController,
  normalizeAbsoluteLogFilePath,
  normalizeFilesQuery,
  normalizeRepoFilePath,
  registerFilesOwner,
  sameFilesScope,
  unregisterFilesOwner,
} from "./session-files-query-runtime";

describe("session files Query runtime", () => {
  it("normalizes paths and compares every scope dimension", () => {
    expect(normalizeRepoFilePath("src\\index.ts")).toBeNull();
    expect(normalizeRepoFilePath("C:/repo/index.ts")).toBeNull();
    expect(normalizeRepoFilePath("C:relative/index.ts")).toBeNull();
    expect(normalizeRepoFilePath("./src//nested/../index.ts")).toBe("src/index.ts");
    expect(normalizeRepoFilePath("a/./b")).toBe("a/b");
    expect(normalizeRepoFilePath("a/../b")).toBe("b");
    expect(normalizeAbsoluteLogFilePath("/tmp//a/../preview.html")).toBe("/tmp/preview.html");
    expect(normalizeAbsoluteLogFilePath("relative/path")).toBeNull();
    expect(normalizeRepoFilePath("../secret")).toBeNull();
    expect(normalizeRepoFilePath(".", true)).toBe(".");
    expect(normalizeFilesQuery("  index  ")).toBe("index");
    expect(
      sameFilesScope(
        { paneId: "pane", resolvedRoot: "/repo", worktreePath: null },
        { paneId: "pane", resolvedRoot: "/repo", worktreePath: null },
      ),
    ).toBe(true);
    expect(
      sameFilesScope(
        { paneId: "pane", resolvedRoot: "/repo", worktreePath: null },
        { paneId: "pane", resolvedRoot: "/repo", worktreePath: "/worktree" },
      ),
    ).toBe(false);
  });

  it("rejects content after committed scope, target, connection, or signal changes", () => {
    const lifetime = createCommittedFilesLifetimeRef();
    const scope = { paneId: "pane", resolvedRoot: "/repo", worktreePath: null };
    const target = {
      targetPaneId: "pane",
      targetRoot: "/repo",
      targetWorktreePath: null,
      path: "a.ts",
      origin: "navigator" as const,
      highlightLine: null,
    };
    const controller = new AbortController();
    const committed = { scope, connected: true, contentTarget: target };
    lifetime.commit(committed);
    expect(() => lifetime.assertContent(scope, target, controller.signal)).not.toThrow();
    expect(() => lifetime.assertContent({ ...scope }, target, controller.signal)).toThrowError(
      expect.objectContaining({ name: expect.any(String) }),
    );
    lifetime.commit({ scope, connected: false, contentTarget: target });
    try {
      lifetime.assertContent(scope, target, controller.signal);
    } catch (error) {
      expect(isCancelledError(error)).toBe(true);
    }
    lifetime.clear(committed);
    controller.abort();
    expect(() => lifetime.assertContent(scope, target, controller.signal)).toThrow();
  });

  it("releases each preview once and cancels StrictMode deferred cleanup", async () => {
    const revoke = vi.fn(async () => undefined);
    const leases = createPreviewLeaseController(revoke);
    leases.register("pane", "token");
    leases.scheduleReleaseAll();
    leases.cancelScheduledRelease();
    await Promise.resolve();
    expect(revoke).not.toHaveBeenCalled();
    leases.releaseToken("pane", "token");
    leases.releaseToken("pane", "token");
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("removes invalidated content only after its observer leaves and then reopens", async () => {
    const queryClient = createAppQueryClient();
    const queryKey = ["content", "a.ts"] as const;
    queryClient.setQueryData(queryKey, "old");
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: async () => "old",
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const originalRemove = queryClient.removeQueries.bind(queryClient);
    const observerCountsAtRemove: number[] = [];
    const removeQueries = vi.spyOn(queryClient, "removeQueries").mockImplementation((filters) => {
      observerCountsAtRemove.push(
        queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0,
      );
      return originalRemove(filters);
    });
    const reopen = vi.fn();
    const cleanup = createContentQueryCleanupCoordinator();

    cleanup.invalidate(queryClient, queryKey);
    expect(cleanup.reopenAfterCleanup(queryClient, queryKey, reopen)).toBe(true);
    await Promise.resolve();
    expect(removeQueries).not.toHaveBeenCalled();
    expect(reopen).not.toHaveBeenCalled();

    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(observerCountsAtRemove).toEqual([0]);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(reopen).toHaveBeenCalledTimes(1);
    cleanup.dispose();
  });

  it("removes every ready content query before running deferred reopens", async () => {
    const queryClient = createAppQueryClient();
    const firstKey = ["content", "a.ts"] as const;
    const secondKey = ["content", "b.ts"] as const;
    queryClient.setQueryData(firstKey, "a");
    queryClient.setQueryData(secondKey, "b");
    const events: string[] = [];
    const originalRemove = queryClient.removeQueries.bind(queryClient);
    vi.spyOn(queryClient, "removeQueries").mockImplementation((filters) => {
      events.push(`remove:${JSON.stringify(filters?.queryKey)}`);
      return originalRemove(filters);
    });
    const cleanup = createContentQueryCleanupCoordinator();
    cleanup.invalidate(queryClient, firstKey);
    cleanup.invalidate(queryClient, secondKey);
    cleanup.reopenAfterCleanup(queryClient, firstKey, () => events.push("reopen:a"));
    cleanup.reopenAfterCleanup(queryClient, secondKey, () => events.push("reopen:b"));

    await Promise.resolve();
    expect(events).toEqual([
      `remove:${JSON.stringify(firstKey)}`,
      `remove:${JSON.stringify(secondKey)}`,
    ]);
    await Promise.resolve();
    expect(events).toEqual([
      `remove:${JSON.stringify(firstKey)}`,
      `remove:${JSON.stringify(secondKey)}`,
      "reopen:a",
      "reopen:b",
    ]);
    cleanup.dispose();
  });

  it("invalidates every staged reopen when cancel runs during a removal notification", async () => {
    const queryClient = createAppQueryClient();
    const firstKey = ["content", "a.ts"] as const;
    const secondKey = ["content", "b.ts"] as const;
    const heldKey = ["content", "held.ts"] as const;
    [firstKey, secondKey, heldKey].forEach((key) => queryClient.setQueryData(key, "old"));
    const heldObserver = new QueryObserver(queryClient, {
      queryKey: heldKey,
      queryFn: async () => "old",
      enabled: false,
    });
    const unsubscribeHeld = heldObserver.subscribe(() => undefined);
    const cleanup = createContentQueryCleanupCoordinator();
    const reopens = [vi.fn(), vi.fn(), vi.fn()] as const;
    cleanup.invalidate(queryClient, firstKey);
    cleanup.invalidate(queryClient, secondKey);
    cleanup.invalidate(queryClient, heldKey);
    cleanup.reopenAfterCleanup(queryClient, firstKey, reopens[0]);
    cleanup.reopenAfterCleanup(queryClient, secondKey, reopens[1]);
    cleanup.reopenAfterCleanup(queryClient, heldKey, reopens[2]);
    let cancelled = false;
    const unsubscribeEvents = queryClient.getQueryCache().subscribe((event) => {
      if (!cancelled && event.type === "removed") {
        cancelled = true;
        cleanup.cancelReopens();
      }
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(reopens.every((reopen) => reopen.mock.calls.length === 0)).toBe(true);
    expect(queryClient.getQueryData(firstKey)).toBeUndefined();
    expect(queryClient.getQueryData(secondKey)).toBeUndefined();
    expect(queryClient.getQueryData(heldKey)).toBe("old");

    unsubscribeHeld();
    unsubscribeEvents();
    cleanup.dispose();
  });

  it("does not run a staged reopen after disposal", async () => {
    const queryClient = createAppQueryClient();
    const queryKey = ["content", "a.ts"] as const;
    queryClient.setQueryData(queryKey, "old");
    const cleanup = createContentQueryCleanupCoordinator();
    const reopen = vi.fn();
    cleanup.invalidate(queryClient, queryKey);
    cleanup.reopenAfterCleanup(queryClient, queryKey, reopen);

    await Promise.resolve();
    cleanup.dispose();
    await Promise.resolve();
    expect(reopen).not.toHaveBeenCalled();
  });

  it("finishes removing staged inactive queries without reopening when disposed by a removal", async () => {
    const queryClient = createAppQueryClient();
    const firstKey = ["content", "a.ts"] as const;
    const secondKey = ["content", "b.ts"] as const;
    queryClient.setQueryData(firstKey, "a");
    queryClient.setQueryData(secondKey, "b");
    const cleanup = createContentQueryCleanupCoordinator();
    const firstReopen = vi.fn();
    const secondReopen = vi.fn();
    cleanup.invalidate(queryClient, firstKey);
    cleanup.invalidate(queryClient, secondKey);
    cleanup.reopenAfterCleanup(queryClient, firstKey, firstReopen);
    cleanup.reopenAfterCleanup(queryClient, secondKey, secondReopen);
    let disposed = false;
    const unsubscribeEvents = queryClient.getQueryCache().subscribe((event) => {
      if (!disposed && event.type === "removed") {
        disposed = true;
        cleanup.dispose();
      }
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(queryClient.getQueryData(firstKey)).toBeUndefined();
    expect(queryClient.getQueryData(secondKey)).toBeUndefined();
    expect(firstReopen).not.toHaveBeenCalled();
    expect(secondReopen).not.toHaveBeenCalled();
    unsubscribeEvents();
  });

  it("keeps shared owner data through replay and cleans the final owner once", async () => {
    const cleanup = vi.fn();
    const first = registerFilesOwner("owner-runtime-test");
    unregisterFilesOwner("owner-runtime-test", first, cleanup);
    const second = registerFilesOwner("owner-runtime-test");
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    unregisterFilesOwner("owner-runtime-test", second, cleanup);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans the final owner when shared owners unmount in reverse registration order", async () => {
    const cleanup = vi.fn();
    const first = registerFilesOwner("owner-runtime-reverse-test");
    const second = registerFilesOwner("owner-runtime-reverse-test");
    unregisterFilesOwner("owner-runtime-reverse-test", second, cleanup);
    unregisterFilesOwner("owner-runtime-reverse-test", first, cleanup);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
