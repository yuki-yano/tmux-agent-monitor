import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSplitRatio } from "./use-split-ratio";

describe("useSplitRatio", () => {
  beforeEach(() => {
    window.localStorage.removeItem("test.split");
  });

  afterEach(() => {
    window.localStorage.removeItem("test.split");
  });

  const attachContainer = (ref: { current: HTMLDivElement | null }, width: number) => {
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
      ({
        width,
        height: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    ref.current = node;
  };

  it("updates ratio based on pointer drag", () => {
    window.localStorage.setItem("test.split", "0.5");
    const { result } = renderHook(() =>
      useSplitRatio({
        storageKey: "test.split",
        defaultRatio: 0.5,
        minRatio: 0.35,
        maxRatio: 0.65,
      }),
    );

    act(() => {
      attachContainer(result.current.containerRef, 1000);
    });

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        pointerType: "mouse",
        clientX: 100,
      } as never);
    });

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 200 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(result.current.ratio).toBeCloseTo(0.6, 3);
    expect(window.localStorage.getItem("test.split")).toBe("0.6");
  });

  it("clamps ratio to max", () => {
    const { result } = renderHook(() =>
      useSplitRatio({
        storageKey: "test.split",
        defaultRatio: 0.5,
        minRatio: 0.35,
        maxRatio: 0.65,
      }),
    );

    act(() => {
      attachContainer(result.current.containerRef, 1000);
    });

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        pointerType: "mouse",
        clientX: 0,
      } as never);
    });

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 2000 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(result.current.ratio).toBeCloseTo(0.65, 3);
    expect(window.localStorage.getItem("test.split")).toBe("0.65");
  });
});
