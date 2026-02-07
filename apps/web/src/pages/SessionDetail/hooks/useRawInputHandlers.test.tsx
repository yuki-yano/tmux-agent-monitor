// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import type { CompositionEvent, FormEvent, KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRawInputHandlers } from "./useRawInputHandlers";

const createFormEvent = (
  textarea: HTMLTextAreaElement,
  nativeEvent: Partial<InputEvent>,
  preventDefault = vi.fn(),
) =>
  ({
    currentTarget: textarea,
    nativeEvent,
    preventDefault,
  }) as unknown as FormEvent<HTMLTextAreaElement>;

const createKeyEvent = (
  textarea: HTMLTextAreaElement,
  options: {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
  },
) => {
  const preventDefault = vi.fn();
  const event = {
    currentTarget: textarea,
    key: options.key,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    preventDefault,
    nativeEvent: { isComposing: options.isComposing ?? false },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
  return { event, preventDefault };
};

const createCompositionEvent = (textarea: HTMLTextAreaElement, data: string) =>
  ({
    currentTarget: textarea,
    data,
  }) as unknown as CompositionEvent<HTMLTextAreaElement>;

describe("useRawInputHandlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("batches consecutive text inputs and uses latest allowDangerKeys", async () => {
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const textarea = document.createElement("textarea");

    const { result, rerender } = renderHook(
      ({ allowDangerKeys }: { allowDangerKeys: boolean }) =>
        useRawInputHandlers({
          paneId: "pane-1",
          rawMode: true,
          allowDangerKeys,
          ctrlHeld: false,
          shiftHeld: false,
          sendRaw,
          setScreenError,
        }),
      { initialProps: { allowDangerKeys: false } },
    );

    textarea.value = "he";
    act(() => {
      result.current.handleRawInput(createFormEvent(textarea, {}));
    });

    textarea.value = "llo";
    act(() => {
      result.current.handleRawInput(createFormEvent(textarea, {}));
    });

    rerender({ allowDangerKeys: true });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "text", value: "hello" }], true);
    expect(setScreenError).not.toHaveBeenCalled();
  });

  it("sends API error message when sendRaw fails logically", async () => {
    const sendRaw = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "send failed" },
    });
    const setScreenError = vi.fn();
    const textarea = document.createElement("textarea");

    const { result } = renderHook(() =>
      useRawInputHandlers({
        paneId: "pane-1",
        rawMode: true,
        allowDangerKeys: false,
        ctrlHeld: false,
        shiftHeld: false,
        sendRaw,
        setScreenError,
      }),
    );

    textarea.value = "x";
    act(() => {
      result.current.handleRawInput(createFormEvent(textarea, {}));
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "text", value: "x" }], false);
    expect(setScreenError).toHaveBeenCalledWith("send failed");
  });

  it("suppresses duplicate beforeinput after ctrl+letter keydown", async () => {
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const textarea = document.createElement("textarea");

    const { result } = renderHook(() =>
      useRawInputHandlers({
        paneId: "pane-1",
        rawMode: true,
        allowDangerKeys: false,
        ctrlHeld: false,
        shiftHeld: false,
        sendRaw,
        setScreenError,
      }),
    );

    const { event: keyEvent, preventDefault: keyPreventDefault } = createKeyEvent(textarea, {
      key: "a",
      ctrlKey: true,
    });
    act(() => {
      result.current.handleRawKeyDown(keyEvent);
    });

    const beforeInputPreventDefault = vi.fn();
    act(() => {
      result.current.handleRawBeforeInput(
        createFormEvent(
          textarea,
          { inputType: "insertText", data: "a" } as Partial<InputEvent>,
          beforeInputPreventDefault,
        ),
      );
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(keyPreventDefault).toHaveBeenCalledTimes(1);
    expect(beforeInputPreventDefault).not.toHaveBeenCalled();
    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "key", value: "C-a" }], false);
  });

  it("ignores raw input events when raw mode is disabled", async () => {
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const textarea = document.createElement("textarea");

    const { result } = renderHook(() =>
      useRawInputHandlers({
        paneId: "pane-1",
        rawMode: false,
        allowDangerKeys: false,
        ctrlHeld: false,
        shiftHeld: false,
        sendRaw,
        setScreenError,
      }),
    );

    textarea.value = "readonly";
    act(() => {
      result.current.handleRawInput(createFormEvent(textarea, {}));
    });
    act(() => {
      result.current.handleRawCompositionEnd(createCompositionEvent(textarea, "x"));
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).not.toHaveBeenCalled();
    expect(setScreenError).not.toHaveBeenCalled();
  });
});
