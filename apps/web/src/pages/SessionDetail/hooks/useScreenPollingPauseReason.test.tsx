import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import { useScreenPollingPauseReason } from "./useScreenPollingPauseReason";

describe("useScreenPollingPauseReason", () => {
  let originalHidden: PropertyDescriptor | undefined;
  let originalOnLine: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    originalOnLine = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  afterEach(() => {
    if (originalHidden) {
      Object.defineProperty(document, "hidden", originalHidden);
    } else {
      Reflect.deleteProperty(document, "hidden");
    }
    if (originalOnLine) {
      Object.defineProperty(navigator, "onLine", originalOnLine);
    } else {
      Reflect.deleteProperty(navigator, "onLine");
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("tracks hidden state and resumes on visibility change", () => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const { result } = renderHook(() =>
      useScreenPollingPauseReason({
        connected: true,
        connectionIssue: null,
      }),
    );

    expect(result.current).toBe("hidden");

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBeNull();
  });

  it("tracks offline, online, visibility, and focus browser events", () => {
    const { result } = renderHook(() =>
      useScreenPollingPauseReason({
        connected: true,
        connectionIssue: null,
      }),
    );

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe("offline");

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe("hidden");

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBeNull();

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe("hidden");
  });

  it("keeps one active browser subscription during StrictMode replay and removes it on unmount", () => {
    const windowAddEventListener = vi.spyOn(window, "addEventListener");
    const windowRemoveEventListener = vi.spyOn(window, "removeEventListener");
    const documentAddEventListener = vi.spyOn(document, "addEventListener");
    const documentRemoveEventListener = vi.spyOn(document, "removeEventListener");
    const hook = renderHook(
      () =>
        useScreenPollingPauseReason({
          connected: true,
          connectionIssue: null,
        }),
      { wrapper: StrictMode },
    );

    const countActiveListeners = (
      type: string,
      addCalls: Array<[string, EventListenerOrEventListenerObject, ...unknown[]]>,
      removeCalls: Array<[string, EventListenerOrEventListenerObject, ...unknown[]]>,
    ) => {
      const active = new Set<EventListenerOrEventListenerObject>();
      addCalls.forEach(([eventType, listener]) => {
        if (eventType === type) {
          active.add(listener);
        }
      });
      removeCalls.forEach(([eventType, listener]) => {
        if (eventType === type) {
          active.delete(listener);
        }
      });
      return active.size;
    };
    const countActiveWindowListeners = (type: "online" | "offline" | "focus") =>
      countActiveListeners(
        type,
        windowAddEventListener.mock.calls,
        windowRemoveEventListener.mock.calls,
      );
    const countActiveVisibilityListeners = () =>
      countActiveListeners(
        "visibilitychange",
        documentAddEventListener.mock.calls,
        documentRemoveEventListener.mock.calls,
      );

    expect(countActiveWindowListeners("online")).toBe(1);
    expect(countActiveWindowListeners("offline")).toBe(1);
    expect(countActiveWindowListeners("focus")).toBe(1);
    expect(countActiveVisibilityListeners()).toBe(1);

    hook.unmount();
    expect(countActiveWindowListeners("online")).toBe(0);
    expect(countActiveWindowListeners("offline")).toBe(0);
    expect(countActiveWindowListeners("focus")).toBe(0);
    expect(countActiveVisibilityListeners()).toBe(0);
  });

  it("prioritizes disconnected and unauthorized states", () => {
    const disconnected = renderHook(() =>
      useScreenPollingPauseReason({
        connected: false,
        connectionIssue: null,
      }),
    );
    expect(disconnected.result.current).toBe("disconnected");

    const unauthorized = renderHook(() =>
      useScreenPollingPauseReason({
        connected: true,
        connectionIssue: API_ERROR_MESSAGES.unauthorized,
      }),
    );
    expect(unauthorized.result.current).toBe("unauthorized");
  });
});
