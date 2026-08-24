import { act, renderHook } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { screenModeAtom, screenModeLoadedAtom } from "../atoms/screenAtoms";
import { useScreenMode } from "./useScreenMode";

describe("useScreenMode", () => {
  const createWrapper = () => {
    const store = createStore();
    store.set(screenModeAtom, "text");
    store.set(screenModeLoadedAtom, { text: false, image: false });
    return ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    );
  };

  it("starts loading and updates refs when switching modes while connected", () => {
    const dispatchScreenLoading = vi.fn();
    const modeSwitchRef = { current: null as "text" | "image" | null };
    const cursorRef = { current: "cursor-1" as string | null };
    const screenLinesRef = { current: ["line-1"] };

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useScreenMode({
          connected: true,
          paneId: "pane-1",
          dispatchScreenLoading,
          modeSwitchRef,
          cursorRef,
          screenLinesRef,
        }),
      { wrapper },
    );

    act(() => {
      result.current.handleModeChange("image");
    });

    expect(result.current.mode).toBe("image");
    expect(modeSwitchRef.current).toBe("image");
    expect(cursorRef.current).toBeNull();
    expect(screenLinesRef.current).toEqual([]);
    expect(dispatchScreenLoading).toHaveBeenCalledWith({ type: "start", mode: "image" });
  });

  it("resets loading when disconnected", () => {
    const dispatchScreenLoading = vi.fn();
    const modeSwitchRef = { current: "text" as "text" | "image" | null };
    const cursorRef = { current: "cursor-1" as string | null };
    const screenLinesRef = { current: ["line-1"] };

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useScreenMode({
          connected: false,
          paneId: "pane-1",
          dispatchScreenLoading,
          modeSwitchRef,
          cursorRef,
          screenLinesRef,
        }),
      { wrapper },
    );

    act(() => {
      result.current.handleModeChange("image");
    });

    expect(result.current.mode).toBe("image");
    expect(modeSwitchRef.current).toBeNull();
    expect(cursorRef.current).toBe("cursor-1");
    expect(screenLinesRef.current).toEqual(["line-1"]);
    expect(dispatchScreenLoading).toHaveBeenCalledWith({ type: "reset" });
  });

  it("updates mode loaded state and its imperative ref in the same action", () => {
    const dispatchScreenLoading = vi.fn();
    const modeSwitchRef = { current: null as "text" | "image" | null };
    const cursorRef = { current: null as string | null };
    const screenLinesRef = { current: [] as string[] };

    const wrapper = createWrapper();
    const { result } = renderHook(
      () =>
        useScreenMode({
          connected: true,
          paneId: "pane-1",
          dispatchScreenLoading,
          modeSwitchRef,
          cursorRef,
          screenLinesRef,
        }),
      { wrapper },
    );

    act(() => {
      // useScreenFetch advances the imperative ref before notifying this hook.
      result.current.modeLoadedRef.current = { text: true, image: false };
      result.current.markModeLoaded("text");
      expect(result.current.modeLoadedRef.current).toEqual({ text: true, image: false });
    });

    expect(result.current.modeLoaded).toEqual({ text: true, image: false });

    act(() => {
      result.current.resetModeLoaded();
      expect(result.current.modeLoadedRef.current).toEqual({ text: false, image: false });
    });

    expect(result.current.modeLoaded).toEqual({ text: false, image: false });
  });

  it("resets mode to text when pane changes", () => {
    const dispatchScreenLoading = vi.fn();
    const modeSwitchRef = { current: null as "text" | "image" | null };
    const cursorRef = { current: null as string | null };
    const screenLinesRef = { current: [] as string[] };

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ paneId }: { paneId: string }) =>
        useScreenMode({
          connected: true,
          paneId,
          dispatchScreenLoading,
          modeSwitchRef,
          cursorRef,
          screenLinesRef,
        }),
      {
        wrapper,
        initialProps: { paneId: "pane-1" },
      },
    );

    act(() => {
      result.current.handleModeChange("image");
    });
    expect(result.current.mode).toBe("image");

    act(() => {
      rerender({ paneId: "pane-2" });
      expect(result.current.modeLoadedRef.current).toEqual({ text: false, image: false });
    });
    expect(result.current.mode).toBe("text");
    expect(result.current.modeLoaded).toEqual({ text: false, image: false });
  });
});
