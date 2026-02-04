// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSessionSocketRequests } from "./use-session-socket-requests";

describe("useSessionSocketRequests", () => {
  it("resolves pending request on matching response", async () => {
    const sendJsonMessage = vi.fn();
    const onReadOnly = vi.fn();
    const { result } = renderHook(() =>
      useSessionSocketRequests({
        connected: true,
        sendJsonMessage,
        onReadOnly,
      }),
    );

    const promise = result.current.sendText("pane-1", "hello");
    const payload = sendJsonMessage.mock.calls[0]?.[0] as { reqId: string };
    expect(payload?.reqId).toBeTruthy();

    act(() => {
      result.current.handleResponseMessage({
        type: "command.response",
        ts: new Date().toISOString(),
        reqId: payload.reqId,
        data: { ok: true },
      });
    });

    await expect(promise).resolves.toMatchObject({ ok: true });
    expect(onReadOnly).not.toHaveBeenCalled();
  });

  it("notifies read-only when response indicates", async () => {
    const sendJsonMessage = vi.fn();
    const onReadOnly = vi.fn();
    const { result } = renderHook(() =>
      useSessionSocketRequests({
        connected: true,
        sendJsonMessage,
        onReadOnly,
      }),
    );

    const promise = result.current.sendKeys("pane-1", ["Enter"]);
    const payload = sendJsonMessage.mock.calls[0]?.[0] as { reqId: string };

    act(() => {
      result.current.handleResponseMessage({
        type: "command.response",
        ts: new Date().toISOString(),
        reqId: payload.reqId,
        data: { ok: false, error: { code: "READ_ONLY", message: "read only" } },
      });
    });

    await expect(promise).resolves.toMatchObject({ ok: false });
    expect(onReadOnly).toHaveBeenCalled();
  });

  it("sends raw payloads with unsafe flag", () => {
    const sendJsonMessage = vi.fn();
    const onReadOnly = vi.fn();
    const { result } = renderHook(() =>
      useSessionSocketRequests({
        connected: true,
        sendJsonMessage,
        onReadOnly,
      }),
    );

    result.current.sendRaw("pane-1", [{ kind: "text", value: "pwd" }], true);
    const payload = sendJsonMessage.mock.calls[0]?.[0] as {
      type: string;
      data: { paneId: string; items: unknown[]; unsafe?: boolean };
    };

    expect(payload.type).toBe("send.raw");
    expect(payload.data.paneId).toBe("pane-1");
    expect(payload.data.unsafe).toBe(true);
  });

  it("rejects pending requests when forced", async () => {
    const sendJsonMessage = vi.fn();
    const onReadOnly = vi.fn();
    const { result } = renderHook(() =>
      useSessionSocketRequests({
        connected: true,
        sendJsonMessage,
        onReadOnly,
      }),
    );

    const promise = result.current.sendText("pane-1", "hello");

    act(() => {
      result.current.rejectAllPending(new Error("gone"));
    });

    await expect(promise).rejects.toThrow("gone");
  });
});
