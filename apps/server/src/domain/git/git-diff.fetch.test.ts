import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runGit: vi.fn(),
  resolveRepoRoot: vi.fn(),
  resolveDefaultBranch: vi.fn(),
}));

vi.mock("./git-utils", () => ({
  runGit: mocks.runGit,
  resolveRepoRoot: mocks.resolveRepoRoot,
}));

vi.mock("./git-branches", () => ({
  resolveDefaultBranch: mocks.resolveDefaultBranch,
}));

import { fetchDiffFile, fetchDiffSummary } from "./git-diff";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

afterEach(() => {
  vi.clearAllMocks();
});

const flushMicrotasks = async (count = 4) => {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
};

describe("fetchDiffFile", () => {
  it("requests tracked patch and numstat in parallel", async () => {
    const patch = deferred<string>();
    const numstat = deferred<string>();

    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      if (args.join(" ") === "diff --find-renames HEAD -- src/main.ts") {
        return patch.promise;
      }
      if (args.join(" ") === "diff --find-renames HEAD --numstat -- src/main.ts") {
        return numstat.promise;
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    });

    const request = fetchDiffFile(
      "/repo",
      {
        path: "src/main.ts",
        status: "M",
        staged: false,
      },
      "rev-1",
      { force: true, mode: "uncommitted" },
    );

    await flushMicrotasks();
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--find-renames",
      "HEAD",
      "--",
      "src/main.ts",
    ]);
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--find-renames",
      "HEAD",
      "--numstat",
      "--",
      "src/main.ts",
    ]);

    patch.resolve("diff --git a/src/main.ts b/src/main.ts\n+hello\n");
    numstat.resolve("1\t0\tsrc/main.ts\n");

    const file = await request;
    expect(file.path).toBe("src/main.ts");
    expect(file.binary).toBe(false);
    expect(file.rev).toBe("rev-1");
  });

  it("uses the merge base directly for a total worktree patch", async () => {
    mocks.resolveDefaultBranch.mockResolvedValue("main");
    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      const command = args.join(" ");
      if (command === "merge-base main HEAD") return Promise.resolve("base-sha\n");
      if (command === "rev-parse HEAD") return Promise.resolve("head-sha\n");
      if (command === "diff --find-renames base-sha -- src/main.ts") {
        return Promise.resolve("diff --git a/src/main.ts b/src/main.ts\n+total\n");
      }
      if (command === "diff --find-renames base-sha --numstat -- src/main.ts") {
        return Promise.resolve("1\t0\tsrc/main.ts\n");
      }
      throw new Error(`unexpected args: ${command}`);
    });

    const file = await fetchDiffFile(
      "/repo",
      { path: "src/main.ts", status: "M", staged: false },
      "rev-total",
      { force: true, mode: "total" },
    );

    expect(file.patch).toContain("+total");
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--find-renames",
      "base-sha",
      "--",
      "src/main.ts",
    ]);
  });

  it("requests both paths for a renamed file patch", async () => {
    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      const command = args.join(" ");
      if (command === "diff --find-renames HEAD -- old.ts new.ts") {
        return Promise.resolve("diff --git a/old.ts b/new.ts\nsimilarity index 100%\n");
      }
      if (command === "diff --find-renames HEAD --numstat -- old.ts new.ts") {
        return Promise.resolve("0\t0\told.ts => new.ts\n");
      }
      throw new Error(`unexpected args: ${command}`);
    });

    const file = await fetchDiffFile(
      "/repo",
      { path: "new.ts", renamedFrom: "old.ts", status: "R", staged: true },
      "rev-rename",
      { force: true, mode: "uncommitted" },
    );

    expect(file.patch).toContain("similarity index 100%");
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--find-renames",
      "HEAD",
      "--",
      "old.ts",
      "new.ts",
    ]);
  });
});

describe("fetchDiffSummary", () => {
  it("collects untracked numstat in parallel", async () => {
    const untrackedA = deferred<string>();
    const untrackedB = deferred<string>();

    mocks.resolveRepoRoot.mockResolvedValue("/repo");
    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      if (args.join(" ") === "status --porcelain -z --untracked-files=all") {
        return Promise.resolve(["?? alpha.txt", "?? beta.txt", ""].join("\0"));
      }
      if (args.join(" ") === "diff HEAD --numstat -z --") {
        return Promise.resolve("");
      }
      if (args.join(" ") === "diff --no-index --numstat -- /dev/null /repo/alpha.txt") {
        return untrackedA.promise;
      }
      if (args.join(" ") === "diff --no-index --numstat -- /dev/null /repo/beta.txt") {
        return untrackedB.promise;
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    });

    const summaryPromise = fetchDiffSummary("/repo", { force: true, mode: "uncommitted" });

    await flushMicrotasks();
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", ["diff", "HEAD", "--numstat", "-z", "--"]);
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--no-index",
      "--numstat",
      "--",
      "/dev/null",
      "/repo/alpha.txt",
    ]);
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--no-index",
      "--numstat",
      "--",
      "/dev/null",
      "/repo/beta.txt",
    ]);

    untrackedA.resolve("1\t0\t/repo/alpha.txt\n");
    untrackedB.resolve("2\t0\t/repo/beta.txt\n");

    const summary = await summaryPromise;
    expect(summary.files).toEqual([
      {
        path: "alpha.txt",
        status: "?",
        staged: false,
        additions: 1,
        deletions: 0,
      },
      {
        path: "beta.txt",
        status: "?",
        staged: false,
        additions: 2,
        deletions: 0,
      },
    ]);
  });

  it("calculates total changes directly from merge base to the working tree", async () => {
    mocks.resolveRepoRoot.mockResolvedValue("/repo");
    mocks.resolveDefaultBranch.mockResolvedValue("main");
    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      const command = args.join(" ");
      if (command === "merge-base main HEAD") return Promise.resolve("base-sha\n");
      if (command === "rev-parse HEAD") return Promise.resolve("head-sha\n");
      if (command === "status --porcelain -z --untracked-files=all") {
        return Promise.resolve([" M src/tracked.ts", "?? notes.txt", ""].join("\0"));
      }
      if (command === "diff --name-status -z --find-renames base-sha") {
        return Promise.resolve(
          ["M", "src/tracked.ts", "R100", "src/old.ts", "src/new.ts", ""].join("\0"),
        );
      }
      if (command === "diff base-sha --numstat -z --") {
        return Promise.resolve(
          ["3\t1\tsrc/tracked.ts", "2\t1\t", "src/old.ts", "src/new.ts", ""].join("\0"),
        );
      }
      if (command === "diff --no-index --numstat -- /dev/null /repo/notes.txt") {
        return Promise.resolve("2\t0\t/repo/notes.txt\n");
      }
      throw new Error(`unexpected args: ${command}`);
    });

    const summary = await fetchDiffSummary("/repo", { force: true, mode: "total" });

    expect(summary.files).toEqual([
      {
        path: "src/tracked.ts",
        status: "M",
        staged: false,
        renamedFrom: undefined,
        additions: 3,
        deletions: 1,
      },
      {
        path: "src/new.ts",
        status: "R",
        staged: false,
        renamedFrom: "src/old.ts",
        additions: 2,
        deletions: 1,
      },
      {
        path: "notes.txt",
        status: "?",
        staged: false,
        additions: 2,
        deletions: 0,
      },
    ]);
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      "base-sha",
    ]);
  });

  it("keeps committed mode limited to the base-to-HEAD range", async () => {
    mocks.resolveRepoRoot.mockResolvedValue("/repo");
    mocks.resolveDefaultBranch.mockResolvedValue("main");
    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      const command = args.join(" ");
      if (command === "merge-base main HEAD") return Promise.resolve("base-sha\n");
      if (command === "rev-parse HEAD") return Promise.resolve("head-sha\n");
      if (command === "diff --name-status -z --find-renames main...HEAD") {
        return Promise.resolve(["A", "committed.ts", ""].join("\0"));
      }
      if (command === "diff main...HEAD --numstat -z --") {
        return Promise.resolve("4\t0\tcommitted.ts\0");
      }
      throw new Error(`unexpected args: ${command}`);
    });

    const summary = await fetchDiffSummary("/repo", { force: true, mode: "committed" });

    expect(summary.files).toEqual([
      {
        path: "committed.ts",
        status: "A",
        staged: false,
        renamedFrom: undefined,
        additions: 4,
        deletions: 0,
      },
    ]);
    expect(mocks.runGit).not.toHaveBeenCalledWith("/repo", [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
    ]);
  });

  it("reports when a compared layer has no resolvable default branch", async () => {
    mocks.resolveRepoRoot.mockResolvedValue("/repo");
    mocks.resolveDefaultBranch.mockResolvedValue(null);

    const summary = await fetchDiffSummary("/repo", { force: true, mode: "total" });

    expect(summary).toMatchObject({
      repoRoot: "/repo",
      rev: null,
      files: [],
      reason: "default_branch_unavailable",
    });
    expect(mocks.runGit).not.toHaveBeenCalled();
  });
});
