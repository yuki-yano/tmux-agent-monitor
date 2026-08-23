import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePointerDrag } from "./use-pointer-drag";

describe("usePointerDrag", () => {
  afterEach(() => {
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  });

  it("continues drag across rerenders and uses latest onMove", () => {
    const onMoveA = vi.fn();
    const onMoveB = vi.fn();
    const onEndA = vi.fn();
    const onEndB = vi.fn();

    const { result, rerender } = renderHook(
      ({ cursor, onMove, onEnd }) => usePointerDrag({ cursor, onMove, onEnd }),
      {
        initialProps: { cursor: "ew-resize", onMove: onMoveA, onEnd: onEndA },
      },
    );

    act(() => {
      result.current.startDrag({} as never, { startX: 0 });
    });
    expect(document.body.style.cursor).toBe("ew-resize");

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10 }));
    });

    expect(onMoveA).toHaveBeenCalledTimes(1);

    rerender({ cursor: "row-resize", onMove: onMoveB, onEnd: onEndB });

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 20 }));
    });

    expect(onMoveB).toHaveBeenCalledTimes(1);
    expect(onEndA).not.toHaveBeenCalled();
    expect(onEndB).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(onEndA).not.toHaveBeenCalled();
    expect(onEndB).toHaveBeenCalledWith({ startX: 0 });

    act(() => {
      result.current.startDrag({} as never, { startX: 20 });
    });
    expect(document.body.style.cursor).toBe("row-resize");
  });

  it("does not duplicate drag listeners during the StrictMode effect replay", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const { result, unmount } = renderHook(
      () => usePointerDrag({ cursor: "ew-resize", onMove, onEnd }),
      { wrapper: StrictMode },
    );

    act(() => {
      result.current.startDrag({} as never, { startX: 0 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(onMove).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");

    act(() => {
      result.current.startDrag({} as never, { startX: 20 });
    });
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("ew-resize");

    unmount();
    expect(onEnd).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenLastCalledWith({ startX: 20 });
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 30 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(onMove).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledTimes(2);
  });
});
