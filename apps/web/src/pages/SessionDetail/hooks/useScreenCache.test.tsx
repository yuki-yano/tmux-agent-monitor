import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getScreenCacheAtom,
  getScreenCacheErrorAtom,
  getScreenCacheLoadingAtom,
} from "@/features/shared-session-ui/atoms/screenCacheAtoms";
import { useScreenCache } from "@/features/shared-session-ui/hooks/useScreenCache";

describe("useScreenCache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setup = (overrides: Partial<Parameters<typeof useScreenCache>[0]> = {}) => {
    const requestScreen = vi.fn().mockResolvedValue({
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "hello",
    });

    const params = {
      connected: true,
      connectionIssue: null,
      requestScreen,
      ttlMs: 5000,
      cacheKey: "test",
      ...overrides,
    };
    const cacheKey = params.cacheKey ?? "test";
    const store = createStore();
    store.set(getScreenCacheAtom(cacheKey), {});
    store.set(getScreenCacheLoadingAtom(cacheKey), {});
    store.set(getScreenCacheErrorAtom(cacheKey), {});
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    const hook = renderHook(() => useScreenCache(params), { wrapper });
    return { ...hook, requestScreen };
  };

  it("caches screen within ttl", async () => {
    const { result, requestScreen } = setup();

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    await waitFor(() => {
      expect(result.current.cache["pane-1"]).toBeDefined();
    });

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    expect(requestScreen).toHaveBeenCalledTimes(1);
    expect(result.current.cache["pane-1"]?.screen).toBe("hello");
  });

  it("sets error when disconnected", async () => {
    const { result, requestScreen } = setup({
      connected: false,
      connectionIssue: "Connection lost",
    });

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    expect(requestScreen).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.error["pane-1"]).toBe("Connection lost");
    });
  });

  it("sets api error message when response is not ok", async () => {
    const { result } = setup({
      requestScreen: vi.fn().mockResolvedValue({
        ok: false,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(0).toISOString(),
        error: {
          code: "INTERNAL",
          message: "Failed to read pane output",
        },
      }),
    });

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    await waitFor(() => {
      expect(result.current.error["pane-1"]).toBe("Failed to read pane output");
      expect(result.current.loading["pane-1"]).toBe(false);
    });
  });

  it("isolates caches by cacheKey", async () => {
    const requestScreen = vi.fn().mockResolvedValue({
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "hello",
    });
    const store = createStore();
    store.set(getScreenCacheAtom("first"), {});
    store.set(getScreenCacheLoadingAtom("first"), {});
    store.set(getScreenCacheErrorAtom("first"), {});
    store.set(getScreenCacheAtom("second"), {});
    store.set(getScreenCacheLoadingAtom("second"), {});
    store.set(getScreenCacheErrorAtom("second"), {});
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    const { result } = renderHook(
      () => ({
        first: useScreenCache({
          connected: true,
          connectionIssue: null,
          requestScreen,
          ttlMs: 5000,
          cacheKey: "first",
        }),
        second: useScreenCache({
          connected: true,
          connectionIssue: null,
          requestScreen,
          ttlMs: 5000,
          cacheKey: "second",
        }),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.first.fetchScreen("pane-1");
    });

    await waitFor(() => {
      expect(result.current.first.cache["pane-1"]).toBeDefined();
    });
    expect(result.current.second.cache["pane-1"]).toBeUndefined();
  });

  it("re-fetches after ttl expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const { result, requestScreen } = setup({ ttlMs: 1000 });

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    expect(requestScreen).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2000));

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    expect(requestScreen).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("bypasses cache when forced", async () => {
    const { result, requestScreen } = setup();

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    await act(async () => {
      await result.current.fetchScreen("pane-1", { force: true });
    });

    expect(requestScreen).toHaveBeenCalledTimes(2);
  });

  it("clears cached entries", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.fetchScreen("pane-1");
    });

    await waitFor(() => {
      expect(result.current.cache["pane-1"]).toBeDefined();
    });

    act(() => {
      result.current.clearCache("pane-1");
    });

    await waitFor(() => {
      expect(result.current.cache["pane-1"]).toBeUndefined();
      expect(result.current.loading["pane-1"]).toBeUndefined();
      expect(result.current.error["pane-1"]).toBeUndefined();
    });
  });

  it("does not let an unmounted request overwrite a remounted cache", async () => {
    type Response = {
      ok: true;
      paneId: string;
      mode: "text";
      capturedAt: string;
      screen: string;
    };
    let resolveOldRequest: ((value: Response) => void) | undefined;
    let resolveFreshRequest: ((value: Response) => void) | undefined;
    const requestScreen = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOldRequest = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFreshRequest = resolve;
          }),
      );
    const store = createStore();
    const cacheKey = "remount";
    store.set(getScreenCacheAtom(cacheKey), {});
    store.set(getScreenCacheLoadingAtom(cacheKey), {});
    store.set(getScreenCacheErrorAtom(cacheKey), {});
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
    const params = {
      connected: true,
      connectionIssue: null,
      requestScreen,
      ttlMs: 5000,
      cacheKey,
    };

    const oldHook = renderHook(() => useScreenCache(params), { wrapper });
    let oldFetch: Promise<void> | undefined;
    act(() => {
      oldFetch = oldHook.result.current.fetchScreen("pane-1");
    });
    oldHook.unmount();

    const freshHook = renderHook(() => useScreenCache(params), { wrapper });
    let freshFetch: Promise<void> | undefined;
    act(() => {
      freshFetch = freshHook.result.current.fetchScreen("pane-1");
    });

    await act(async () => {
      resolveOldRequest?.({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(1).toISOString(),
        screen: "stale",
      });
      await oldFetch;
    });

    expect(freshHook.result.current.cache["pane-1"]).toBeUndefined();
    expect(freshHook.result.current.loading["pane-1"]).toBe(true);

    await act(async () => {
      resolveFreshRequest?.({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(2).toISOString(),
        screen: "fresh",
      });
      await freshFetch;
    });

    expect(freshHook.result.current.cache["pane-1"]?.screen).toBe("fresh");
    expect(freshHook.result.current.loading["pane-1"]).toBe(false);
  });

  it("releases loading owned by an unmounted request without a replacement fetch", async () => {
    type Response = {
      ok: true;
      paneId: string;
      mode: "text";
      capturedAt: string;
      screen: string;
    };
    let resolveRequest: ((value: Response) => void) | undefined;
    const requestScreen = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const store = createStore();
    const cacheKey = "unmounted-loading";
    const loadingAtom = getScreenCacheLoadingAtom(cacheKey);
    store.set(getScreenCacheAtom(cacheKey), {});
    store.set(loadingAtom, {});
    store.set(getScreenCacheErrorAtom(cacheKey), {});
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
    const hook = renderHook(
      () =>
        useScreenCache({
          connected: true,
          connectionIssue: null,
          requestScreen,
          ttlMs: 5000,
          cacheKey,
        }),
      { wrapper },
    );

    let fetchRequest: Promise<void> | undefined;
    act(() => {
      fetchRequest = hook.result.current.fetchScreen("pane-1");
    });
    expect(store.get(loadingAtom)["pane-1"]).toBe(true);

    hook.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.get(loadingAtom)["pane-1"]).toBe(false);

    await act(async () => {
      resolveRequest?.({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(1).toISOString(),
        screen: "stale",
      });
      await fetchRequest;
    });
    expect(store.get(loadingAtom)["pane-1"]).toBe(false);
    expect(store.get(getScreenCacheAtom(cacheKey))["pane-1"]).toBeUndefined();
  });

  it("does not let an older active mount overwrite a newer owner response", async () => {
    type Response = {
      ok: true;
      paneId: string;
      mode: "text";
      capturedAt: string;
      screen: string;
    };
    let resolveOlderRequest: ((value: Response) => void) | undefined;
    let resolveNewerRequest: ((value: Response) => void) | undefined;
    const requestScreen = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOlderRequest = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveNewerRequest = resolve;
          }),
      );
    const store = createStore();
    const cacheKey = "parallel-owner";
    store.set(getScreenCacheAtom(cacheKey), {});
    store.set(getScreenCacheLoadingAtom(cacheKey), {});
    store.set(getScreenCacheErrorAtom(cacheKey), {});
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
    const params = {
      connected: true,
      connectionIssue: null,
      requestScreen,
      ttlMs: 5000,
      cacheKey,
    };
    const olderHook = renderHook(() => useScreenCache(params), { wrapper });
    const newerHook = renderHook(() => useScreenCache(params), { wrapper });
    let olderFetch: Promise<void> | undefined;
    let newerFetch: Promise<void> | undefined;

    act(() => {
      olderFetch = olderHook.result.current.fetchScreen("pane-1");
      newerFetch = newerHook.result.current.fetchScreen("pane-1");
    });
    await act(async () => {
      resolveNewerRequest?.({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(2).toISOString(),
        screen: "fresh",
      });
      await newerFetch;
    });
    expect(olderHook.result.current.cache["pane-1"]?.screen).toBe("fresh");

    await act(async () => {
      resolveOlderRequest?.({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(1).toISOString(),
        screen: "stale",
      });
      await olderFetch;
    });
    expect(olderHook.result.current.cache["pane-1"]?.screen).toBe("fresh");
    expect(olderHook.result.current.loading["pane-1"]).toBe(false);
  });
});
