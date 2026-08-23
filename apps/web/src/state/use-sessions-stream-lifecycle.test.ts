import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SseSubscriptionOptions } from "@/lib/sse/sse-subscription";

const { createSseSubscriptionMock } = vi.hoisted(() => ({
  createSseSubscriptionMock: vi.fn(),
}));

vi.mock("@/lib/sse/sse-subscription", () => ({
  createSseSubscription: createSseSubscriptionMock,
}));

import { useSessionsStream } from "./use-sessions-stream";

describe("useSessionsStream lifecycle", () => {
  beforeEach(() => {
    createSseSubscriptionMock.mockReset();
  });

  it("closes the active replacement subscription after a forced reconnect", () => {
    const firstClose = vi.fn();
    const replacementClose = vi.fn();
    createSseSubscriptionMock
      .mockReturnValueOnce({ close: firstClose })
      .mockReturnValueOnce({ close: replacementClose });

    const { unmount } = renderHook(() =>
      useSessionsStream({
        enabled: true,
        apiBaseUrl: "/api",
        token: "token",
        onSnapshot: vi.fn(),
        onUpsert: vi.fn(),
        onRemove: vi.fn(),
        onTransportChange: vi.fn(),
      }),
    );

    document.dispatchEvent(new Event("visibilitychange"));

    expect(createSseSubscriptionMock).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();

    unmount();

    expect(replacementClose).toHaveBeenCalledOnce();
  });

  it("does not reconnect when visibility changes to hidden", () => {
    const close = vi.fn();
    createSseSubscriptionMock.mockReturnValue({ close });
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    const { unmount } = renderHook(() =>
      useSessionsStream({
        enabled: true,
        apiBaseUrl: "/api",
        token: "token",
        onSnapshot: vi.fn(),
        onUpsert: vi.fn(),
        onRemove: vi.fn(),
        onTransportChange: vi.fn(),
      }),
    );

    document.dispatchEvent(new Event("visibilitychange"));

    expect(createSseSubscriptionMock).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    unmount();
    if (originalVisibilityState != null) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("uses the latest callbacks without recreating the subscription", () => {
    const close = vi.fn();
    createSseSubscriptionMock.mockReturnValue({ close });
    const firstTransportChange = vi.fn();
    const latestTransportChange = vi.fn();
    const firstAuthError = vi.fn();
    const latestAuthError = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ onAuthError, onTransportChange }) =>
        useSessionsStream({
          enabled: true,
          apiBaseUrl: "/api",
          token: "token",
          onSnapshot: vi.fn(),
          onUpsert: vi.fn(),
          onRemove: vi.fn(),
          onAuthError,
          onTransportChange,
        }),
      {
        initialProps: {
          onAuthError: firstAuthError,
          onTransportChange: firstTransportChange,
        },
      },
    );

    const subscriptionOptions = createSseSubscriptionMock.mock.calls[0]?.[0] as
      | SseSubscriptionOptions
      | undefined;
    expect(subscriptionOptions).toBeDefined();

    rerender({
      onAuthError: latestAuthError,
      onTransportChange: latestTransportChange,
    });
    subscriptionOptions?.onStateChange?.("open");
    subscriptionOptions?.onAuthError?.();

    expect(createSseSubscriptionMock).toHaveBeenCalledOnce();
    expect(firstTransportChange).not.toHaveBeenCalled();
    expect(firstAuthError).not.toHaveBeenCalled();
    expect(latestTransportChange).toHaveBeenCalledWith("sse");
    expect(latestAuthError).toHaveBeenCalledOnce();

    unmount();
  });

  it("keeps one active subscription through the StrictMode effect replay", () => {
    const firstClose = vi.fn();
    const activeClose = vi.fn();
    const replacementClose = vi.fn();
    createSseSubscriptionMock
      .mockReturnValueOnce({ close: firstClose })
      .mockReturnValueOnce({ close: activeClose })
      .mockReturnValueOnce({ close: replacementClose });

    const { unmount } = renderHook(
      () =>
        useSessionsStream({
          enabled: true,
          apiBaseUrl: "/api",
          token: "token",
          onSnapshot: vi.fn(),
          onUpsert: vi.fn(),
          onRemove: vi.fn(),
          onTransportChange: vi.fn(),
        }),
      { wrapper: StrictMode },
    );

    expect(createSseSubscriptionMock).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();
    expect(activeClose).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(createSseSubscriptionMock).toHaveBeenCalledTimes(3);
    expect(activeClose).toHaveBeenCalledOnce();
    expect(replacementClose).not.toHaveBeenCalled();

    unmount();
    expect(replacementClose).toHaveBeenCalledOnce();
  });
});
