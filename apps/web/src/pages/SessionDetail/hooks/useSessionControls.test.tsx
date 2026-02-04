// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionControls } from "./useSessionControls";

describe("useSessionControls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends text with auto-enter toggle and clears input", async () => {
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");
    textarea.value = "echo hello";

    act(() => {
      result.current.textInputRef.current = textarea;
      result.current.toggleAutoEnter();
    });

    await act(async () => {
      await result.current.handleSendText();
    });

    expect(sendText).toHaveBeenCalledWith("pane-1", "echo hello", false);
    expect(textarea.value).toBe("");
    expect(scrollToBottom).toHaveBeenCalledWith("auto");
  });

  it("blocks dangerous text when confirmation is canceled", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);

    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");
    textarea.value = "rm -rf /";

    act(() => {
      result.current.textInputRef.current = textarea;
    });

    await act(async () => {
      await result.current.handleSendText();
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("maps modifier keys before sending", async () => {
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    act(() => {
      result.current.toggleShift();
    });

    await act(async () => {
      await result.current.handleSendKey("Tab");
    });

    act(() => {
      result.current.toggleCtrl();
    });

    await act(async () => {
      await result.current.handleSendKey("Left");
    });

    expect(sendKeys).toHaveBeenNthCalledWith(1, "pane-1", ["BTab"]);
    expect(sendKeys).toHaveBeenNthCalledWith(2, "pane-1", ["C-Left"]);
  });

  it("sends raw ctrl key input from beforeinput", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");
    act(() => {
      result.current.textInputRef.current = textarea;
      result.current.toggleRawMode();
      result.current.toggleCtrl();
    });

    const preventDefault = vi.fn();
    act(() => {
      result.current.handleRawBeforeInput({
        currentTarget: textarea,
        nativeEvent: { inputType: "insertText", data: "d" },
        preventDefault,
      } as unknown as FormEvent<HTMLTextAreaElement>);
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "key", value: "C-d" }], false);
    vi.useRealTimers();
  });

  it("uses input fallback when beforeinput is not handled", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");
    textarea.value = "hi";

    act(() => {
      result.current.textInputRef.current = textarea;
      result.current.toggleRawMode();
    });

    act(() => {
      result.current.handleRawInput({
        currentTarget: textarea,
        nativeEvent: { inputType: "insertText", data: null },
      } as unknown as FormEvent<HTMLTextAreaElement>);
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "text", value: "hi" }], false);
    vi.useRealTimers();
  });

  it("accepts replacement text input types", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");

    act(() => {
      result.current.textInputRef.current = textarea;
      result.current.toggleRawMode();
    });

    act(() => {
      result.current.handleRawBeforeInput({
        currentTarget: textarea,
        nativeEvent: { inputType: "insertReplacementText", data: "？" },
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLTextAreaElement>);
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "text", value: "？" }], false);
    vi.useRealTimers();
  });

  it("falls back to input when beforeinput has no data", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");

    act(() => {
      result.current.textInputRef.current = textarea;
      result.current.toggleRawMode();
    });

    act(() => {
      result.current.handleRawBeforeInput({
        currentTarget: textarea,
        nativeEvent: { inputType: "insertReplacementText", data: "" },
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLTextAreaElement>);
    });

    textarea.value = "?";
    act(() => {
      result.current.handleRawInput({
        currentTarget: textarea,
        nativeEvent: { inputType: "insertReplacementText", data: null },
      } as unknown as FormEvent<HTMLTextAreaElement>);
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "text", value: "?" }], false);
    vi.useRealTimers();
  });

  it("handles insertCompositionText outside composition", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    const textarea = document.createElement("textarea");

    act(() => {
      result.current.textInputRef.current = textarea;
      result.current.toggleRawMode();
    });

    act(() => {
      result.current.handleRawBeforeInput({
        currentTarget: textarea,
        nativeEvent: { inputType: "insertCompositionText", data: "?" },
        preventDefault: vi.fn(),
      } as unknown as FormEvent<HTMLTextAreaElement>);
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(sendRaw).toHaveBeenCalledWith("pane-1", [{ kind: "text", value: "?" }], false);
    vi.useRealTimers();
  });

  it("restores auto-enter after toggling raw mode off", () => {
    const sendText = vi.fn().mockResolvedValue({ ok: true });
    const sendKeys = vi.fn().mockResolvedValue({ ok: true });
    const sendRaw = vi.fn().mockResolvedValue({ ok: true });
    const setScreenError = vi.fn();
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() =>
      useSessionControls({
        paneId: "pane-1",
        readOnly: false,
        mode: "text",
        sendText,
        sendKeys,
        sendRaw,
        setScreenError,
        scrollToBottom,
      }),
    );

    expect(result.current.autoEnter).toBe(true);

    act(() => {
      result.current.toggleRawMode();
    });

    expect(result.current.rawMode).toBe(true);
    expect(result.current.autoEnter).toBe(false);

    act(() => {
      result.current.toggleRawMode();
    });

    expect(result.current.rawMode).toBe(false);
    expect(result.current.autoEnter).toBe(true);
  });
});
