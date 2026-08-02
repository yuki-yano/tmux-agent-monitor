import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCommitDetail, fetchCommitFile, fetchCommitLog } from "../domain/git/git-commits";
import { fetchDiffSummary } from "../domain/git/git-diff";
import { authHeaders, createTestContext } from "./api-router.test-helpers";

vi.mock("../domain/git/git-diff", () => ({
  fetchDiffSummary: vi.fn(),
  fetchDiffFile: vi.fn(),
}));

vi.mock("../domain/git/git-commits", () => ({
  fetchCommitLog: vi.fn(),
  fetchCommitDetail: vi.fn(),
  fetchCommitFile: vi.fn(),
}));

describe("createApiRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when pane is missing on diff endpoint", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions/missing/diff?mode=total", {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PANE");
  });

  it("returns 400 when diff summary is unavailable", async () => {
    vi.mocked(fetchDiffSummary).mockResolvedValueOnce({
      repoRoot: null,
      rev: null,
      generatedAt: new Date(0).toISOString(),
      files: [],
      reason: "not_git",
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/diff/file?mode=uncommitted&path=README.md", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when commit log is unavailable", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValueOnce({
      repoRoot: null,
      rev: null,
      generatedAt: new Date(0).toISOString(),
      commits: [],
      reason: "not_git",
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/commits/hash", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("uses force=false by default on commit detail endpoint", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValueOnce({
      repoRoot: "/tmp",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
    });
    vi.mocked(fetchCommitDetail).mockResolvedValueOnce({
      hash: "hash",
      shortHash: "hash",
      subject: "subject",
      body: null,
      authorName: "tester",
      authorEmail: "tester@example.com",
      authoredAt: new Date(0).toISOString(),
      files: [],
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/commits/hash", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(fetchCommitDetail).toHaveBeenCalledWith("/tmp", "hash", { force: false });
  });

  it("uses force flag from query on commit file endpoint", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValue({
      repoRoot: "/tmp",
      rev: "HEAD",
      generatedAt: new Date(0).toISOString(),
      commits: [],
    });
    vi.mocked(fetchCommitDetail).mockResolvedValue({
      hash: "hash",
      shortHash: "hash",
      subject: "subject",
      body: null,
      authorName: "tester",
      authorEmail: "tester@example.com",
      authoredAt: new Date(0).toISOString(),
      files: [
        {
          path: "src/index.ts",
          status: "M",
          additions: 1,
          deletions: 0,
        },
      ],
    });
    vi.mocked(fetchCommitFile).mockResolvedValue({
      path: "src/index.ts",
      status: "M",
      patch: "+line",
      binary: false,
      truncated: false,
    });

    const { api } = createTestContext();
    const first = await api.request("/sessions/pane-1/commits/hash/file?path=src/index.ts", {
      headers: authHeaders,
    });
    expect(first.status).toBe(200);
    expect(fetchCommitFile).toHaveBeenLastCalledWith(
      "/tmp",
      "hash",
      expect.objectContaining({ path: "src/index.ts" }),
      { force: false },
    );

    const second = await api.request(
      "/sessions/pane-1/commits/hash/file?path=src/index.ts&force=1",
      {
        headers: authHeaders,
      },
    );
    expect(second.status).toBe(200);
    expect(fetchCommitFile).toHaveBeenLastCalledWith(
      "/tmp",
      "hash",
      expect.objectContaining({ path: "src/index.ts" }),
      { force: true },
    );
  });

  it("returns 400 when commit log is unavailable on commit file endpoint", async () => {
    vi.mocked(fetchCommitLog).mockResolvedValueOnce({
      repoRoot: null,
      rev: null,
      generatedAt: new Date(0).toISOString(),
      commits: [],
      reason: "not_git",
    });
    const { api } = createTestContext();
    const res = await api.request("/sessions/pane-1/commits/hash/file?path=README.md", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });
});
