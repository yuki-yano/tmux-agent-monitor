import { zValidator } from "@hono/zod-validator";
import type { DiffMode, SessionDetail } from "@vde-monitor/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
  fetchBranchDiffFile,
  fetchBranchDiffSummary,
  resolveBranchDiffScope,
} from "../../domain/git/git-branch-diff";
import type { BranchDiffScope } from "../../domain/git/git-branch-diff";
import { fetchCommitDetail, fetchCommitFile, fetchCommitLog } from "../../domain/git/git-commits";
import { fetchDiffFile, fetchDiffSummary } from "../../domain/git/git-diff";
import { buildError } from "../helpers";
import { resolveRequestedPath } from "./route-helpers";
import type { GitRouteDeps, RouteContext } from "./types";

type DiffSummaryResult = Awaited<ReturnType<typeof fetchDiffSummary>>;
type CommitLogResult = Awaited<ReturnType<typeof fetchCommitLog>>;

const forceQuerySchema = z.object({
  force: z.string().optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
});
const diffModeSchema = z.enum(["total", "committed", "uncommitted"]);
const diffQuerySchema = forceQuerySchema.extend({
  mode: diffModeSchema,
});
const diffFileQuerySchema = diffQuerySchema.extend({
  path: z.string(),
  rev: z.string().optional(),
});
const commitLogQuerySchema = z.object({
  limit: z.string().optional(),
  skip: z.string().optional(),
  force: z.string().optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
});
const commitDetailQuerySchema = z.object({
  force: z.string().optional(),
  worktreePath: z.string().optional(),
});
const commitFileQuerySchema = z.object({
  path: z.string(),
  force: z.string().optional(),
  worktreePath: z.string().optional(),
});

const isForceRequested = (force?: string) => force === "1";

const parseQueryInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveHash = (c: RouteContext): string | Response => {
  const hash = c.req.param("hash");
  if (!hash) {
    return c.json({ error: buildError("INVALID_PAYLOAD", "missing hash") }, 400);
  }
  return hash;
};

const resolveRequestedCwd = async (
  c: RouteContext,
  detail: SessionDetail,
  worktreePath: string | undefined,
): Promise<Response | string | null> =>
  resolveRequestedPath(c, detail, worktreePath, detail.currentPath);

const resolveBranchScopeOrError = async (
  c: RouteContext,
  detail: SessionDetail,
  branch: string,
  worktreePath: string | undefined,
): Promise<Response | BranchDiffScope> => {
  if (worktreePath) {
    return c.json(
      { error: buildError("INVALID_PAYLOAD", "branch and worktreePath are exclusive") },
      400,
    );
  }
  const resolved = await resolveBranchDiffScope(detail.currentPath ?? detail.repoRoot, branch);
  if (!resolved.ok) {
    return c.json(
      { error: buildError("INVALID_PAYLOAD", `branch scope: ${resolved.reason}`) },
      400,
    );
  }
  return resolved.scope;
};

const loadReadyDiffSummary = async (
  c: RouteContext,
  cwd: string | null,
  force: boolean,
  mode: DiffMode,
): Promise<Response | { summary: DiffSummaryResult; repoRoot: string; rev: string }> => {
  const summary = await fetchDiffSummary(cwd, { force, mode });
  if (!summary.repoRoot || summary.reason || !summary.rev) {
    return c.json({ error: buildError("INVALID_PAYLOAD", "diff summary unavailable") }, 400);
  }
  return {
    summary,
    repoRoot: summary.repoRoot,
    rev: summary.rev,
  };
};

const loadReadyCommitLog = async (
  c: RouteContext,
  cwd: string | null,
): Promise<Response | { log: CommitLogResult; repoRoot: string }> => {
  const log = await fetchCommitLog(cwd, { limit: 1, skip: 0 });
  if (!log.repoRoot || log.reason) {
    return c.json({ error: buildError("INVALID_PAYLOAD", "commit log unavailable") }, 400);
  }
  return {
    log,
    repoRoot: log.repoRoot,
  };
};

export const createGitRoutes = ({ resolvePane }: GitRouteDeps) =>
  new Hono()
    .get("/sessions/:paneId/diff", zValidator("query", diffQuerySchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const query = c.req.valid("query");
      const force = isForceRequested(query.force);
      if (query.branch) {
        if (query.mode !== "committed") {
          return c.json(
            { error: buildError("INVALID_PAYLOAD", "branch diff mode must be committed") },
            400,
          );
        }
        const scope = await resolveBranchScopeOrError(
          c,
          pane.detail,
          query.branch,
          query.worktreePath,
        );
        if (scope instanceof Response) {
          return scope;
        }
        const summary = await fetchBranchDiffSummary(scope, { force });
        return c.json({ summary });
      }
      const cwd = await resolveRequestedCwd(c, pane.detail, query.worktreePath);
      if (cwd instanceof Response) {
        return cwd;
      }
      const summary = await fetchDiffSummary(cwd, { force, mode: query.mode });
      return c.json({ summary });
    })
    .get("/sessions/:paneId/diff/file", zValidator("query", diffFileQuerySchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const query = c.req.valid("query");
      const pathParam = query.path;
      const force = isForceRequested(query.force);
      if (query.branch) {
        if (query.mode !== "committed") {
          return c.json(
            { error: buildError("INVALID_PAYLOAD", "branch diff mode must be committed") },
            400,
          );
        }
        const scope = await resolveBranchScopeOrError(
          c,
          pane.detail,
          query.branch,
          query.worktreePath,
        );
        if (scope instanceof Response) {
          return scope;
        }
        const summary = await fetchBranchDiffSummary(scope, { force });
        if (!summary.rev || summary.reason) {
          return c.json({ error: buildError("INVALID_PAYLOAD", "diff summary unavailable") }, 400);
        }
        const target = summary.files.find((file) => file.path === pathParam);
        if (!target) {
          return c.json({ error: buildError("NOT_FOUND", "file not found") }, 404);
        }
        const file = await fetchBranchDiffFile(scope, target, summary.rev, { force });
        return c.json({ file });
      }
      const cwd = await resolveRequestedCwd(c, pane.detail, query.worktreePath);
      if (cwd instanceof Response) {
        return cwd;
      }
      const readySummary = await loadReadyDiffSummary(c, cwd, force, query.mode);
      if (readySummary instanceof Response) {
        return readySummary;
      }
      const target = readySummary.summary.files.find((file) => file.path === pathParam);
      if (!target) {
        return c.json({ error: buildError("NOT_FOUND", "file not found") }, 404);
      }
      const file = await fetchDiffFile(readySummary.repoRoot, target, readySummary.rev, {
        force,
        mode: query.mode,
      });
      return c.json({ file });
    })
    .get("/sessions/:paneId/commits", zValidator("query", commitLogQuerySchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const query = c.req.valid("query");
      const limit = parseQueryInteger(query.limit, 10);
      const skip = parseQueryInteger(query.skip, 0);
      const force = isForceRequested(query.force);
      if (query.branch) {
        const scope = await resolveBranchScopeOrError(
          c,
          pane.detail,
          query.branch,
          query.worktreePath,
        );
        if (scope instanceof Response) {
          return scope;
        }
        const log = await fetchCommitLog(scope.repoRoot, {
          limit,
          skip,
          force,
          range: { base: scope.baseBranch, branch: scope.branch },
        });
        return c.json({ log });
      }
      const cwd = await resolveRequestedCwd(c, pane.detail, query.worktreePath);
      if (cwd instanceof Response) {
        return cwd;
      }
      const log = await fetchCommitLog(cwd, {
        limit,
        skip,
        force,
      });
      return c.json({ log });
    })
    .get(
      "/sessions/:paneId/commits/:hash",
      zValidator("query", commitDetailQuerySchema),
      async (c) => {
        const pane = resolvePane(c);
        if (pane instanceof Response) {
          return pane;
        }
        const hash = resolveHash(c);
        if (hash instanceof Response) {
          return hash;
        }
        const query = c.req.valid("query");
        const cwd = await resolveRequestedCwd(c, pane.detail, query.worktreePath);
        if (cwd instanceof Response) {
          return cwd;
        }
        const readyCommitLog = await loadReadyCommitLog(c, cwd);
        if (readyCommitLog instanceof Response) {
          return readyCommitLog;
        }
        const commit = await fetchCommitDetail(readyCommitLog.repoRoot, hash, {
          force: isForceRequested(query.force),
        });
        if (!commit) {
          return c.json({ error: buildError("NOT_FOUND", "commit not found") }, 404);
        }
        return c.json({ commit });
      },
    )
    .get(
      "/sessions/:paneId/commits/:hash/file",
      zValidator("query", commitFileQuerySchema),
      async (c) => {
        const pane = resolvePane(c);
        if (pane instanceof Response) {
          return pane;
        }
        const hash = resolveHash(c);
        if (hash instanceof Response) {
          return hash;
        }
        const query = c.req.valid("query");
        const pathParam = query.path;
        const cwd = await resolveRequestedCwd(c, pane.detail, query.worktreePath);
        if (cwd instanceof Response) {
          return cwd;
        }
        const readyCommitLog = await loadReadyCommitLog(c, cwd);
        if (readyCommitLog instanceof Response) {
          return readyCommitLog;
        }
        const commit = await fetchCommitDetail(readyCommitLog.repoRoot, hash, {
          force: isForceRequested(query.force),
        });
        if (!commit) {
          return c.json({ error: buildError("NOT_FOUND", "commit not found") }, 404);
        }
        const target =
          commit.files.find((file) => file.path === pathParam) ??
          commit.files.find((file) => file.renamedFrom === pathParam);
        if (!target) {
          return c.json({ error: buildError("NOT_FOUND", "file not found") }, 404);
        }
        const file = await fetchCommitFile(readyCommitLog.repoRoot, hash, target, {
          force: isForceRequested(query.force),
        });
        return c.json({ file });
      },
    );
