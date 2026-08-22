import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useScreenPanelLogReferenceLinking } from "./useScreenPanelLogReferenceLinking";

describe("useScreenPanelLogReferenceLinking", () => {
  it("resolves candidates from full range in smart mode", async () => {
    const onResolveFileReferenceCandidates = vi.fn(async (rawTokens: string[]) => rawTokens);
    const { result } = renderHook(() =>
      useScreenPanelLogReferenceLinking({
        mode: "text",
        effectiveWrapMode: "smart",
        paneId: "%1",
        sourceRepoRoot: "/repo",
        agent: "codex",
        screenLines: ["src/start.ts", "plain line", "tail.tsx"],
        onResolveFileReferenceCandidates,
      }),
    );

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(1);
    });
    const firstCallTokens = onResolveFileReferenceCandidates.mock.calls[0]?.[0] ?? [];
    expect(firstCallTokens).toEqual(expect.arrayContaining(["src/start.ts", "tail.tsx"]));
    expect(result.current.linkifiedScreenLines.length).toBe(3);
  });

  it("uses visible-range fallback window in off mode", async () => {
    const onResolveFileReferenceCandidates = vi.fn(async (rawTokens: string[]) => rawTokens);
    const screenLines = Array.from({ length: 300 }, (_, index) => {
      if (index === 0) {
        return "src/out-of-range.ts";
      }
      if (index === 290) {
        return "src/in-range.ts";
      }
      return `line-${index}`;
    });
    renderHook(() =>
      useScreenPanelLogReferenceLinking({
        mode: "text",
        effectiveWrapMode: "off",
        paneId: "%1",
        sourceRepoRoot: "/repo",
        agent: "codex",
        screenLines,
        onResolveFileReferenceCandidates,
      }),
    );

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(1);
    });
    const firstCallTokens = onResolveFileReferenceCandidates.mock.calls[0]?.[0] ?? [];
    expect(firstCallTokens).toContain("src/in-range.ts");
    expect(firstCallTokens).not.toContain("src/out-of-range.ts");
  });

  it("ignores an invalid range when lines are empty", () => {
    const { result } = renderHook(() =>
      useScreenPanelLogReferenceLinking({
        mode: "text",
        effectiveWrapMode: "off",
        paneId: "%1",
        sourceRepoRoot: "/repo",
        agent: "codex",
        screenLines: [],
        onResolveFileReferenceCandidates: vi.fn(async () => []),
      }),
    );

    act(() => {
      result.current.handleScreenRangeChanged({ startIndex: 0, endIndex: -1 });
    });

    expect(result.current.linkifiedScreenLines).toEqual([]);
  });

  it("re-runs resolve when context key changes even if tokens are unchanged", async () => {
    const onResolveFileReferenceCandidates = vi.fn(async (rawTokens: string[]) => rawTokens);
    const { rerender } = renderHook(
      ({ paneId }: { paneId: string }) =>
        useScreenPanelLogReferenceLinking({
          mode: "text",
          effectiveWrapMode: "smart",
          paneId,
          sourceRepoRoot: "/repo",
          agent: "codex",
          screenLines: ["src/reused.ts"],
          onResolveFileReferenceCandidates,
        }),
      { initialProps: { paneId: "%1" } },
    );

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(1);
    });

    rerender({ paneId: "%2" });

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(2);
    });
  });

  it("retries resolution after failure when context stays logically identical", async () => {
    const onResolveFileReferenceCandidates = vi
      .fn<(rawTokens: string[]) => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(["src/retry.ts"]);
    const { rerender } = renderHook(
      ({ screenLines }: { screenLines: string[] }) =>
        useScreenPanelLogReferenceLinking({
          mode: "text",
          effectiveWrapMode: "smart",
          paneId: "%1",
          sourceRepoRoot: "/repo",
          agent: "codex",
          screenLines,
          onResolveFileReferenceCandidates,
        }),
      { initialProps: { screenLines: ["src/retry.ts"] } },
    );

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(1);
    });

    rerender({ screenLines: ["src/retry.ts"] });

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(2);
    });
  });

  it("switches from smart full-range to off fallback-window behavior", async () => {
    const onResolveFileReferenceCandidates = vi.fn(async (rawTokens: string[]) => rawTokens);
    const screenLines = [
      "src/early.ts",
      ...Array.from({ length: 170 }, () => "plain"),
      "src/late.ts",
      ...Array.from({ length: 9 }, () => "plain"),
    ];
    const { rerender } = renderHook(
      ({ effectiveWrapMode }: { effectiveWrapMode: "off" | "smart" }) =>
        useScreenPanelLogReferenceLinking({
          mode: "text",
          effectiveWrapMode,
          paneId: "%1",
          sourceRepoRoot: "/repo",
          agent: "codex",
          screenLines,
          onResolveFileReferenceCandidates,
        }),
      { initialProps: { effectiveWrapMode: "smart" } as { effectiveWrapMode: "off" | "smart" } },
    );

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(1);
    });
    expect(onResolveFileReferenceCandidates.mock.calls[0]?.[0]).toContain("src/early.ts");

    rerender({ effectiveWrapMode: "off" });

    await waitFor(() => {
      expect(onResolveFileReferenceCandidates).toHaveBeenCalledTimes(2);
    });
    expect(onResolveFileReferenceCandidates.mock.calls[1]?.[0]).not.toContain("src/early.ts");
    expect(onResolveFileReferenceCandidates.mock.calls[1]?.[0]).toContain("src/late.ts");
  });
});
