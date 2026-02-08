import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runGit: vi.fn(),
  resolveRepoRoot: vi.fn(),
}));

vi.mock("./git-utils", () => ({
  runGit: mocks.runGit,
  resolveRepoRoot: mocks.resolveRepoRoot,
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
      if (args.join(" ") === "diff HEAD -- src/main.ts") {
        return patch.promise;
      }
      if (args.join(" ") === "diff HEAD --numstat -- src/main.ts") {
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
      { force: true },
    );

    await flushMicrotasks();
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", ["diff", "HEAD", "--", "src/main.ts"]);
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", [
      "diff",
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
});

describe("fetchDiffSummary", () => {
  it("collects untracked numstat in parallel", async () => {
    const untrackedA = deferred<string>();
    const untrackedB = deferred<string>();

    mocks.resolveRepoRoot.mockResolvedValue("/repo");
    mocks.runGit.mockImplementation((_cwd: string, args: string[]) => {
      if (args.join(" ") === "status --porcelain -z") {
        return Promise.resolve(["?? alpha.txt", "?? beta.txt", ""].join("\0"));
      }
      if (args.join(" ") === "diff HEAD --numstat --") {
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

    const summaryPromise = fetchDiffSummary("/repo", { force: true });

    await flushMicrotasks();
    expect(mocks.runGit).toHaveBeenCalledWith("/repo", ["diff", "HEAD", "--numstat", "--"]);
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
});
