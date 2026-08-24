import {
  type QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { BranchList } from "@vde-monitor/shared";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { createDeferred, createSessionDetail } from "../test-helpers";
import { useSessionBranches } from "./useSessionBranches";

const buildBranchList = (paneId: string, repoRoot = `/repo/${paneId}`): BranchList => ({
  repoRoot,
  defaultBranch: "main",
  currentBranch: paneId,
  entries: [],
});

type BranchesRequest = (
  paneId: string,
  options?: { force?: boolean },
  signal?: AbortSignal,
) => Promise<BranchList>;

const createQueryWrapper = (queryClient = createAppQueryClient()) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const renderBranches = ({
  paneId = "pane-a",
  repoRoot = "/repo/a",
  connected = false,
  requestBranches,
  queryClient,
}: {
  paneId?: string;
  repoRoot?: string;
  connected?: boolean;
  requestBranches: BranchesRequest;
  queryClient?: QueryClient;
}) =>
  renderHook(
    () =>
      useSessionBranches({
        paneId,
        connected,
        session: createSessionDetail({ paneId, repoRoot }),
        requestBranches,
        requestBranchCheckout: vi.fn(async () => undefined),
        requestBranchCreate: vi.fn(async () => undefined),
        requestBranchDelete: vi.fn(async () => undefined),
      }),
    { wrapper: createQueryWrapper(queryClient) },
  );

describe("useSessionBranches", () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    focusManager.setFocused(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it("loads a pane and repository scoped query with the abort signal", async () => {
    const queryClient = createAppQueryClient();
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    const { result } = renderBranches({ requestBranches, queryClient });

    expect(result.current.branchesLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a");
      expect(result.current.branchesLoading).toBe(false);
    });
    expect(requestBranches).toHaveBeenCalledWith("pane-a", undefined, expect.any(AbortSignal));
    expect(queryClient.getQueryData(sessionDetailQueryKeys.branches("pane-a", "/repo/a"))).toEqual(
      buildBranchList("pane-a"),
    );
  });

  it("pauses an offline cold mount and resumes it once online", async () => {
    onlineManager.setOnline(false);
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    const { result } = renderBranches({ requestBranches, connected: true });

    await waitFor(() => {
      expect(result.current.branchesLoading).toBe(false);
      expect(result.current.branchesError).toBe("Offline: waiting to load branches");
    });
    expect(requestBranches).not.toHaveBeenCalled();

    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a");
      expect(result.current.branchesError).toBeNull();
    });
    expect(requestBranches).toHaveBeenCalledTimes(1);
  });

  it("coalesces the actual StrictMode replay into one active request", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let successfulRequests = 0;
    const requestBranches = vi.fn<BranchesRequest>(
      (paneId, _options, signal) =>
        new Promise((resolve, reject) => {
          activeRequests += 1;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
          const timer = window.setTimeout(() => {
            activeRequests -= 1;
            successfulRequests += 1;
            resolve(buildBranchList(paneId));
          }, 10);
          signal?.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              activeRequests -= 1;
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
        useSessionBranches({
          paneId: "pane-strict",
          connected: false,
          session: createSessionDetail({ paneId: "pane-strict", repoRoot: "/repo/strict" }),
          requestBranches,
          requestBranchCheckout: vi.fn(async () => undefined),
          requestBranchCreate: vi.fn(async () => undefined),
          requestBranchDelete: vi.fn(async () => undefined),
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-strict");
    });
    expect(requestBranches).toHaveBeenCalledTimes(1);
    expect(maxActiveRequests).toBe(1);
    expect(successfulRequests).toBe(1);
  });

  it("discards cached data across pane A to B to A with gcTime zero", async () => {
    const revisitA = createDeferred<BranchList>();
    let paneACalls = 0;
    const requestBranches = vi.fn<BranchesRequest>((paneId) => {
      if (paneId === "pane-a" && ++paneACalls === 2) {
        return revisitA.promise;
      }
      return Promise.resolve(buildBranchList(paneId));
    });
    const queryClient = createAppQueryClient();
    const { result, rerender } = renderHook(
      ({ paneId, repoRoot }) =>
        useSessionBranches({
          paneId,
          connected: false,
          session: createSessionDetail({ paneId, repoRoot }),
          requestBranches,
          requestBranchCheckout: vi.fn(async () => undefined),
          requestBranchCreate: vi.fn(async () => undefined),
          requestBranchDelete: vi.fn(async () => undefined),
        }),
      {
        initialProps: { paneId: "pane-a", repoRoot: "/repo/a" },
        wrapper: createQueryWrapper(queryClient),
      },
    );

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    rerender({ paneId: "pane-b", repoRoot: "/repo/b" });
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-b"));
    rerender({ paneId: "pane-a", repoRoot: "/repo/a" });

    await waitFor(() => {
      expect(requestBranches).toHaveBeenCalledTimes(3);
      expect(result.current.branchesLoading).toBe(true);
    });
    expect(result.current.branchList).toBeNull();
    act(() => revisitA.resolve(buildBranchList("pane-a-revisited", "/repo/a")));
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a-revisited"));
  });

  it("cancels a pending cold request before a forced manual refresh", async () => {
    const refreshed = createDeferred<BranchList>();
    let initialSignal: AbortSignal | undefined;
    const requestBranches = vi.fn<BranchesRequest>((paneId, options, signal) => {
      if (options?.force === true) {
        return refreshed.promise;
      }
      initialSignal = signal;
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    });
    const { result } = renderBranches({ requestBranches });

    await waitFor(() => expect(initialSignal).toBeDefined());
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshBranches();
    });
    await waitFor(() => {
      expect(initialSignal?.aborted).toBe(true);
      expect(requestBranches).toHaveBeenCalledWith(
        "pane-a",
        { force: true },
        expect.any(AbortSignal),
      );
    });
    act(() => refreshed.resolve(buildBranchList("pane-a-refreshed")));
    await act(async () => refreshPromise);
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a-refreshed"));
  });

  it("cancels an earlier forced refresh and only applies the latest response", async () => {
    const firstRefresh = createDeferred<BranchList>();
    const latestRefresh = createDeferred<BranchList>();
    let firstRefreshSignal: AbortSignal | undefined;
    let forceCallCount = 0;
    const requestBranches = vi.fn<BranchesRequest>((paneId, options, signal) => {
      if (options?.force !== true) {
        return Promise.resolve(buildBranchList(paneId));
      }
      forceCallCount += 1;
      if (forceCallCount === 1) {
        firstRefreshSignal = signal;
        return firstRefresh.promise;
      }
      return latestRefresh.promise;
    });
    const { result } = renderBranches({ requestBranches });

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    let firstPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.refreshBranches();
    });
    await waitFor(() => expect(requestBranches).toHaveBeenCalledTimes(2));

    let latestPromise!: Promise<void>;
    act(() => {
      latestPromise = result.current.refreshBranches();
    });
    await waitFor(() => {
      expect(firstRefreshSignal?.aborted).toBe(true);
      expect(requestBranches).toHaveBeenCalledTimes(3);
    });

    act(() => latestRefresh.resolve(buildBranchList("latest-refresh")));
    await act(async () => latestPromise);
    await waitFor(() => expect(result.current.currentBranch).toBe("latest-refresh"));

    act(() => firstRefresh.resolve(buildBranchList("stale-refresh")));
    await act(async () => firstPromise);
    expect(result.current.currentBranch).toBe("latest-refresh");
  });

  it("aborts a forced refresh on unmount and ignores its late result", async () => {
    const forcedRefresh = createDeferred<BranchList>();
    let forcedSignal: AbortSignal | undefined;
    const requestBranches = vi.fn<BranchesRequest>((paneId, options, signal) => {
      if (options?.force === true) {
        forcedSignal = signal;
        return forcedRefresh.promise;
      }
      return Promise.resolve(buildBranchList(paneId));
    });
    const queryClient = createAppQueryClient();
    const { result, unmount } = renderBranches({ requestBranches, queryClient });

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshBranches();
    });
    await waitFor(() => expect(forcedSignal).toBeDefined());

    unmount();
    await waitFor(() => expect(forcedSignal?.aborted).toBe(true));
    act(() => forcedRefresh.resolve(buildBranchList("late-refresh")));
    await refreshPromise;

    expect(
      queryClient.getQueryData(sessionDetailQueryKeys.branches("pane-a", "/repo/a")),
    ).not.toEqual(buildBranchList("late-refresh"));
  });

  it("keeps warm data on refresh failure and clears the error while retrying", async () => {
    const retry = createDeferred<BranchList>();
    const requestBranches = vi
      .fn<BranchesRequest>()
      .mockResolvedValueOnce(buildBranchList("pane-a"))
      .mockRejectedValueOnce(new Error("branch refresh failed"))
      .mockImplementationOnce(() => retry.promise);
    const { result } = renderBranches({ requestBranches });

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    await act(async () => result.current.refreshBranches());
    await waitFor(() => expect(result.current.branchesError).toBe("branch refresh failed"));
    expect(result.current.currentBranch).toBe("pane-a");

    let retryPromise!: Promise<void>;
    act(() => {
      retryPromise = result.current.refreshBranches();
    });
    await waitFor(() => expect(requestBranches).toHaveBeenCalledTimes(3));
    expect(result.current.branchesError).toBeNull();
    expect(result.current.currentBranch).toBe("pane-a");
    act(() => retry.resolve(buildBranchList("pane-a-retried")));
    await act(async () => retryPromise);
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a-retried"));
  });

  it("waits until the next interval after visibility returns", async () => {
    vi.useFakeTimers();
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    renderBranches({ requestBranches, connected: true });

    await act(async () => undefined);
    expect(requestBranches).toHaveBeenCalledTimes(1);
    act(() => focusManager.setFocused(false));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(requestBranches).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(true));
    await act(async () => undefined);
    expect(requestBranches).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(requestBranches).toHaveBeenCalledTimes(2);
  });

  it("starts app reconnect polling on the next interval without an immediate fetch", async () => {
    vi.useFakeTimers();
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    const { rerender } = renderHook(
      ({ connected }) =>
        useSessionBranches({
          paneId: "pane-a",
          connected,
          session: createSessionDetail({ paneId: "pane-a", repoRoot: "/repo/a" }),
          requestBranches,
          requestBranchCheckout: vi.fn(async () => undefined),
          requestBranchCreate: vi.fn(async () => undefined),
          requestBranchDelete: vi.fn(async () => undefined),
        }),
      { initialProps: { connected: false }, wrapper: createQueryWrapper() },
    );

    await act(async () => undefined);
    expect(requestBranches).toHaveBeenCalledTimes(1);
    rerender({ connected: true });
    await act(async () => undefined);
    expect(requestBranches).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(requestBranches).toHaveBeenCalledTimes(2);
  });

  it("does not create a paused warm interval request and waits one tick after browser reconnect", async () => {
    vi.useFakeTimers();
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    renderBranches({ requestBranches, connected: true });

    await act(async () => undefined);
    expect(requestBranches).toHaveBeenCalledTimes(1);
    act(() => onlineManager.setOnline(false));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(requestBranches).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(true));
    await act(async () => undefined);
    expect(requestBranches).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(requestBranches).toHaveBeenCalledTimes(2);
  });

  it("exposes a cold load rejection without stale data", async () => {
    const requestBranches = vi.fn<BranchesRequest>(async () => {
      throw new Error("branch api failed");
    });
    const { result } = renderBranches({ requestBranches });

    await waitFor(() => expect(result.current.branchesError).toBe("branch api failed"));
    expect(result.current.branchesLoading).toBe(false);
    expect(result.current.branchList).toBeNull();
    expect(result.current.branches).toEqual([]);
  });

  it("keeps a successful mutation successful when its forced list refresh fails", async () => {
    const requestBranches = vi
      .fn<BranchesRequest>()
      .mockResolvedValueOnce(buildBranchList("pane-a"))
      .mockRejectedValueOnce(new Error("forced refresh failed"));
    const requestBranchCheckout = vi.fn(async () => undefined);
    const { result } = renderHook(
      () =>
        useSessionBranches({
          paneId: "pane-a",
          connected: false,
          session: createSessionDetail({ paneId: "pane-a", repoRoot: "/repo/a" }),
          requestBranches,
          requestBranchCheckout,
          requestBranchCreate: vi.fn(async () => undefined),
          requestBranchDelete: vi.fn(async () => undefined),
        }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.checkoutBranch("feature/a");
    });

    expect(succeeded).toBe(true);
    expect(result.current.mutationError).toBeNull();
    expect(result.current.branchesError).toBe("forced refresh failed");
    expect(requestBranches).toHaveBeenLastCalledWith(
      "pane-a",
      { force: true },
      expect.any(AbortSignal),
    );
  });

  it("does not refresh the previous pane after its mutation finishes", async () => {
    const mutationDeferred = createDeferred<void>();
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    const requestBranchCheckout = vi.fn(() => mutationDeferred.promise);
    const { result, rerender } = renderBranchLifetime({ requestBranches, requestBranchCheckout });

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    let mutationPromise!: Promise<boolean>;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a");
    });
    rerender({ paneId: "pane-b", repoRoot: "/repo/b" });
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-b"));
    act(() => mutationDeferred.resolve());
    await expect(mutationPromise).resolves.toBe(false);
    expect(requestBranches.mock.calls.map(([paneId]) => paneId)).toEqual(["pane-a", "pane-b"]);
  });

  it("invalidates a pending mutation when the repository changes within the same pane", async () => {
    const mutationDeferred = createDeferred<void>();
    const callerSideEffect = vi.fn();
    const requestBranches = vi
      .fn<BranchesRequest>()
      .mockResolvedValueOnce(buildBranchList("repo-a", "/repo/a"))
      .mockResolvedValueOnce(buildBranchList("repo-b", "/repo/b"));
    const requestBranchCheckout = vi.fn(() => mutationDeferred.promise);
    const { result, rerender } = renderBranchLifetime({ requestBranches, requestBranchCheckout });

    await waitFor(() => expect(result.current.currentBranch).toBe("repo-a"));
    let mutationPromise!: Promise<boolean>;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a").then((succeeded) => {
        if (succeeded) {
          callerSideEffect();
        }
        return succeeded;
      });
    });
    expect(result.current.mutating).toEqual({ kind: "checkout", name: "feature/a" });

    rerender({ paneId: "pane-a", repoRoot: "/repo/b" });
    await waitFor(() => expect(result.current.currentBranch).toBe("repo-b"));
    expect(result.current.mutating).toBeNull();
    expect(result.current.mutationError).toBeNull();

    act(() => mutationDeferred.resolve());
    await expect(mutationPromise).resolves.toBe(false);
    expect(callerSideEffect).not.toHaveBeenCalled();
    expect(requestBranches).toHaveBeenCalledTimes(2);
    expect(result.current.currentBranch).toBe("repo-b");
  });

  it("does not expose a previous repository mutation error after the repository changes", async () => {
    const requestBranches = vi.fn<BranchesRequest>(async (_paneId, _options) =>
      buildBranchList("current-repo"),
    );
    const requestBranchCheckout = vi.fn(async () => {
      throw new Error("repo-a checkout failed");
    });
    const { result, rerender } = renderBranchLifetime({ requestBranches, requestBranchCheckout });

    await waitFor(() => expect(result.current.currentBranch).toBe("current-repo"));
    await act(async () => {
      await result.current.checkoutBranch("feature/a");
    });
    expect(result.current.mutationError).toBe("repo-a checkout failed");

    rerender({ paneId: "pane-a", repoRoot: "/repo/b" });
    expect(result.current.mutationError).toBeNull();
  });

  it("cancels an old mutation when navigation returns to the same pane id", async () => {
    const mutationDeferred = createDeferred<void>();
    const requestBranches = vi.fn<BranchesRequest>(async (paneId) => buildBranchList(paneId));
    const requestBranchCheckout = vi.fn(() => mutationDeferred.promise);
    const { result, rerender } = renderBranchLifetime({ requestBranches, requestBranchCheckout });

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    let mutationPromise!: Promise<boolean>;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a");
    });
    rerender({ paneId: "pane-b", repoRoot: "/repo/b" });
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-b"));
    rerender({ paneId: "pane-a", repoRoot: "/repo/a" });
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    act(() => mutationDeferred.resolve());
    await expect(mutationPromise).resolves.toBe(false);
    expect(requestBranches).toHaveBeenCalledTimes(3);
  });

  it("cancels caller success when the pane changes during the forced post-mutation refresh", async () => {
    const forcedRefresh = createDeferred<BranchList>();
    const requestBranches = vi.fn<BranchesRequest>((paneId, options) =>
      options?.force === true ? forcedRefresh.promise : Promise.resolve(buildBranchList(paneId)),
    );
    const requestBranchCheckout = vi.fn(async () => undefined);
    const { result, rerender } = renderBranchLifetime({ requestBranches, requestBranchCheckout });

    await waitFor(() => expect(result.current.currentBranch).toBe("pane-a"));
    let mutationPromise!: Promise<boolean>;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a");
    });
    await waitFor(() => expect(requestBranches).toHaveBeenCalledTimes(2));
    rerender({ paneId: "pane-b", repoRoot: "/repo/b" });
    await waitFor(() => expect(result.current.currentBranch).toBe("pane-b"));
    act(() => forcedRefresh.resolve(buildBranchList("pane-a")));
    await expect(mutationPromise).resolves.toBe(false);
    expect(result.current.currentBranch).toBe("pane-b");
  });
});

const renderBranchLifetime = ({
  requestBranches,
  requestBranchCheckout,
}: {
  requestBranches: BranchesRequest;
  requestBranchCheckout: (paneId: string, branch: string) => Promise<void>;
}) =>
  renderHook(
    ({ paneId, repoRoot }) =>
      useSessionBranches({
        paneId,
        connected: false,
        session: createSessionDetail({ paneId, repoRoot }),
        requestBranches,
        requestBranchCheckout,
        requestBranchCreate: vi.fn(async () => undefined),
        requestBranchDelete: vi.fn(async () => undefined),
      }),
    {
      initialProps: { paneId: "pane-a", repoRoot: "/repo/a" },
      wrapper: createQueryWrapper(),
    },
  );
