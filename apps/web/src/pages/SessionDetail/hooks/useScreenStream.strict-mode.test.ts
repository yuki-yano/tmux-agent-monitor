import { act, renderHook } from "@testing-library/react";
import type { ScreenResponse } from "@vde-monitor/shared";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SseSubscriptionOptions } from "@/lib/sse/sse-subscription";

const { createSseSubscriptionMock } = vi.hoisted(() => ({
  createSseSubscriptionMock: vi.fn(),
}));

vi.mock("@/lib/sse/sse-subscription", () => ({
  createSseSubscription: createSseSubscriptionMock,
}));

import { useScreenStream } from "./useScreenStream";

describe("useScreenStream StrictMode lifecycle", () => {
  beforeEach(() => {
    createSseSubscriptionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one active stream and delivers each event once after effect replay", () => {
    vi.useFakeTimers();
    const firstClose = vi.fn();
    const activeClose = vi.fn();
    createSseSubscriptionMock
      .mockReturnValueOnce({ close: firstClose })
      .mockReturnValueOnce({ close: activeClose });
    const onScreenEvent = vi.fn();

    const { result, unmount } = renderHook(
      () =>
        useScreenStream({
          enabled: true,
          paneId: "pane-1",
          apiBasePath: "/api",
          token: "token",
          onScreenEvent,
          fallbackDelayMs: 10,
        }),
      { wrapper: StrictMode },
    );

    expect(createSseSubscriptionMock).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();
    expect(activeClose).not.toHaveBeenCalled();

    const options = createSseSubscriptionMock.mock.calls[1]?.[0] as
      | SseSubscriptionOptions
      | undefined;
    const response: ScreenResponse = {
      ok: true,
      paneId: "pane-1",
      mode: "text",
      capturedAt: new Date(0).toISOString(),
      screen: "strict-mode",
      full: true,
    };
    act(() => {
      options?.onStateChange?.("open");
      options?.onEvent?.({ event: "screen", data: JSON.stringify(response) });
    });

    expect(onScreenEvent).toHaveBeenCalledOnce();
    expect(onScreenEvent).toHaveBeenCalledWith(response);
    expect(result.current.transport).toBe("sse");

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.transport).toBe("sse");
    expect(onScreenEvent).toHaveBeenCalledOnce();

    unmount();
    expect(activeClose).toHaveBeenCalledOnce();
  });
});
