// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getScreenCacheAtom,
  getScreenCacheErrorAtom,
  getScreenCacheLoadingAtom,
} from "../atoms/screenCacheAtoms";
import { useScreenCache } from "./useScreenCache";

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
});
