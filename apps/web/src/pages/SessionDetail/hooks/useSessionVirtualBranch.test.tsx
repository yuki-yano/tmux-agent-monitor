import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { BranchList, BranchListEntry } from "@vde-monitor/shared";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { useSessionBranches } from "./useSessionBranches";
import { useSessionVirtualBranch } from "./useSessionVirtualBranch";

const STORAGE_KEY_PREFIX = "vde-monitor:virtual-branch:v1";

const buildStorageKey = (paneId: string) => `${STORAGE_KEY_PREFIX}:${paneId}`;

const createQueryWrapper = () => {
  const queryClient = createAppQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const createBranchEntry = (overrides: Partial<BranchListEntry> = {}): BranchListEntry => ({
  name: "feature/a",
  current: false,
  isDefault: false,
  ahead: null,
  behind: null,
  fileChanges: null,
  additions: null,
  deletions: null,
  merged: null,
  pr: null,
  worktreePath: null,
  committedAt: null,
  ...overrides,
});

const createBranchList = (overrides: Partial<BranchList> = {}): BranchList => ({
  repoRoot: "/tmp/repo-a",
  defaultBranch: "main",
  currentBranch: "main",
  entries: [
    createBranchEntry({ name: "main", current: true, isDefault: true }),
    createBranchEntry({ name: "feature/a" }),
  ],
  ...overrides,
});

describe("useSessionVirtualBranch", () => {
  it("selects a virtual branch and persists it to pane-scoped storage", async () => {
    const paneId = "pane-1";
    const branchList = createBranchList();
    const { result } = renderHook(() => useSessionVirtualBranch({ paneId, branchList }));

    act(() => {
      result.current.selectVirtualBranch("feature/a");
    });

    expect(result.current.virtualBranch).toBe("feature/a");
    await waitFor(() => {
      expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain("feature/a");
    });
  });

  it("clears selection when selecting the default branch (no-op selection)", async () => {
    const paneId = "pane-1";
    const branchList = createBranchList({ defaultBranch: "main" });
    const { result } = renderHook(() => useSessionVirtualBranch({ paneId, branchList }));

    act(() => {
      result.current.selectVirtualBranch("feature/a");
    });
    expect(result.current.virtualBranch).toBe("feature/a");

    act(() => {
      result.current.selectVirtualBranch("main");
    });

    expect(result.current.virtualBranch).toBeNull();
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("clears virtual branch and removes stored selection via clearVirtualBranch", async () => {
    const paneId = "pane-1";
    const branchList = createBranchList();
    const { result } = renderHook(() => useSessionVirtualBranch({ paneId, branchList }));

    act(() => {
      result.current.selectVirtualBranch("feature/a");
    });
    await waitFor(() => {
      expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain("feature/a");
    });

    act(() => {
      result.current.clearVirtualBranch();
    });

    expect(result.current.virtualBranch).toBeNull();
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("clears selection automatically when the branch disappears from the list", async () => {
    const paneId = "pane-1";
    const repoRoot = "/tmp/repo-a";
    const { result, rerender } = renderHook(
      ({ branchList }: { branchList: BranchList }) =>
        useSessionVirtualBranch({ paneId, branchList }),
      { initialProps: { branchList: createBranchList({ repoRoot }) } },
    );

    act(() => {
      result.current.selectVirtualBranch("feature/a");
    });
    expect(result.current.virtualBranch).toBe("feature/a");
    await waitFor(() => {
      expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain("feature/a");
    });

    rerender({
      branchList: createBranchList({
        repoRoot,
        entries: [createBranchEntry({ name: "main", current: true, isDefault: true })],
      }),
    });

    await waitFor(() => {
      expect(result.current.virtualBranch).toBeNull();
    });
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();

    rerender({ branchList: createBranchList({ repoRoot }) });

    expect(result.current.virtualBranch).toBeNull();
  });

  it("keeps the selection while the branch list is temporarily empty", async () => {
    const paneId = "pane-1";
    const repoRoot = "/tmp/repo-a";
    const { result, rerender } = renderHook(
      ({ branchList }: { branchList: BranchList }) =>
        useSessionVirtualBranch({ paneId, branchList }),
      { initialProps: { branchList: createBranchList({ repoRoot }) } },
    );

    act(() => {
      result.current.selectVirtualBranch("feature/a");
    });
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain("feature/a");

    rerender({ branchList: createBranchList({ repoRoot, entries: [] }) });

    expect(result.current.virtualBranch).toBe("feature/a");
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toContain("feature/a");
  });

  it("invalidates the selection when it becomes the default branch", async () => {
    const paneId = "pane-1";
    const repoRoot = "/tmp/repo-a";
    const { result, rerender } = renderHook(
      ({ branchList }: { branchList: BranchList }) =>
        useSessionVirtualBranch({ paneId, branchList }),
      { initialProps: { branchList: createBranchList({ repoRoot }) } },
    );

    act(() => {
      result.current.selectVirtualBranch("feature/a");
    });
    rerender({ branchList: createBranchList({ repoRoot, defaultBranch: "feature/a" }) });

    await waitFor(() => {
      expect(result.current.virtualBranch).toBeNull();
    });
    expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
  });

  it("discards stored selection when repoRoot differs from the current branch list", async () => {
    const paneId = "pane-1";
    const staleRepoRoot = "/tmp/repo-old";
    const currentRepoRoot = "/tmp/repo-new";
    window.localStorage.setItem(
      buildStorageKey(paneId),
      JSON.stringify({
        repoRoot: staleRepoRoot,
        branch: "feature/a",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    const branchList = createBranchList({ repoRoot: currentRepoRoot });
    const { result } = renderHook(() => useSessionVirtualBranch({ paneId, branchList }));

    await waitFor(() => {
      expect(window.localStorage.getItem(buildStorageKey(paneId))).toBeNull();
    });
    expect(result.current.virtualBranch).toBeNull();
  });

  it("keeps another pane selection while its branch list is loading", async () => {
    const paneBBranchList = createBranchList({
      repoRoot: "/tmp/repo-b",
      entries: [
        createBranchEntry({ name: "main", current: true, isDefault: true }),
        createBranchEntry({ name: "feature/b" }),
      ],
    });
    window.localStorage.setItem(
      buildStorageKey("pane-b"),
      JSON.stringify({
        repoRoot: paneBBranchList.repoRoot,
        branch: "feature/b",
        updatedAt: new Date(0).toISOString(),
      }),
    );
    let resolvePaneB!: (value: BranchList) => void;
    const paneBRequest = new Promise<BranchList>((resolve) => {
      resolvePaneB = resolve;
    });
    const requestBranches = vi.fn((paneId: string) =>
      paneId === "pane-a" ? Promise.resolve(createBranchList()) : paneBRequest,
    );
    const requestBranchMutation = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ paneId }: { paneId: string }) => {
        const branches = useSessionBranches({
          paneId,
          connected: false,
          session: null,
          requestBranches,
          requestBranchCheckout: requestBranchMutation,
          requestBranchCreate: requestBranchMutation,
          requestBranchDelete: requestBranchMutation,
        });
        return useSessionVirtualBranch({ paneId, branchList: branches.branchList });
      },
      { initialProps: { paneId: "pane-a" }, wrapper: createQueryWrapper() },
    );

    await waitFor(() => {
      expect(requestBranches).toHaveBeenCalledWith("pane-a", undefined, expect.any(AbortSignal));
    });
    rerender({ paneId: "pane-b" });

    expect(window.localStorage.getItem(buildStorageKey("pane-b"))).toContain("feature/b");
    await act(async () => {
      resolvePaneB(paneBBranchList);
      await paneBRequest;
    });
    await waitFor(() => {
      expect(result.current.virtualBranch).toBe("feature/b");
    });
  });
});
