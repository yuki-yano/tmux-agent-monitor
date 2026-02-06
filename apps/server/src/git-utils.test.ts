import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";

import { resolveRepoRoot, runGit } from "./git-utils.js";

describe("runGit", () => {
  it("returns stdout on success", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: "ok\n" } as never);

    const result = await runGit("/tmp/repo", ["status", "--short"]);

    expect(result).toBe("ok\n");
    expect(execa).toHaveBeenCalledWith("git", ["-C", "/tmp/repo", "status", "--short"], {
      timeout: 5000,
      maxBuffer: 20_000_000,
    });
  });

  it("returns stdout from execa error by default", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ stdout: "partial\n" });

    const result = await runGit("/tmp/repo", ["log"]);

    expect(result).toBe("partial\n");
  });

  it("throws when allowStdoutOnError is false", async () => {
    const err = new Error("failed");
    vi.mocked(execa).mockRejectedValueOnce(err);

    await expect(runGit("/tmp/repo", ["log"], { allowStdoutOnError: false })).rejects.toThrowError(
      "failed",
    );
  });
});

describe("resolveRepoRoot", () => {
  it("returns trimmed root path", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: "/tmp/repo \n" } as never);

    const root = await resolveRepoRoot("/tmp/repo");

    expect(root).toBe("/tmp/repo");
  });

  it("returns null when git command fails", async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error("not a repo"));

    const root = await resolveRepoRoot("/tmp/not-repo");

    expect(root).toBeNull();
  });
});
