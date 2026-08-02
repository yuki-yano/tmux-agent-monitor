import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDiffSummary } from "../../domain/git/git-diff";
import { runGit } from "../../domain/git/git-utils";
import { resolveRepoBranchCached } from "../../monitor/repo-branch";
import { resolveVwWorktreeSnapshotCached } from "../../monitor/vw-worktree";
import { resolveRequestedWorktreePath, resolveWorktreeListPayload } from "./worktree-utils";

vi.mock("../../domain/git/git-diff", () => ({
  fetchDiffSummary: vi.fn(),
}));

vi.mock("../../domain/git/git-utils", () => ({
  runGit: vi.fn(),
}));

vi.mock("../../monitor/vw-worktree", () => ({
  resolveVwWorktreeSnapshotCached: vi.fn(),
}));

vi.mock("../../monitor/repo-branch", () => ({
  resolveRepoBranchCached: vi.fn(),
}));

describe("worktree-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRepoBranchCached).mockResolvedValue(null);
    vi.mocked(runGit).mockResolvedValue("0\t0");
  });

  it("returns empty entries when vw snapshot is unavailable", async () => {
    vi.mocked(resolveVwWorktreeSnapshotCached).mockResolvedValueOnce(null);

    const payload = await resolveWorktreeListPayload({
      repoRoot: "/repo",
      currentPath: "/repo/worktree-a",
    });

    expect(resolveVwWorktreeSnapshotCached).toHaveBeenCalledWith("/repo", { ghMode: "auto" });
    expect(fetchDiffSummary).not.toHaveBeenCalled();
    expect(payload).toEqual({
      repoRoot: "/repo",
      currentPath: "/repo/worktree-a",
      baseBranch: null,
      entries: [],
    });
  });

  it("adds repo root fallback entry when vw list does not include root", async () => {
    vi.mocked(resolveVwWorktreeSnapshotCached).mockResolvedValueOnce({
      repoRoot: "/repo",
      baseBranch: "main",
      entries: [
        {
          path: "/repo/worktree-a",
          branch: "feature/a",
          dirty: true,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false, byPR: null },
          pr: { status: "none" },
        },
      ],
    });
    vi.mocked(runGit).mockResolvedValueOnce("1\t3");
    vi.mocked(fetchDiffSummary).mockImplementation(async (cwd: string | null) => {
      if (cwd === "/repo/worktree-a") {
        return {
          repoRoot: cwd,
          rev: "rev-a",
          generatedAt: "2026-01-01T00:00:00.000Z",
          files: [
            { path: "a.ts", status: "A", staged: false, additions: 2, deletions: 0 },
            { path: "new.ts", status: "?", staged: false, additions: 4, deletions: 0 },
            { path: "b.ts", status: "D", staged: false, additions: 0, deletions: 1 },
            { path: "c.ts", status: "M", staged: false, additions: 3, deletions: 2 },
          ],
        };
      }
      return {
        repoRoot: cwd,
        rev: "rev-root",
        generatedAt: "2026-01-01T00:00:00.000Z",
        files: [],
      };
    });
    vi.mocked(resolveRepoBranchCached).mockResolvedValueOnce("feature/root");

    const payload = await resolveWorktreeListPayload({
      repoRoot: "/repo",
      currentPath: "/repo/worktree-a",
    });

    expect(payload.entries).toEqual([
      {
        path: "/repo/worktree-a",
        branch: "feature/a",
        dirty: true,
        locked: false,
        lockOwner: null,
        lockReason: null,
        merged: false,
        prStatus: "none",
        ahead: 3,
        behind: 1,
        fileChanges: { add: 2, m: 1, d: 1 },
        additions: 9,
        deletions: 3,
      },
      {
        path: "/repo",
        branch: "feature/root",
        dirty: null,
        locked: null,
        lockOwner: null,
        lockReason: null,
        merged: null,
        prStatus: null,
        ahead: null,
        behind: null,
        fileChanges: { add: 0, m: 0, d: 0 },
        additions: 0,
        deletions: 0,
      },
    ]);
    expect(payload.baseBranch).toBe("main");
    expect(fetchDiffSummary).toHaveBeenCalledTimes(2);
    expect(fetchDiffSummary).toHaveBeenNthCalledWith(1, "/repo/worktree-a", {
      mode: "uncommitted",
    });
    expect(fetchDiffSummary).toHaveBeenNthCalledWith(2, "/repo", { mode: "uncommitted" });
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(runGit).toHaveBeenCalledWith(
      "/repo/worktree-a",
      ["rev-list", "--left-right", "--count", "main...HEAD"],
      { timeoutMs: 2000, maxBuffer: 1_000_000, allowStdoutOnError: false },
    );
    expect(resolveRepoBranchCached).toHaveBeenCalledWith("/repo");
  });

  it("validates worktree path override without diff stats collection", async () => {
    vi.mocked(resolveVwWorktreeSnapshotCached).mockResolvedValueOnce({
      repoRoot: "/repo",
      baseBranch: "main",
      entries: [
        {
          path: "/repo/worktree-a",
          branch: "feature/a",
          dirty: true,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false, byPR: null },
          pr: { status: "unknown" },
        },
      ],
    });

    const resolved = await resolveRequestedWorktreePath({
      detail: { repoRoot: "/repo", currentPath: "/repo/worktree-a" },
      worktreePath: "/repo/worktree-a",
      fallbackPath: "/repo",
    });

    expect(resolved).toEqual({ ok: true, path: "/repo/worktree-a" });
    expect(resolveVwWorktreeSnapshotCached).toHaveBeenCalledWith("/repo", { ghMode: "never" });
    expect(fetchDiffSummary).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
    expect(resolveRepoBranchCached).not.toHaveBeenCalled();
  });

  it("returns fallback path when worktree override is omitted", async () => {
    const resolved = await resolveRequestedWorktreePath({
      detail: { repoRoot: "/repo", currentPath: "/repo/worktree-a" },
      worktreePath: undefined,
      fallbackPath: "/repo",
    });

    expect(resolved).toEqual({ ok: true, path: "/repo" });
    expect(resolveVwWorktreeSnapshotCached).not.toHaveBeenCalled();
  });

  it("returns unavailable reason when worktree snapshot is unavailable", async () => {
    vi.mocked(resolveVwWorktreeSnapshotCached).mockResolvedValueOnce(null);

    const resolved = await resolveRequestedWorktreePath({
      detail: { repoRoot: "/repo", currentPath: "/repo/worktree-a" },
      worktreePath: "/repo/worktree-a",
      fallbackPath: "/repo",
    });

    expect(resolved).toEqual({ ok: false, reason: "worktree_override_unavailable" });
  });

  it("returns invalid reason when override path does not match snapshot entries", async () => {
    vi.mocked(resolveVwWorktreeSnapshotCached).mockResolvedValueOnce({
      repoRoot: "/repo",
      baseBranch: "main",
      entries: [
        {
          path: "/repo/worktree-a",
          branch: "feature/a",
          dirty: true,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false, byPR: null },
          pr: { status: "unknown" },
        },
      ],
    });

    const resolved = await resolveRequestedWorktreePath({
      detail: { repoRoot: "/repo", currentPath: "/repo/worktree-a" },
      worktreePath: "/repo/worktree-b",
      fallbackPath: "/repo",
    });

    expect(resolved).toEqual({ ok: false, reason: "invalid_worktree_path" });
  });

  it("returns normalized worktree path when override is valid", async () => {
    vi.mocked(resolveVwWorktreeSnapshotCached).mockResolvedValueOnce({
      repoRoot: "/repo",
      baseBranch: "main",
      entries: [
        {
          path: "/repo/worktree-a",
          branch: "feature/a",
          dirty: true,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false, byPR: null },
          pr: { status: "unknown" },
        },
      ],
    });

    const resolved = await resolveRequestedWorktreePath({
      detail: { repoRoot: "/repo", currentPath: "/repo/worktree-a" },
      worktreePath: "/repo/worktree-a/",
      fallbackPath: "/repo",
    });

    expect(resolved).toEqual({ ok: true, path: "/repo/worktree-a" });
  });
});
