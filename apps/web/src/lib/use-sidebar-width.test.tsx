// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSidebarWidth } from "./use-sidebar-width";

const STORAGE_KEY = "vde.sidebar-width";

describe("useSidebarWidth", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("updates width based on pointer drag", () => {
    window.localStorage.setItem(STORAGE_KEY, "300");
    const { result } = renderHook(() => useSidebarWidth());

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        pointerType: "mouse",
        clientX: 100,
      } as never);
    });

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 150 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(result.current.sidebarWidth).toBe(350);
  });

  it("clamps width within bounds", () => {
    const { result } = renderHook(() => useSidebarWidth());

    act(() => {
      result.current.handlePointerDown({
        button: 0,
        pointerType: "mouse",
        clientX: 0,
      } as never);
    });

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 1000 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(result.current.sidebarWidth).toBe(460);
  });
});
