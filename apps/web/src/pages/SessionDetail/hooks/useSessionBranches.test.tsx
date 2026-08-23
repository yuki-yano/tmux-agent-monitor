import { act, renderHook, waitFor } from "@testing-library/react";
import type { BranchList } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../test-helpers";
import { useSessionBranches } from "./useSessionBranches";

const buildBranchList = (paneId: string): BranchList => ({
  repoRoot: `/repo/${paneId}`,
  defaultBranch: "main",
  currentBranch: paneId,
  entries: [],
});

describe("useSessionBranches", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("starts polling after visibility returns without an immediate duplicate request", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const requestBranches = vi.fn(async (paneId: string) => buildBranchList(paneId));

    renderHook(() =>
      useSessionBranches({
        paneId: "pane-a",
        connected: true,
        session: null,
        requestBranches,
        requestBranchCheckout: vi.fn(async () => undefined),
        requestBranchCreate: vi.fn(async () => undefined),
        requestBranchDelete: vi.fn(async () => undefined),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(requestBranches).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(requestBranches).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(requestBranches).toHaveBeenCalledTimes(2);
  });

  it("stops polling while offline", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const requestBranches = vi.fn(async (paneId: string) => buildBranchList(paneId));

    renderHook(() =>
      useSessionBranches({
        paneId: "pane-a",
        connected: true,
        session: null,
        requestBranches,
        requestBranchCheckout: vi.fn(async () => undefined),
        requestBranchCreate: vi.fn(async () => undefined),
        requestBranchDelete: vi.fn(async () => undefined),
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(requestBranches).toHaveBeenCalledTimes(2);

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(requestBranches).toHaveBeenCalledTimes(2);
  });

  it("clears the previous result and shows loading while revisiting a pane", async () => {
    const revisitDeferred = createDeferred<BranchList>();
    let paneACalls = 0;
    const requestBranches = vi.fn((paneId: string) => {
      if (paneId === "pane-a" && ++paneACalls === 2) {
        return revisitDeferred.promise;
      }
      return Promise.resolve(buildBranchList(paneId));
    });

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionBranches({
          paneId,
          connected: false,
          session: null,
          requestBranches,
          requestBranchCheckout: vi.fn(async () => undefined),
          requestBranchCreate: vi.fn(async () => undefined),
          requestBranchDelete: vi.fn(async () => undefined),
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a");
    });
    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-b");
    });
    rerender({ paneId: "pane-a" });

    await waitFor(() => {
      expect(requestBranches).toHaveBeenCalledTimes(3);
      expect(result.current.branchesLoading).toBe(true);
    });
    expect(result.current.branchList).toBeNull();
    expect(result.current.currentBranch).toBeNull();

    await act(async () => {
      revisitDeferred.resolve(buildBranchList("pane-a-revisited"));
      await revisitDeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a-revisited");
      expect(result.current.branchesLoading).toBe(false);
    });
  });

  it("exposes a load rejection as an error state", async () => {
    const requestBranches = vi.fn(async () => {
      throw new Error("branch api failed");
    });
    const { result } = renderHook(() =>
      useSessionBranches({
        paneId: "pane-a",
        connected: false,
        session: null,
        requestBranches,
        requestBranchCheckout: vi.fn(async () => undefined),
        requestBranchCreate: vi.fn(async () => undefined),
        requestBranchDelete: vi.fn(async () => undefined),
      }),
    );

    await waitFor(() => {
      expect(result.current.branchesError).toContain("branch api failed");
    });
    expect(result.current.branchesLoading).toBe(false);
    expect(result.current.branchList).toBeNull();
    expect(result.current.branches).toEqual([]);
  });

  it("does not refresh the previous pane after its mutation finishes", async () => {
    const mutationDeferred = createDeferred<void>();
    const callerSideEffect = vi.fn();
    const requestBranches = vi.fn(async (paneId: string) => buildBranchList(paneId));
    const requestBranchCheckout = vi.fn(() => mutationDeferred.promise);
    const requestBranchCreate = vi.fn(async () => undefined);
    const requestBranchDelete = vi.fn(async () => undefined);

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionBranches({
          paneId,
          connected: false,
          session: null,
          requestBranches,
          requestBranchCheckout,
          requestBranchCreate,
          requestBranchDelete,
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a");
    });
    let mutationPromise: Promise<boolean> | undefined;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a").then((succeeded) => {
        if (succeeded) {
          callerSideEffect();
        }
        return succeeded;
      });
    });

    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-b");
    });

    let mutationResult: boolean | undefined;
    await act(async () => {
      mutationDeferred.resolve();
      mutationResult = await mutationPromise;
    });

    expect(mutationResult).toBe(false);
    expect(callerSideEffect).not.toHaveBeenCalled();
    expect(result.current.currentBranch).toBe("pane-b");
    expect(requestBranches.mock.calls.map(([paneId]) => paneId)).toEqual(["pane-a", "pane-b"]);
  });

  it("cancels an old mutation when navigation returns to the same pane id", async () => {
    const mutationDeferred = createDeferred<void>();
    const callerSideEffect = vi.fn();
    const requestBranches = vi.fn(async (paneId: string) => buildBranchList(paneId));
    const requestBranchCheckout = vi.fn(() => mutationDeferred.promise);
    const requestBranchCreate = vi.fn(async () => undefined);
    const requestBranchDelete = vi.fn(async () => undefined);

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionBranches({
          paneId,
          connected: false,
          session: null,
          requestBranches,
          requestBranchCheckout,
          requestBranchCreate,
          requestBranchDelete,
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a");
    });
    let mutationPromise: Promise<boolean> | undefined;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a").then((succeeded) => {
        if (succeeded) {
          callerSideEffect();
        }
        return succeeded;
      });
    });

    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-b");
    });
    rerender({ paneId: "pane-a" });
    await waitFor(() => {
      expect(requestBranches).toHaveBeenCalledTimes(3);
      expect(result.current.currentBranch).toBe("pane-a");
    });

    let mutationResult: boolean | undefined;
    await act(async () => {
      mutationDeferred.resolve();
      mutationResult = await mutationPromise;
    });

    expect(mutationResult).toBe(false);
    expect(callerSideEffect).not.toHaveBeenCalled();
    expect(requestBranches.mock.calls.map(([paneId]) => paneId)).toEqual([
      "pane-a",
      "pane-b",
      "pane-a",
    ]);
  });

  it("cancels caller-side effects when the pane changes during the post-mutation refresh", async () => {
    const refreshDeferred = createDeferred<BranchList>();
    const callerSideEffect = vi.fn();
    const requestBranches = vi.fn((paneId: string) => {
      if (paneId === "pane-a" && requestBranches.mock.calls.length === 2) {
        return refreshDeferred.promise;
      }
      return Promise.resolve(buildBranchList(paneId));
    });
    const requestBranchCheckout = vi.fn(async () => undefined);
    const requestBranchCreate = vi.fn(async () => undefined);
    const requestBranchDelete = vi.fn(async () => undefined);

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionBranches({
          paneId,
          connected: false,
          session: null,
          requestBranches,
          requestBranchCheckout,
          requestBranchCreate,
          requestBranchDelete,
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-a");
    });
    let mutationPromise: Promise<boolean> | undefined;
    act(() => {
      mutationPromise = result.current.checkoutBranch("feature/a").then((succeeded) => {
        if (succeeded) {
          callerSideEffect();
        }
        return succeeded;
      });
    });
    await waitFor(() => {
      expect(requestBranches).toHaveBeenCalledTimes(2);
    });

    rerender({ paneId: "pane-b" });
    await waitFor(() => {
      expect(result.current.currentBranch).toBe("pane-b");
    });

    let mutationResult: boolean | undefined;
    await act(async () => {
      refreshDeferred.resolve(buildBranchList("pane-a"));
      mutationResult = await mutationPromise;
    });

    expect(mutationResult).toBe(false);
    expect(callerSideEffect).not.toHaveBeenCalled();
    expect(result.current.currentBranch).toBe("pane-b");
  });
});
