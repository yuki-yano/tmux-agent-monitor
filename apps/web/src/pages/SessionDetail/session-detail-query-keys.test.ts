import { describe, expect, it } from "vitest";

import { sessionDetailQueryKeys } from "./session-detail-query-keys";

describe("sessionDetailQueryKeys", () => {
  it("separates pane and repository scoped resources", () => {
    expect(sessionDetailQueryKeys.branches("pane-1", "/repo/a")).not.toEqual(
      sessionDetailQueryKeys.branches("pane-2", "/repo/a"),
    );
    expect(sessionDetailQueryKeys.branches("pane-1", "/repo/a")).not.toEqual(
      sessionDetailQueryKeys.branches("pane-1", "/repo/b"),
    );
  });

  it("keeps force refresh out of the response identity", () => {
    const key = sessionDetailQueryKeys.branches("pane-1", "/repo/a");

    expect(key).toEqual(["session-detail", "pane-1", "branches", { repoRoot: "/repo/a" }]);
  });

  it("captures every timeline response dimension", () => {
    expect(
      sessionDetailQueryKeys.timeline("pane-1", {
        repoRoot: "/repo/a",
        scope: "repo",
        range: "24h",
        limit: 200,
      }),
    ).not.toEqual(
      sessionDetailQueryKeys.timeline("pane-1", {
        repoRoot: "/repo/a",
        scope: "repo",
        range: "24h",
        limit: 100,
      }),
    );
  });

  it("captures diff mode, worktree, and virtual branch scope", () => {
    const worktreeKey = sessionDetailQueryKeys.diffSummary("pane-1", {
      repoRoot: "/repo/a",
      mode: "total",
      worktreePath: "/repo/worktree-a",
      branch: null,
    });
    const branchKey = sessionDetailQueryKeys.diffSummary("pane-1", {
      repoRoot: "/repo/a",
      mode: "committed",
      worktreePath: null,
      branch: "feature/a",
    });

    expect(worktreeKey).not.toEqual(branchKey);
  });

  it("separates timeline and diff data when a pane changes repositories", () => {
    const timelineScope = { scope: "pane", range: "1h" } as const;
    const diffScope = { mode: "total", worktreePath: null, branch: null } as const;

    expect(
      sessionDetailQueryKeys.timeline("pane-1", { repoRoot: "/repo/a", ...timelineScope }),
    ).not.toEqual(
      sessionDetailQueryKeys.timeline("pane-1", { repoRoot: "/repo/b", ...timelineScope }),
    );
    expect(
      sessionDetailQueryKeys.diffSummary("pane-1", { repoRoot: "/repo/a", ...diffScope }),
    ).not.toEqual(
      sessionDetailQueryKeys.diffSummary("pane-1", { repoRoot: "/repo/b", ...diffScope }),
    );
  });

  it("provides resource prefixes for targeted invalidation", () => {
    const branchKey = sessionDetailQueryKeys.branches("pane-1", "/repo/a");

    expect(branchKey.slice(0, -1)).toEqual(sessionDetailQueryKeys.branchesRoot("pane-1"));
  });
});
