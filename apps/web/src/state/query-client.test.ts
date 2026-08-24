import { QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureAppQueryFocusManager, createAppQueryClient } from "./query-client";

describe("createAppQueryClient", () => {
  afterEach(() => {
    focusManager.setEventListener(() => undefined);
  });

  it("uses explicit request semantics without implicit retries or reconnect refreshes", () => {
    const client = createAppQueryClient();

    expect(client.getDefaultOptions()).toEqual({
      queries: {
        retry: false,
        networkMode: "online",
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchIntervalInBackground: false,
      },
      mutations: {
        retry: false,
        networkMode: "online",
      },
    });
  });

  it("creates an isolated cache for each app lifetime", () => {
    const first = createAppQueryClient();
    const second = createAppQueryClient();

    first.setQueryData(["session-detail", "pane-1"], { value: "first" });

    expect(second.getQueryData(["session-detail", "pane-1"])).toBeUndefined();
  });

  it("bridges window focus and bfcache page restoration into query focus events", () => {
    const documentAddSpy = vi.spyOn(document, "addEventListener");
    const windowAddSpy = vi.spyOn(window, "addEventListener");

    configureAppQueryFocusManager();
    const unsubscribe = focusManager.subscribe(() => undefined);

    expect(documentAddSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(windowAddSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(windowAddSpy).toHaveBeenCalledWith("pageshow", expect.any(Function));

    unsubscribe();
    documentAddSpy.mockRestore();
    windowAddSpy.mockRestore();
  });

  it("refetches active observers for visibility, focus, and bfcache restoration", async () => {
    configureAppQueryFocusManager();
    const client = createAppQueryClient();
    const request = vi.fn(async () => request.mock.calls.length);
    const { unmount } = renderHook(
      () =>
        useQuery({
          queryKey: ["focus-integration"],
          queryFn: request,
          staleTime: 0,
          refetchOnWindowFocus: "always",
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client }, children),
      },
    );

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    const visibilitySpy = vi.spyOn(document, "visibilityState", "get");
    visibilitySpy.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => Promise.resolve());
    expect(request).toHaveBeenCalledTimes(1);

    visibilitySpy.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));

    const pageShow = new Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(pageShow);
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));

    visibilitySpy.mockRestore();
    unmount();
  });
});
