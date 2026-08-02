import type { CommitLog, DiffFile, DiffSummary, SessionDetail } from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchBranchDiffFile,
  fetchBranchDiffSummary,
  resolveBranchDiffScope,
} from "../../domain/git/git-branch-diff";
import { fetchCommitLog } from "../../domain/git/git-commits";
import { fetchDiffFile, fetchDiffSummary } from "../../domain/git/git-diff";
import { createGitRoutes } from "./git-routes";
import type { RouteContext } from "./types";

vi.mock("../../domain/git/git-branch-diff", () => ({
  fetchBranchDiffFile: vi.fn(),
  fetchBranchDiffSummary: vi.fn(),
  resolveBranchDiffScope: vi.fn(),
}));

vi.mock("../../domain/git/git-commits", () => ({
  fetchCommitDetail: vi.fn(),
  fetchCommitFile: vi.fn(),
  fetchCommitLog: vi.fn(),
}));

vi.mock("../../domain/git/git-diff", () => ({
  fetchDiffFile: vi.fn(),
  fetchDiffSummary: vi.fn(),
}));

const buildPane = (overrides: Partial<SessionDetail> = {}): SessionDetail => ({
  paneId: "%13",
  sessionId: "$1",
  sessionName: "dev",
  windowId: "@1",
  windowIndex: 1,
  paneIndex: 0,
  paneActive: true,
  currentCommand: "claude",
  currentPath: "/repo",
  paneTty: "/dev/ttys001",
  title: null,
  customTitle: null,
  repoRoot: "/repo",
  branch: "main",
  worktreePath: "/repo",
  agent: "claude",
  state: "RUNNING",
  stateReason: "running",
  lastMessage: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: null,
  lastRunStartedAt: null,
  manualSortAt: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: true,
  pipeConflict: false,
  startCommand: "claude",
  panePid: 123,
  agentSessionId: "claude-session-1",
  completion: null,
  ...overrides,
});

const buildDiffSummary = (overrides: Partial<DiffSummary> = {}): DiffSummary => ({
  repoRoot: "/repo",
  rev: "deadbeef",
  generatedAt: "2026-01-01T00:00:00.000Z",
  files: [{ path: "a.txt", status: "M", staged: false, additions: 1, deletions: 0 }],
  ...overrides,
});

const buildCommitLog = (overrides: Partial<CommitLog> = {}): CommitLog => ({
  repoRoot: "/repo",
  rev: "deadbeef",
  generatedAt: "2026-01-01T00:00:00.000Z",
  commits: [],
  ...overrides,
});

const buildDiffFile = (overrides: Partial<DiffFile> = {}): DiffFile => ({
  path: "a.txt",
  status: "M",
  patch: "diff",
  binary: false,
  rev: "deadbeef",
  ...overrides,
});

describe("createGitRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const buildApp = (detail: SessionDetail | Response = buildPane()) => {
    const resolvePane = vi.fn((_c: RouteContext) =>
      detail instanceof Response ? detail : { paneId: "%13", detail },
    );
    const app = createGitRoutes({ resolvePane });
    return { app, resolvePane };
  };

  describe("GET /diff", () => {
    it("requires an explicit diff mode", async () => {
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/diff");

      expect(res.status).toBe(400);
      expect(fetchDiffSummary).not.toHaveBeenCalled();
    });

    it("rejects non-committed mode for a branch comparison", async () => {
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/diff?mode=total&branch=feature/x");

      expect(res.status).toBe(400);
      expect(resolveBranchDiffScope).not.toHaveBeenCalled();
    });

    it("returns 400 when branch and worktreePath are both provided", async () => {
      const { app } = buildApp();

      const res = await app.request(
        "/sessions/%13/diff?mode=committed&branch=feature/x&worktreePath=/other",
      );

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error).toEqual({
        code: "INVALID_PAYLOAD",
        message: "branch and worktreePath are exclusive",
      });
      expect(resolveBranchDiffScope).not.toHaveBeenCalled();
      expect(fetchBranchDiffSummary).not.toHaveBeenCalled();
    });

    it("returns the branch diff summary from fetchBranchDiffSummary", async () => {
      vi.mocked(resolveBranchDiffScope).mockResolvedValueOnce({
        ok: true,
        scope: { repoRoot: "/repo", baseBranch: "main", branch: "feature/x" },
      });
      const summary = buildDiffSummary();
      vi.mocked(fetchBranchDiffSummary).mockResolvedValueOnce(summary);
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/diff?mode=committed&branch=feature/x");

      expect(res.status).toBe(200);
      const json = (await res.json()) as { summary: DiffSummary };
      expect(json.summary).toEqual(summary);
      expect(resolveBranchDiffScope).toHaveBeenCalledWith("/repo", "feature/x");
      expect(fetchBranchDiffSummary).toHaveBeenCalledWith(
        { repoRoot: "/repo", baseBranch: "main", branch: "feature/x" },
        { force: false },
      );
      expect(fetchDiffSummary).not.toHaveBeenCalled();
    });

    it("returns 400 when the branch scope cannot be resolved", async () => {
      vi.mocked(resolveBranchDiffScope).mockResolvedValueOnce({
        ok: false,
        reason: "unknown_branch",
      });
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/diff?mode=committed&branch=missing");

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("INVALID_PAYLOAD");
      expect(json.error.message).toContain("unknown_branch");
      expect(fetchBranchDiffSummary).not.toHaveBeenCalled();
    });

    it("returns the requested worktree diff layer when branch is absent", async () => {
      const summary = buildDiffSummary();
      vi.mocked(fetchDiffSummary).mockResolvedValueOnce(summary);
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/diff?mode=total");

      expect(res.status).toBe(200);
      const json = (await res.json()) as { summary: DiffSummary };
      expect(json.summary).toEqual(summary);
      expect(fetchDiffSummary).toHaveBeenCalledWith("/repo", { force: false, mode: "total" });
      expect(resolveBranchDiffScope).not.toHaveBeenCalled();
    });
  });

  describe("GET /diff/file", () => {
    it("returns 400 when branch and worktreePath are both provided", async () => {
      const { app } = buildApp();

      const res = await app.request(
        "/sessions/%13/diff/file?mode=committed&branch=feature/x&worktreePath=/other&path=a.txt",
      );

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("INVALID_PAYLOAD");
      expect(fetchBranchDiffFile).not.toHaveBeenCalled();
    });

    it("returns the branch diff file for a matching path", async () => {
      vi.mocked(resolveBranchDiffScope).mockResolvedValueOnce({
        ok: true,
        scope: { repoRoot: "/repo", baseBranch: "main", branch: "feature/x" },
      });
      const summary = buildDiffSummary();
      vi.mocked(fetchBranchDiffSummary).mockResolvedValueOnce(summary);
      const file = buildDiffFile();
      vi.mocked(fetchBranchDiffFile).mockResolvedValueOnce(file);
      const { app } = buildApp();

      const res = await app.request(
        "/sessions/%13/diff/file?mode=committed&branch=feature/x&path=a.txt",
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as { file: DiffFile };
      expect(json.file).toEqual(file);
      expect(fetchBranchDiffFile).toHaveBeenCalledWith(
        { repoRoot: "/repo", baseBranch: "main", branch: "feature/x" },
        summary.files[0],
        "deadbeef",
        { force: false },
      );
    });

    it("returns 404 when the file is not part of the branch diff", async () => {
      vi.mocked(resolveBranchDiffScope).mockResolvedValueOnce({
        ok: true,
        scope: { repoRoot: "/repo", baseBranch: "main", branch: "feature/x" },
      });
      vi.mocked(fetchBranchDiffSummary).mockResolvedValueOnce(buildDiffSummary());
      const { app } = buildApp();

      const res = await app.request(
        "/sessions/%13/diff/file?mode=committed&branch=feature/x&path=missing.txt",
      );

      expect(res.status).toBe(404);
      expect(fetchBranchDiffFile).not.toHaveBeenCalled();
    });

    it("returns a file from the requested worktree diff layer", async () => {
      const summary = buildDiffSummary();
      const file = buildDiffFile();
      vi.mocked(fetchDiffSummary).mockResolvedValueOnce(summary);
      vi.mocked(fetchDiffFile).mockResolvedValueOnce(file);
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/diff/file?mode=total&path=a.txt");

      expect(res.status).toBe(200);
      expect(fetchDiffSummary).toHaveBeenCalledWith("/repo", { force: false, mode: "total" });
      expect(fetchDiffFile).toHaveBeenCalledWith("/repo", summary.files[0], "deadbeef", {
        force: false,
        mode: "total",
      });
    });
  });

  describe("GET /commits", () => {
    it("passes the branch range through to fetchCommitLog", async () => {
      vi.mocked(resolveBranchDiffScope).mockResolvedValueOnce({
        ok: true,
        scope: { repoRoot: "/repo", baseBranch: "main", branch: "feature/x" },
      });
      const log = buildCommitLog();
      vi.mocked(fetchCommitLog).mockResolvedValueOnce(log);
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/commits?branch=feature/x&limit=5&skip=1");

      expect(res.status).toBe(200);
      const json = (await res.json()) as { log: CommitLog };
      expect(json.log).toEqual(log);
      expect(fetchCommitLog).toHaveBeenCalledWith("/repo", {
        limit: 5,
        skip: 1,
        force: false,
        range: { base: "main", branch: "feature/x" },
      });
    });

    it("returns 400 when branch and worktreePath are both provided", async () => {
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/commits?branch=feature/x&worktreePath=/other");

      expect(res.status).toBe(400);
      expect(fetchCommitLog).not.toHaveBeenCalled();
    });

    it("falls back to the default commit log when branch is absent", async () => {
      const log = buildCommitLog();
      vi.mocked(fetchCommitLog).mockResolvedValueOnce(log);
      const { app } = buildApp();

      const res = await app.request("/sessions/%13/commits");

      expect(res.status).toBe(200);
      const json = (await res.json()) as { log: CommitLog };
      expect(json.log).toEqual(log);
      expect(fetchCommitLog).toHaveBeenCalledWith("/repo", { limit: 10, skip: 0, force: false });
      expect(resolveBranchDiffScope).not.toHaveBeenCalled();
    });
  });
});
