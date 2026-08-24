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

  it("captures every diff-file response dimension", () => {
    const params = {
      repoRoot: "/repo/a",
      worktreePath: "/repo/worktree-a",
      branch: null,
      mode: "total" as const,
      revision: "rev-1",
      summarySnapshot: "snapshot-1",
      path: "src/index.ts",
    };
    const key = sessionDetailQueryKeys.diffFile("pane-1", params);

    expect(key).toEqual(["session-detail", "pane-1", "diff-file", params]);
    expect(key).not.toEqual(sessionDetailQueryKeys.diffFile("pane-2", params));
    for (const changed of [
      { repoRoot: "/repo/b" },
      { worktreePath: "/repo/worktree-b" },
      { branch: "feature/a", mode: "committed" as const },
      { mode: "uncommitted" as const },
      { revision: "rev-2" },
      { summarySnapshot: "snapshot-2" },
      { path: "src/other.ts" },
    ]) {
      expect(key).not.toEqual(sessionDetailQueryKeys.diffFile("pane-1", { ...params, ...changed }));
    }
    expect(key.slice(0, -1)).toEqual(sessionDetailQueryKeys.diffFileRoot("pane-1"));
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

  it("separates commit head, revision-fixed tail, detail, and file resources", () => {
    const scope = {
      repoRoot: "/repo/a",
      worktreePath: "/repo/worktree-a",
      branch: null,
    };
    const head = sessionDetailQueryKeys.commitLogHead("pane-1", { ...scope, limit: 10 });
    const tail = sessionDetailQueryKeys.commitLogTail("pane-1", {
      ...scope,
      expectedRev: "rev-1",
      headSnapshot: "snapshot-1",
      limit: 10,
    });
    const detail = sessionDetailQueryKeys.commitDetail("pane-1", { ...scope, hash: "abc123" });
    const file = sessionDetailQueryKeys.commitFile("pane-1", {
      ...scope,
      hash: "abc123",
      path: "src/index.ts",
    });

    expect(head).toEqual([
      "session-detail",
      "pane-1",
      "commits",
      "log",
      "head",
      { ...scope, limit: 10 },
    ]);
    expect(tail).not.toEqual(head);
    expect(tail).not.toEqual(
      sessionDetailQueryKeys.commitLogTail("pane-1", {
        ...scope,
        expectedRev: "rev-1",
        headSnapshot: "snapshot-2",
        limit: 10,
      }),
    );
    expect(detail).not.toEqual(file);
    expect(head.slice(0, 3)).toEqual(sessionDetailQueryKeys.commitsRoot("pane-1"));
    expect(head.slice(0, 4)).toEqual(sessionDetailQueryKeys.commitLogRoot("pane-1"));
  });
});
