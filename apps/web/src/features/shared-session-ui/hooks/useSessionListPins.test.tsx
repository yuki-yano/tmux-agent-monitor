import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionListPins } from "./useSessionListPins";

const STORAGE_KEY = "vde-monitor-session-list-pins";

describe("useSessionListPins", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads stored pin values and resolves repo sort anchor", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        repos: {
          "repo:/repo/a": 111,
        },
      }),
    );
    const { result } = renderHook(() => useSessionListPins({}));

    expect(result.current.getRepoSortAnchorAt("/repo/a")).toBe(111);
    expect(result.current.getRepoSortAnchorAt("/repo/b")).toBeNull();
  });

  it("touches repo pin and persists storage", async () => {
    const { result } = renderHook(() => useSessionListPins({}));

    act(() => {
      result.current.touchRepoPin("/repo/a");
    });

    await waitFor(() => {
      expect(result.current.getRepoSortAnchorAt("/repo/a")).toBeTypeOf("number");
    });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? "{}") as { repos?: Record<string, number> };
    expect(parsed.repos?.["repo:/repo/a"]).toBeTypeOf("number");
  });

  it("composes consecutive repo pin updates before a rerender", () => {
    const { result } = renderHook(() => useSessionListPins({}));

    act(() => {
      result.current.touchRepoPin("/repo/a");
      result.current.touchRepoPin("/repo/b");
    });

    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(stored ?? "{}") as { repos?: Record<string, number> };
    expect(parsed.repos?.["repo:/repo/a"]).toBeTypeOf("number");
    expect(parsed.repos?.["repo:/repo/b"]).toBeTypeOf("number");
  });

  it("touches pane pin and triggers onTouchPane callback", async () => {
    const onTouchPane = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSessionListPins({
        onTouchPane,
      }),
    );

    act(() => {
      result.current.touchPanePin("%1");
    });

    expect(onTouchPane).toHaveBeenCalledWith("%1");
    expect(result.current.getRepoSortAnchorAt("/repo/a")).toBeNull();
  });
});
