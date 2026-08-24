import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePaneSendText } from "./usePaneSendText";

describe("usePaneSendText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks duplicate sends while in flight", async () => {
    let resolveSend: ((value: { ok: boolean }) => void) | null = null;
    const sendText = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      usePaneSendText({
        paneId: "pane-1",
        mode: "text",
        sendText,
        setScreenError,
        scrollToBottom,
      }),
    );

    act(() => {
      void result.current.send({
        text: "echo hello",
        enter: true,
      });
      void result.current.send({
        text: "echo hello",
        enter: true,
      });
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(result.current.isSending).toBe(true);

    await act(async () => {
      resolveSend?.({ ok: true });
      await Promise.resolve();
    });

    expect(result.current.isSending).toBe(false);
    expect(scrollToBottom).toHaveBeenCalledWith("auto");
  });

  it("reuses request id for retry after failure", async () => {
    const sendText = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTERNAL", message: "Request timed out. Please retry." },
      })
      .mockResolvedValueOnce({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      usePaneSendText({
        paneId: "pane-1",
        mode: "text",
        sendText,
        setScreenError,
        scrollToBottom,
      }),
    );

    await act(async () => {
      await result.current.send({
        text: "echo retry",
        enter: true,
      });
    });
    await act(async () => {
      await result.current.send({
        text: "echo retry",
        enter: true,
      });
    });

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText.mock.calls[0]?.[3]).toBeTruthy();
    expect(sendText.mock.calls[1]?.[3]).toBe(sendText.mock.calls[0]?.[3]);
    expect(setScreenError).toHaveBeenCalledWith("Request timed out. Please retry.");
    expect(result.current.error).toBeNull();
  });

  it("ignores a previous pane completion without unlocking the current pane send", async () => {
    let resolvePaneA: ((value: { ok: boolean }) => void) | undefined;
    let resolvePaneB: ((value: { ok: boolean }) => void) | undefined;
    const sendText = vi.fn(
      (paneId: string) =>
        new Promise<{ ok: boolean }>((resolve) => {
          if (paneId === "pane-a") {
            resolvePaneA = resolve;
          } else {
            resolvePaneB = resolve;
          }
        }),
    );
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();
    const onPaneASuccess = vi.fn();
    const onPaneBSuccess = vi.fn();

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        usePaneSendText({
          paneId,
          mode: "text",
          sendText,
          setScreenError,
          scrollToBottom,
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    act(() => {
      void result.current.send({ text: "from a", enter: true, onSuccess: onPaneASuccess });
    });
    rerender({ paneId: "pane-b" });
    act(() => {
      void result.current.send({ text: "from b", enter: true, onSuccess: onPaneBSuccess });
    });
    expect(result.current.isSending).toBe(true);

    await act(async () => {
      resolvePaneA?.({ ok: true });
      await Promise.resolve();
    });

    expect(result.current.isSending).toBe(true);
    expect(onPaneASuccess).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.send({ text: "duplicate b", enter: true });
    });
    expect(sendText).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvePaneB?.({ ok: true });
      await Promise.resolve();
    });

    expect(result.current.isSending).toBe(false);
    expect(onPaneBSuccess).toHaveBeenCalledOnce();
    expect(scrollToBottom).toHaveBeenCalledOnce();
  });

  it("ignores a successful send completion after unmount", async () => {
    let resolveSend: ((value: { ok: boolean }) => void) | undefined;
    const sendText = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();
    const onSuccess = vi.fn();

    const { result, unmount } = renderHook(() =>
      usePaneSendText({
        paneId: "pane-1",
        mode: "text",
        sendText,
        setScreenError,
        scrollToBottom,
      }),
    );

    let sendPromise: Promise<boolean> | undefined;
    act(() => {
      sendPromise = result.current.send({ text: "echo stale", enter: true, onSuccess });
    });
    unmount();

    await act(async () => {
      resolveSend?.({ ok: true });
      await sendPromise;
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(setScreenError).not.toHaveBeenCalled();
  });

  it("ignores a failed send completion after unmount", async () => {
    let resolveSend:
      | ((value: { ok: false; error: { code: "INTERNAL"; message: string } }) => void)
      | undefined;
    const sendText = vi.fn(
      () =>
        new Promise<{ ok: false; error: { code: "INTERNAL"; message: string } }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result, unmount } = renderHook(() =>
      usePaneSendText({
        paneId: "pane-1",
        mode: "text",
        sendText,
        setScreenError,
        scrollToBottom,
      }),
    );

    let sendPromise: Promise<boolean> | undefined;
    act(() => {
      sendPromise = result.current.send({ text: "echo stale", enter: true });
    });
    unmount();

    await act(async () => {
      resolveSend?.({
        ok: false,
        error: { code: "INTERNAL", message: "stale failure" },
      });
      await sendPromise;
    });

    expect(setScreenError).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
