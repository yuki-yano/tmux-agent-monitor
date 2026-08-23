import { describe, expect, it, vi } from "vitest";

const resolveRepoRootMock = vi.fn();

vi.mock("../domain/git/git-utils", () => ({
  resolveRepoRoot: resolveRepoRootMock,
}));

const loadModule = async () => {
  vi.resetModules();
  resolveRepoRootMock.mockReset();
  return import("./repo-root");
};

describe("resolveRepoRootCached", () => {
  it("returns null for missing cwd", async () => {
    const { resolveRepoRootCached } = await loadModule();
    const result = await resolveRepoRootCached(null);
    expect(result).toBeNull();
    expect(resolveRepoRootMock).not.toHaveBeenCalled();
  });

  it("caches by normalized path", async () => {
    const { resolveRepoRootCached } = await loadModule();
    resolveRepoRootMock.mockResolvedValue("/repo");
    const first = await resolveRepoRootCached("/repo/");
    const second = await resolveRepoRootCached("/repo");
    expect(first).toBe("/repo");
    expect(second).toBe("/repo");
    expect(resolveRepoRootMock).toHaveBeenCalledTimes(1);
  });

  it("does not expire a positive repository root", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { resolveRepoRootCached } = await loadModule();
      resolveRepoRootMock.mockResolvedValue("/repo");
      await resolveRepoRootCached("/repo");

      vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
      const result = await resolveRepoRootCached("/repo");

      expect(result).toBe("/repo");
      expect(resolveRepoRootMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a negative repository root after ten seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { resolveRepoRootCached } = await loadModule();
      resolveRepoRootMock.mockResolvedValueOnce(null).mockResolvedValueOnce("/repo");
      await resolveRepoRootCached("/repo");

      vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
      const result = await resolveRepoRootCached("/repo");

      expect(result).toBe("/repo");
      expect(resolveRepoRootMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
