// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "./session-context";

const apiMock = {
  refreshSessions: vi.fn(async () => ({ ok: true, authError: false, rateLimited: false })),
  requestDiffSummary: vi.fn(),
  requestDiffFile: vi.fn(),
  requestCommitLog: vi.fn(),
  requestCommitDetail: vi.fn(),
  requestCommitFile: vi.fn(),
  requestStateTimeline: vi.fn(),
  requestScreen: vi.fn(),
  focusPane: vi.fn(),
  uploadImageAttachment: vi.fn(),
  sendText: vi.fn(),
  sendKeys: vi.fn(),
  sendRaw: vi.fn(),
  updateSessionTitle: vi.fn(),
  touchSession: vi.fn(),
};

vi.mock("./use-session-api", () => ({
  useSessionApi: () => apiMock,
}));

vi.mock("./use-session-token", () => ({
  useSessionToken: () => ({ token: "token", setToken: vi.fn(), apiBaseUrl: null }),
}));

describe("SessionProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("polls sessions every 1000ms by default", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(
      <SessionProvider>
        <div />
      </SessionProvider>,
    );

    const calls = setIntervalSpy.mock.calls.map((call) => call[1]);
    expect(calls).toContain(1000);
  });

  it("pauses polling while hidden and resumes on visibilitychange", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const addListenerSpy = vi.spyOn(window, "addEventListener");
    apiMock.refreshSessions.mockClear();

    render(
      <SessionProvider>
        <div />
      </SessionProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMock.refreshSessions).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    const visibilityListener = addListenerSpy.mock.calls.find(
      ([event]) => event === "visibilitychange",
    )?.[1] as EventListener;
    act(() => {
      visibilityListener(new Event("visibilitychange"));
    });

    expect(apiMock.refreshSessions).toHaveBeenCalledTimes(2);
    expect(setIntervalSpy).toHaveBeenCalled();
  });

  it("stops polling on offline events", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const addListenerSpy = vi.spyOn(window, "addEventListener");

    render(
      <SessionProvider>
        <div />
      </SessionProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(setIntervalSpy).toHaveBeenCalled();

    const intervalId = setIntervalSpy.mock.results[0]?.value;
    const offlineListener = addListenerSpy.mock.calls.find(
      ([event]) => event === "offline",
    )?.[1] as EventListener;
    act(() => {
      offlineListener(new Event("offline"));
    });

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });
});
