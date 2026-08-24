import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useVisibilityPolling relies on window/document; mock it so tests stay
// unit-focused and run in jsdom without polluting the event loop.
vi.mock("@/lib/use-visibility-polling", () => ({
  useVisibilityPolling: vi.fn(),
}));

import { useScopeGuard } from "./useScopeGuard";

const noop = () => {};

describe("useScopeGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes scopeKey as paneId:worktreePath", () => {
    const onReconnectRef = { current: noop };
    const pollTickRef = { current: noop };

    const { result } = renderHook(() =>
      useScopeGuard({
        paneId: "pane1",
        worktreePath: "/repo/branch",
        connected: true,
        onReconnectRef,
        pollTickRef,
        pollIntervalMs: 5000,
      }),
    );

    expect(result.current.scopeKey).toBe("pane1:/repo/branch:__no_branch__");
  });

  it("uses __default__ when worktreePath is null", () => {
    const onReconnectRef = { current: noop };
    const pollTickRef = { current: noop };

    const { result } = renderHook(() =>
      useScopeGuard({
        paneId: "pane2",
        worktreePath: null,
        connected: true,
        onReconnectRef,
        pollTickRef,
        pollIntervalMs: 5000,
      }),
    );

    expect(result.current.scopeKey).toBe("pane2:__default__:__no_branch__");
  });

  it("updates activeScopeRef.current when paneId changes", () => {
    const onReconnectRef = { current: noop };
    const pollTickRef = { current: noop };

    const { result, rerender } = renderHook(
      ({ paneId }: { paneId: string }) =>
        useScopeGuard({
          paneId,
          worktreePath: null,
          connected: true,
          onReconnectRef,
          pollTickRef,
          pollIntervalMs: 5000,
        }),
      { initialProps: { paneId: "pane-a" } },
    );

    expect(result.current.activeScopeRef.current).toBe("pane-a:__default__:__no_branch__");

    rerender({ paneId: "pane-b" });

    expect(result.current.activeScopeRef.current).toBe("pane-b:__default__:__no_branch__");
  });

  it("invalidates activeScopeRef.current when the owning mount unmounts", () => {
    const onReconnectRef = { current: noop };
    const pollTickRef = { current: noop };

    const { result, unmount } = renderHook(() =>
      useScopeGuard({
        paneId: "pane-a",
        worktreePath: null,
        connected: true,
        onReconnectRef,
        pollTickRef,
        pollIntervalMs: 5000,
      }),
    );
    const activeScopeRef = result.current.activeScopeRef;
    const mountedScopeKey = activeScopeRef.current;

    unmount();

    expect(activeScopeRef.current).not.toBe(mountedScopeKey);
  });

  it("calls onReconnectRef.current when connected transitions false→true", () => {
    const onReconnect = vi.fn();
    const onReconnectRef = { current: onReconnect };
    const pollTickRef = { current: noop };

    const { rerender } = renderHook(
      ({ connected }: { connected: boolean }) =>
        useScopeGuard({
          paneId: "pane1",
          worktreePath: null,
          connected,
          onReconnectRef,
          pollTickRef,
          pollIntervalMs: 5000,
        }),
      { initialProps: { connected: false } },
    );

    expect(onReconnect).not.toHaveBeenCalled();

    act(() => {
      rerender({ connected: true });
    });

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onReconnectRef.current on first render with connected=true", () => {
    const onReconnect = vi.fn();
    const onReconnectRef = { current: onReconnect };
    const pollTickRef = { current: noop };

    renderHook(() =>
      useScopeGuard({
        paneId: "pane1",
        worktreePath: null,
        connected: true,
        onReconnectRef,
        pollTickRef,
        pollIntervalMs: 5000,
      }),
    );

    expect(onReconnect).not.toHaveBeenCalled();
  });
});
