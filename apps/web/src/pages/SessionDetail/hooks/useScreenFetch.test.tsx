import { act, renderHook, waitFor } from "@testing-library/react";
import type { ScreenResponse } from "@vde-monitor/shared";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode, SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import {
  type ScreenLoadingEvent,
  type ScreenMode,
  initialScreenLoadingState,
  screenLoadingReducer,
} from "@/lib/screen-loading";
import { HttpResponse, http, server } from "@/test/msw/server";

import {
  screenContentContextKeyAtom,
  screenErrorAtom,
  screenFallbackReasonAtom,
  screenImageAtom,
  screenLoadingAtom,
  screenModeLoadedAtom,
  screenTextAtom,
} from "../atoms/screenAtoms";
import { DISCONNECTED_MESSAGE } from "../sessionDetailUtils";
import { createScreenContent } from "./screen-content";
import { useScreenFetch } from "./useScreenFetch";

describe("useScreenFetch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  type SetupOverrides = Partial<Parameters<typeof useScreenFetch>[0]> &
    Partial<Parameters<typeof createScreenContent>[0]> & {
      initialScreen?: string;
      initialCursor?: string;
    };
  const setup = (overrides?: SetupOverrides) => {
    const requestScreen = vi.fn().mockResolvedValue({
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "hello",
    });

    const setScreen = overrides?.setScreen ?? vi.fn();
    const setImageBase64 = overrides?.setImageBase64 ?? vi.fn();
    const setScreenContentContextKey = overrides?.setScreenContentContextKey ?? vi.fn();
    const content = createScreenContent({ setScreen, setImageBase64, setScreenContentContextKey });
    if (overrides?.initialScreen != null || overrides?.initialCursor != null) {
      content.applyResponse(
        {
          ok: true,
          paneId: "pane-1",
          mode: "text",
          capturedAt: new Date(0).toISOString(),
          screen: overrides.initialScreen ?? "",
          cursor: overrides.initialCursor,
        },
        { isUserScrolling: false, immediate: true },
      );
    }
    const params = {
      paneId: "pane-1",
      connected: true,
      connectionIssue: null,
      requestScreen,
      mode: "text" as const,
      isUserScrolling: () => false,
      modeLoadedRef: { current: { text: false, image: false } },
      modeSwitchRef: { current: null as "text" | "image" | null },
      content,
      setScreen,
      setImageBase64,
      setScreenContentContextKey,
      dispatchScreenLoading: vi.fn(),
      onModeLoaded: vi.fn(),
      ...overrides,
    };

    const store = createStore();
    store.set(screenErrorAtom, null);
    store.set(screenFallbackReasonAtom, null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
    const hook = renderHook(() => useScreenFetch(params), { wrapper });
    return { ...hook, params, requestScreen };
  };

  it("requests screen with cursor and marks mode loaded", async () => {
    const { result, params, requestScreen } = setup({
      initialCursor: "cursor-1",
    });

    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledWith("pane-1", { mode: "text", cursor: "cursor-1" });
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(params.onModeLoaded).toHaveBeenCalledWith("text");
    });
  });

  it.each([
    { paneId: "another-pane" },
    { mode: "image" as const },
    { capturedAt: "invalid timestamp" },
  ])("rejects a REST response outside the current screen context: %o", async (responseOverride) => {
    const requestScreen = vi.fn().mockResolvedValue({
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "wrong-context",
      ...responseOverride,
    });
    const { params } = setup({ requestScreen });
    await waitFor(() =>
      expect(params.dispatchScreenLoading).toHaveBeenCalledWith({ type: "finish", mode: "text" }),
    );
    expect(params.setScreen).not.toHaveBeenCalled();
    expect(params.onModeLoaded).not.toHaveBeenCalled();
  });

  it("rejects a REST response when its cursor base changes without an SSE event", async () => {
    let complete!: (response: ScreenResponse) => void;
    const requestScreen = vi.fn(
      () =>
        new Promise<ScreenResponse>((resolve) => {
          complete = resolve;
        }),
    );
    const { params } = setup({ requestScreen, initialCursor: "old-base" });
    await waitFor(() => expect(requestScreen).toHaveBeenCalledTimes(1));
    params.content.resetDeltaBase();
    await act(async () =>
      complete({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(1000).toISOString(),
        screen: "stale-base",
        cursor: "stale-cursor",
      }),
    );
    expect(params.setScreen).not.toHaveBeenCalled();
    expect(params.content.getCursor()).toBeNull();
  });

  it("does not advance the accepted timestamp for a failed capture", async () => {
    const response = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(1000).toISOString(),
      screen: "first",
    };
    const requestScreen = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({
        ...response,
        ok: false,
        capturedAt: new Date(5000).toISOString(),
        error: { message: "capture failed" },
      })
      .mockResolvedValue({
        ...response,
        capturedAt: new Date(3000).toISOString(),
        screen: "recovered",
      });
    const { result, params } = setup({ requestScreen });
    await waitFor(() => expect(params.setScreen).toHaveBeenCalledWith("first"));
    await act(async () => result.current.refreshScreen());
    await waitFor(() => expect(params.setScreen).toHaveBeenCalledWith("recovered"));
    expect(requestScreen).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });

  it("starts loading when mode is loaded but current text is empty", async () => {
    const dispatchScreenLoading = vi.fn();
    const requestScreen = vi.fn(() => new Promise<ScreenResponse>(() => {}));

    setup({
      requestScreen,
      modeLoadedRef: { current: { text: true, image: true } },
      initialScreen: "",
      dispatchScreenLoading,
    });

    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });

    expect(dispatchScreenLoading).toHaveBeenCalledWith({ type: "start", mode: "text" });
  });

  it("does not start loading when mode is loaded and current text exists", async () => {
    const dispatchScreenLoading = vi.fn();
    const requestScreen = vi.fn(() => new Promise<ScreenResponse>(() => {}));

    setup({
      requestScreen,
      modeLoadedRef: { current: { text: true, image: true } },
      initialScreen: "existing-screen",
      dispatchScreenLoading,
    });

    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });

    expect(dispatchScreenLoading).not.toHaveBeenCalledWith({ type: "start", mode: "text" });
  });

  it("ignores stale responses when mode changes mid-flight", async () => {
    let resolveFirst: ((value: ScreenResponse) => void) | undefined;
    let resolveSecond: ((value: ScreenResponse) => void) | undefined;

    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    const requestScreen = vi
      .fn()
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    const setScreen = vi.fn();
    const setImageBase64 = vi.fn();
    const content = createScreenContent({
      setScreen,
      setImageBase64,
      setScreenContentContextKey: vi.fn(),
    });

    const { result, rerender } = renderHook(
      (mode: ScreenMode) =>
        useScreenFetch({
          paneId: "pane-1",
          connected: true,
          connectionIssue: null,
          requestScreen,
          mode,
          isUserScrolling: () => false,
          modeLoadedRef: { current: { text: false, image: false } },
          modeSwitchRef: { current: null },
          content,
          dispatchScreenLoading: vi.fn(),
          onModeLoaded: vi.fn(),
        }),
      { initialProps: "text" as ScreenMode },
    );

    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });

    rerender("image" as ScreenMode);

    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecond?.({
        ok: true,
        paneId: "pane-1",
        mode: "image",
        capturedAt: new Date(0).toISOString(),
        imageBase64: "abc",
      });
    });

    await act(async () => {
      resolveFirst?.({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(0).toISOString(),
        screen: "first",
      });
    });

    expect(setImageBase64).toHaveBeenCalledWith("abc");
    expect(setScreen).not.toHaveBeenCalledWith("first");
    expect(result.current.error).toBeNull();
  });

  it("starts the new pane request and rejects the old pane REST response", async () => {
    let resolvePaneOne!: (value: ScreenResponse) => void;
    let resolvePaneTwo!: (value: ScreenResponse) => void;
    const requestScreen = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<ScreenResponse>((resolve) => {
          resolvePaneOne = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<ScreenResponse>((resolve) => {
          resolvePaneTwo = resolve;
        }),
      );
    const setScreen = vi.fn();
    const content = createScreenContent({
      setScreen,
      setImageBase64: vi.fn(),
      setScreenContentContextKey: vi.fn(),
    });
    const sharedParams = {
      connected: true,
      connectionIssue: null,
      requestScreen,
      mode: "text" as const,
      isUserScrolling: () => false,
      modeLoadedRef: { current: { text: false, image: false } },
      modeSwitchRef: { current: null },
      content,
      dispatchScreenLoading: vi.fn(),
      onModeLoaded: vi.fn(),
    };
    const { rerender } = renderHook(
      (paneId: string) => useScreenFetch({ ...sharedParams, paneId }),
      { initialProps: "pane-1" },
    );

    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledWith("pane-1", { mode: "text" });
    });
    rerender("pane-2");
    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledWith("pane-2", { mode: "text" });
    });

    await act(async () => {
      resolvePaneOne({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(2_000).toISOString(),
        screen: "old-pane",
      });
    });
    expect(setScreen).not.toHaveBeenCalledWith("old-pane");

    await act(async () => {
      resolvePaneTwo({
        ok: true,
        paneId: "pane-2",
        mode: "text",
        capturedAt: new Date(1_000).toISOString(),
        screen: "new-pane",
      });
    });
    expect(setScreen).toHaveBeenCalledWith("new-pane");
  });

  it("does not let an unmounted pane response overwrite the next keyed mount", async () => {
    let resolvePaneOne!: (value: ScreenResponse) => void;
    let resolvePaneTwo!: (value: ScreenResponse) => void;
    const requestScreen = vi.fn(
      (paneId: string) =>
        new Promise<ScreenResponse>((resolve) => {
          if (paneId === "pane-1") {
            resolvePaneOne = resolve;
          } else {
            resolvePaneTwo = resolve;
          }
        }),
    );
    const store = createStore();
    store.set(screenErrorAtom, null);
    store.set(screenFallbackReasonAtom, null);
    store.set(screenLoadingAtom, initialScreenLoadingState);
    store.set(screenModeLoadedAtom, { text: false, image: false });
    store.set(screenTextAtom, "");
    store.set(screenImageAtom, null);
    store.set(screenContentContextKeyAtom, null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
    const dispatchScreenLoading = vi.fn((event: ScreenLoadingEvent) => {
      store.set(screenLoadingAtom, screenLoadingReducer(store.get(screenLoadingAtom), event));
    });
    const buildParams = (paneId: string) => ({
      paneId,
      connected: true,
      connectionIssue: null,
      requestScreen,
      mode: "text" as const,
      isUserScrolling: () => false,
      modeLoadedRef: { current: { text: false, image: false } },
      modeSwitchRef: { current: null as ScreenMode | null },
      content: createScreenContent({
        setScreen: (screen: SetStateAction<string>) => {
          store.set(screenTextAtom, screen);
        },
        setImageBase64: (image: SetStateAction<string | null>) => {
          store.set(screenImageAtom, image);
        },
        setScreenContentContextKey: (contextKey: SetStateAction<string | null>) => {
          store.set(screenContentContextKeyAtom, contextKey);
        },
      }),
      dispatchScreenLoading,
      onModeLoaded: (mode: ScreenMode) => {
        store.set(screenModeLoadedAtom, (loaded) => ({ ...loaded, [mode]: true }));
      },
    });

    const paneOneParams = buildParams("pane-1");
    const paneOne = renderHook(() => useScreenFetch(paneOneParams), { wrapper });
    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledWith("pane-1", { mode: "text" });
    });
    paneOne.unmount();

    const paneTwoParams = buildParams("pane-2");
    renderHook(() => useScreenFetch(paneTwoParams), { wrapper });
    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledWith("pane-2", { mode: "text" });
    });
    await act(async () => {
      resolvePaneTwo({
        ok: true,
        paneId: "pane-2",
        mode: "text",
        capturedAt: new Date(2_000).toISOString(),
        screen: "new-pane",
        fallbackReason: "image_disabled",
      });
    });
    await waitFor(() => {
      expect(store.get(screenTextAtom)).toBe("new-pane");
      expect(store.get(screenFallbackReasonAtom)).toBe("image_disabled");
      expect(store.get(screenContentContextKeyAtom)).toBe("pane-2\0text");
      expect(dispatchScreenLoading).toHaveBeenCalledWith({ type: "finish", mode: "text" });
      expect(store.get(screenLoadingAtom)).toEqual(initialScreenLoadingState);
    });
    dispatchScreenLoading.mockClear();

    await act(async () => {
      resolvePaneOne({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(3_000).toISOString(),
        screen: "stale-pane",
        fallbackReason: "image_failed",
      });
    });

    expect(store.get(screenTextAtom)).toBe("new-pane");
    expect(store.get(screenFallbackReasonAtom)).toBe("image_disabled");
    expect(store.get(screenContentContextKeyAtom)).toBe("pane-2\0text");
    expect(store.get(screenLoadingAtom)).toEqual(initialScreenLoadingState);
    expect(dispatchScreenLoading).not.toHaveBeenCalled();
  });

  it("skips polling while document is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });

    const { result, requestScreen } = setup();

    await act(async () => {});

    expect(requestScreen).toHaveBeenCalledTimes(1);
    expect(result.current.pollingPauseReason).toBe("hidden");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(requestScreen).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(1000);
    });

    expect(requestScreen).toHaveBeenCalledTimes(2);
    expect(result.current.pollingPauseReason).toBeNull();
  });

  it("does not poll while offline and requests once when connectivity resumes", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result, requestScreen } = setup();

    await act(async () => {});
    expect(requestScreen).toHaveBeenCalledTimes(1);
    requestScreen.mockClear();

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
      vi.advanceTimersByTime(2000);
    });
    expect(requestScreen).not.toHaveBeenCalled();
    expect(result.current.pollingPauseReason).toBe("offline");

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(requestScreen).toHaveBeenCalledTimes(1);
    expect(result.current.pollingPauseReason).toBeNull();
  });

  it("does not request on browser events while disconnected or unauthorized", async () => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const disconnected = setup({ connected: false, connectionIssue: null });
    const unauthorized = setup({ connectionIssue: API_ERROR_MESSAGES.unauthorized });

    await waitFor(() => {
      expect(unauthorized.requestScreen).toHaveBeenCalledTimes(1);
    });
    disconnected.requestScreen.mockClear();
    unauthorized.requestScreen.mockClear();

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(disconnected.requestScreen).not.toHaveBeenCalled();
    expect(unauthorized.requestScreen).not.toHaveBeenCalled();
    expect(disconnected.result.current.pollingPauseReason).toBe("disconnected");
    expect(unauthorized.result.current.pollingPauseReason).toBe("unauthorized");
  });

  it("resets loading and sets disconnected error when disconnected without issue", async () => {
    const { result, params, requestScreen } = setup({
      connected: false,
      connectionIssue: null,
    });

    await waitFor(() => {
      expect(params.dispatchScreenLoading).toHaveBeenCalledWith({ type: "reset" });
      expect(result.current.error).toBe(DISCONNECTED_MESSAGE);
    });

    expect(requestScreen).not.toHaveBeenCalled();
    expect(result.current.pollingPauseReason).toBe("disconnected");
  });

  it("defers text render while user is scrolling, even at the bottom", async () => {
    const setScreen = vi.fn();
    const setImageBase64 = vi.fn();

    const { params } = setup({
      isUserScrolling: () => true,
      setScreen,
      setImageBase64,
    });

    await waitFor(() => {
      expect(params.onModeLoaded).toHaveBeenCalledWith("text");
    });

    expect(setScreen).not.toHaveBeenCalledWith("hello");
    expect(setImageBase64).not.toHaveBeenCalledWith(null);
    act(() => params.content.flushPending());
    expect(setScreen).toHaveBeenCalledWith("hello");
  });

  // ---------------------------------------------------------------------------
  // SSE integration
  // ---------------------------------------------------------------------------

  it("does not start REST while the initial SSE connection is opening or open", async () => {
    const enc = new TextEncoder();
    const screenPayload: ScreenResponse = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "initial-sse",
      full: true,
    };
    const screenStream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            enc.encode(`event: screen\ndata: ${JSON.stringify(screenPayload)}\n\n`),
          );
        },
        cancel() {},
      });

    server.use(
      http.get(
        "/api/streams/sessions/pane-1/screen",
        () =>
          new HttpResponse(screenStream(), {
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    );

    const requestScreen = vi.fn().mockResolvedValue({
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "initial",
    });

    const store = createStore();
    store.set(screenErrorAtom, null);
    store.set(screenFallbackReasonAtom, null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    const params = {
      paneId: "pane-1",
      connected: true,
      connectionIssue: null,
      requestScreen,
      mode: "text" as const,
      isUserScrolling: () => false,
      modeLoadedRef: { current: { text: false, image: false } },
      modeSwitchRef: { current: null as "text" | "image" | null },
      content: createScreenContent({
        setScreen: vi.fn(),
        setImageBase64: vi.fn(),
        setScreenContentContextKey: vi.fn(),
      }),
      dispatchScreenLoading: vi.fn(),
      onModeLoaded: vi.fn(),
      apiBasePath: "/api",
      token: "test-token",
    };

    const { result } = renderHook(() => useScreenFetch(params), { wrapper });

    // Wait for SSE to open (transport === "sse")
    await waitFor(() => {
      expect(result.current.transport).toBe("sse");
    });

    expect(requestScreen).not.toHaveBeenCalled();

    // Wait well below the polling interval (1000ms) — polling is suspended so
    // no additional REST calls should fire.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    // REST polling should stay suspended while SSE is open.
    expect(requestScreen).not.toHaveBeenCalled();
  });

  it("falls back to REST when the initial SSE connection fails", async () => {
    server.use(
      http.get(
        "/api/streams/sessions/pane-1/screen",
        () => new HttpResponse(null, { status: 503 }),
      ),
    );

    const { result, requestScreen } = setup({
      apiBasePath: "/api",
      token: "test-token",
    });

    expect(result.current.transport).toBe("connecting");
    await waitFor(() => {
      expect(result.current.transport).toBe("polling");
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });
  });

  it("uses REST after the first SSE screen deadline and returns to SSE on recovery", async () => {
    const enc = new TextEncoder();
    const screenPayload: ScreenResponse = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(1_000).toISOString(),
      screen: "recovered-sse",
      full: true,
    };
    let releaseConnection!: () => void;
    const connectionGate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    server.use(
      http.get("/api/streams/sessions/pane-1/screen", async () => {
        await connectionGate;
        return new HttpResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                enc.encode(`event: screen\ndata: ${JSON.stringify(screenPayload)}\n\n`),
              );
            },
            cancel() {},
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }),
    );

    const { result, requestScreen } = setup({
      apiBasePath: "/api",
      token: "test-token",
      streamFallbackDelayMs: 20,
    });

    expect(result.current.transport).toBe("connecting");
    await waitFor(() => {
      expect(result.current.transport).toBe("polling");
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });

    releaseConnection();
    await waitFor(() => {
      expect(result.current.transport).toBe("sse");
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(requestScreen).toHaveBeenCalledTimes(1);
  });

  it("updates screen via SSE event without REST polling", async () => {
    const enc = new TextEncoder();
    const screenPayload: ScreenResponse = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "from-sse",
      full: true,
    };

    let resolveFirstEvent!: () => void;
    const firstEventDelivered = new Promise<void>((resolve) => {
      resolveFirstEvent = resolve;
    });

    server.use(
      http.get("/api/streams/sessions/pane-1/screen", () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(`event: screen\ndata: ${JSON.stringify(screenPayload)}\n\n`),
            );
          },
          cancel() {},
        });
        return new HttpResponse(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    let resolveRest!: (response: ScreenResponse) => void;
    const requestScreen = vi.fn(
      () =>
        new Promise<ScreenResponse>((resolve) => {
          resolveRest = resolve;
        }),
    );
    const dispatchScreenLoading = vi.fn();
    const modeLoadedRef = { current: { text: false, image: false } };
    const modeSwitchRef = { current: "text" as "text" | "image" | null };
    const setScreen = vi.fn().mockImplementation(() => {
      resolveFirstEvent();
    });

    const content = createScreenContent({
      setScreen,
      setImageBase64: vi.fn(),
      setScreenContentContextKey: vi.fn(),
    });

    const store = createStore();
    store.set(screenErrorAtom, null);
    store.set(screenFallbackReasonAtom, null);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );

    const { result } = renderHook(
      () =>
        useScreenFetch({
          paneId: "pane-1",
          connected: true,
          connectionIssue: null,
          requestScreen,
          mode: "text",
          isUserScrolling: () => false,
          modeLoadedRef,
          modeSwitchRef,
          content,
          dispatchScreenLoading,
          onModeLoaded: vi.fn(),
          apiBasePath: "/api",
          token: "test-token",
        }),
      { wrapper },
    );

    await firstEventDelivered;

    expect(setScreen).toHaveBeenCalledWith("from-sse");
    expect(dispatchScreenLoading).toHaveBeenCalledWith({ type: "finish", mode: "text" });
    const finishCallIndex = dispatchScreenLoading.mock.calls.findIndex(
      ([event]) => event.type === "finish" && event.mode === "text",
    );
    expect(setScreen.mock.invocationCallOrder[0]).toBeLessThan(
      dispatchScreenLoading.mock.invocationCallOrder[finishCallIndex] ?? Number.POSITIVE_INFINITY,
    );
    expect(modeSwitchRef.current).toBeNull();
    expect(requestScreen).not.toHaveBeenCalled();

    const loadingDispatchCount = dispatchScreenLoading.mock.calls.length;
    act(() => {
      void result.current.refreshScreen();
    });
    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });
    expect(dispatchScreenLoading).toHaveBeenCalledTimes(loadingDispatchCount);

    await act(async () => {
      resolveRest({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(-1_000).toISOString(),
        screen: "stale-rest",
        full: true,
      });
    });

    expect(setScreen).not.toHaveBeenCalledWith("stale-rest");
    expect(dispatchScreenLoading).toHaveBeenCalledTimes(loadingDispatchCount);
  });

  it("does not let an older REST response overwrite a newer SSE screen", async () => {
    const enc = new TextEncoder();
    let resolveRestStarted!: () => void;
    const restStarted = new Promise<void>((resolve) => {
      resolveRestStarted = resolve;
    });
    const sseResponse: ScreenResponse = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(2_000).toISOString(),
      screen: "newer-sse",
      full: true,
    };

    server.use(
      http.get("/api/streams/sessions/pane-1/screen", async () => {
        await restStarted;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(`event: screen\ndata: ${JSON.stringify(sseResponse)}\n\n`),
            );
          },
          cancel() {},
        });
        return new HttpResponse(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    let resolveRest!: (response: ScreenResponse) => void;
    const requestScreen = vi.fn(() => {
      resolveRestStarted();
      return new Promise<ScreenResponse>((resolve) => {
        resolveRest = resolve;
      });
    });
    const setScreen = vi.fn();
    const { result, params } = setup({
      requestScreen,
      setScreen,
      apiBasePath: "/api",
      token: "test-token",
    });

    act(() => {
      void result.current.refreshScreen();
    });
    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(setScreen).toHaveBeenCalledWith("newer-sse");
    });

    await act(async () => {
      resolveRest({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(1_000).toISOString(),
        screen: "older-rest",
        full: true,
      });
    });

    expect(setScreen).toHaveBeenLastCalledWith("newer-sse");
    expect(setScreen).not.toHaveBeenCalledWith("older-rest");
    expect(params.onModeLoaded).toHaveBeenCalledTimes(1);
  });

  it("rejects a newer REST delta when SSE changed its cursor base", async () => {
    const enc = new TextEncoder();
    let resolveRestStarted!: () => void;
    const restStarted = new Promise<void>((resolve) => {
      resolveRestStarted = resolve;
    });
    const sseResponse: ScreenResponse = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(1_000).toISOString(),
      cursor: "sse-cursor",
      screen: "sse-a\nsse-b",
      full: true,
    };
    server.use(
      http.get("/api/streams/sessions/pane-1/screen", async () => {
        await restStarted;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(`event: screen\ndata: ${JSON.stringify(sseResponse)}\n\n`),
            );
          },
          cancel() {},
        });
        return new HttpResponse(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    let resolveRest!: (response: ScreenResponse) => void;
    const requestScreen = vi.fn(() => {
      resolveRestStarted();
      return new Promise<ScreenResponse>((resolve) => {
        resolveRest = resolve;
      });
    });
    const setScreen = vi.fn();
    const { result, params } = setup({
      requestScreen,
      initialCursor: "rest-base",
      initialScreen: "rest-a\nrest-b",
      setScreen,
      apiBasePath: "/api",
      token: "test-token",
    });

    act(() => {
      void result.current.refreshScreen();
    });
    await waitFor(() => {
      expect(requestScreen).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(setScreen).toHaveBeenCalledWith("sse-a\nsse-b");
    });
    expect(params.content.getCursor()).toBe("sse-cursor");

    await act(async () => {
      resolveRest({
        ok: true,
        paneId: "pane-1",
        mode: "text",
        capturedAt: new Date(1_000).toISOString(),
        cursor: "rest-next",
        full: false,
        deltas: [{ start: 0, deleteCount: 1, insertLines: ["corrupt"] }],
      });
    });

    expect(setScreen).toHaveBeenLastCalledWith("sse-a\nsse-b");
    expect(setScreen).not.toHaveBeenCalledWith("corrupt\nsse-b");
    expect(params.content.getCursor()).toBe("sse-cursor");
  });

  it("ignores SSE screen events for another pane", async () => {
    const enc = new TextEncoder();
    const wrongPaneResponse: ScreenResponse = {
      ok: true,
      paneId: "pane-2",
      mode: "text",
      capturedAt: new Date(1_000).toISOString(),
      screen: "wrong-pane",
      full: true,
    };

    server.use(
      http.get("/api/streams/sessions/pane-1/screen", () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(`event: screen\ndata: ${JSON.stringify(wrongPaneResponse)}\n\n`),
            );
          },
          cancel() {},
        });
        return new HttpResponse(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const requestScreen = vi.fn(() => new Promise<ScreenResponse>(() => {}));
    const setScreen = vi.fn();
    const { result, params } = setup({
      requestScreen,
      setScreen,
      apiBasePath: "/api",
      token: "test-token",
    });

    await waitFor(() => {
      expect(result.current.transport).toBe("sse");
    });
    await act(async () => {});

    expect(setScreen).not.toHaveBeenCalledWith("wrong-pane");
    expect(params.onModeLoaded).not.toHaveBeenCalled();
  });

  it("surfaces an SSE capture error and finishes the initial loading state", async () => {
    const enc = new TextEncoder();
    const screenPayload: ScreenResponse = {
      ok: false,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      error: { code: "CMUX_UNAVAILABLE", message: "cmux socket closed" },
    };

    server.use(
      http.get("/api/streams/sessions/pane-1/screen", () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(`event: screen\ndata: ${JSON.stringify(screenPayload)}\n\n`),
            );
          },
          cancel() {},
        });
        return new HttpResponse(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const requestScreen = vi.fn(() => new Promise<ScreenResponse>(() => {}));
    const onModeLoaded = vi.fn();
    const { result, params } = setup({
      requestScreen,
      onModeLoaded,
      apiBasePath: "/api",
      token: "test-token",
    });

    await waitFor(() => {
      expect(result.current.error).toBe("cmux socket closed");
    });
    expect(params.dispatchScreenLoading).toHaveBeenCalledWith({ type: "finish", mode: "text" });
    expect(onModeLoaded).toHaveBeenCalledWith("text");
    expect(requestScreen).not.toHaveBeenCalled();
  });
});
