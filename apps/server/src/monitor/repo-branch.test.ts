import { describe, expect, it, vi } from "vitest";

const runGitMock = vi.fn();

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve } as Deferred<T>;
};

vi.mock("../domain/git/git-utils", () => ({
  runGit: runGitMock,
}));

const loadModule = async () => {
  vi.resetModules();
  runGitMock.mockReset();
  return import("./repo-branch");
};

describe("resolveRepoBranchCached", () => {
  it("returns null for missing cwd", async () => {
    const { resolveRepoBranchCached } = await loadModule();
    const result = await resolveRepoBranchCached(null);
    expect(result).toBeNull();
    expect(runGitMock).not.toHaveBeenCalled();
  });

  it("caches by normalized path", async () => {
    const { resolveRepoBranchCached } = await loadModule();
    runGitMock.mockResolvedValue("main\n");
    const first = await resolveRepoBranchCached("/repo/");
    const second = await resolveRepoBranchCached("/repo");
    expect(first).toBe("main");
    expect(second).toBe("main");
    expect(runGitMock).toHaveBeenCalledTimes(1);
    expect(runGitMock).toHaveBeenCalledWith(
      "/repo",
      ["branch", "--show-current"],
      expect.objectContaining({
        timeoutMs: 2000,
        maxBuffer: 2_000_000,
        allowStdoutOnError: false,
      }),
    );
  });

  it("normalizes trailing backslashes in cache key", async () => {
    const { resolveRepoBranchCached } = await loadModule();
    runGitMock.mockResolvedValue("main\n");

    const first = await resolveRepoBranchCached("C:\\repo\\");
    const second = await resolveRepoBranchCached("C:\\repo");

    expect(first).toBe("main");
    expect(second).toBe("main");
    expect(runGitMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent lookups with inflight cache", async () => {
    const { resolveRepoBranchCached } = await loadModule();
    const deferred = createDeferred<string>();
    runGitMock.mockReturnValueOnce(deferred.promise);

    const firstPromise = resolveRepoBranchCached("/repo");
    const secondPromise = resolveRepoBranchCached("/repo/");
    await Promise.resolve();

    expect(runGitMock).toHaveBeenCalledTimes(1);

    deferred.resolve("feature/inflight\n");
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBe("feature/inflight");
    expect(second).toBe("feature/inflight");
    expect(runGitMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when git command fails", async () => {
    const { resolveRepoBranchCached } = await loadModule();
    runGitMock.mockRejectedValue(new Error("not git repo"));
    const result = await resolveRepoBranchCached("/not-repo");
    expect(result).toBeNull();
  });
});
