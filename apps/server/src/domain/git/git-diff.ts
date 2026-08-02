import crypto from "node:crypto";
import path from "node:path";

import type {
  DiffFile,
  DiffFileStatus,
  DiffMode,
  DiffSummary,
  DiffSummaryFile,
} from "@vde-monitor/shared";

import { setMapEntryWithLimit } from "../../cache";
import { nowIso } from "../../utils/time";
import { parseBranchNameStatus } from "./git-branch-diff";
import { resolveDefaultBranch } from "./git-branches";
import { GIT_CACHE_TTL_MS, GIT_PATCH_MAX_BYTES, truncateTextByLength } from "./git-common";
import {
  type NumstatCounts,
  isBinaryPatch,
  parseNumstat,
  parseNumstatLine,
  pickStatus,
} from "./git-parsers";
import { resolveGitHead, resolveGitRepoContext, shouldReuseGitCache } from "./git-query-context";
import { runGit } from "./git-utils";

const SUMMARY_CACHE_MAX_ENTRIES = 200;
const FILE_CACHE_MAX_ENTRIES = 500;

const summaryCache = new Map<string, { at: number; summary: DiffSummary }>();
const fileCache = new Map<string, { at: number; rev: string; file: DiffFile }>();

const createRevision = (...parts: string[]) =>
  crypto.createHash("sha1").update(parts.join("\0")).digest("hex");

export const clearDiffCachesForRepo = (repoRoot: string) => {
  for (const key of summaryCache.keys()) {
    if (key.startsWith(`${repoRoot}:`)) {
      summaryCache.delete(key);
    }
  }
  for (const key of fileCache.keys()) {
    if (key.startsWith(`${repoRoot}:`)) {
      fileCache.delete(key);
    }
  }
};

type ParsedStatusToken = {
  statusCode: string;
  rawPath: string;
  xStatus: string;
  yStatus: string;
};

const parseStatusToken = (token: string): ParsedStatusToken | null => {
  if (token.length < 3) {
    return null;
  }
  const statusCode = token.slice(0, 2);
  if (statusCode === "!!") {
    return null;
  }
  const rawPath = token.length > 3 ? token.slice(3) : "";
  if (!rawPath) {
    return null;
  }
  return {
    statusCode,
    rawPath,
    xStatus: statusCode[0] ?? " ",
    yStatus: statusCode[1] ?? " ",
  };
};

const hasRenameStatus = (xStatus: string, yStatus: string) =>
  xStatus === "R" || xStatus === "C" || yStatus === "R" || yStatus === "C";

const resolvePathInfo = (
  tokens: string[],
  index: number,
  token: ParsedStatusToken,
): { path: string; renamedFrom?: string; nextIndex: number } => {
  if (!hasRenameStatus(token.xStatus, token.yStatus)) {
    return { path: token.rawPath, nextIndex: index };
  }
  const nextPath = tokens[index + 1];
  if (!nextPath) {
    return { path: token.rawPath, nextIndex: index };
  }
  return { path: token.rawPath, renamedFrom: nextPath, nextIndex: index + 1 };
};

const resolveFileStatus = (token: ParsedStatusToken): DiffFileStatus => {
  if (token.statusCode === "??") {
    return "?";
  }
  if (token.xStatus !== " ") {
    return pickStatus(token.xStatus);
  }
  return pickStatus(token.yStatus);
};

export const parseGitStatus = (statusOutput: string) => {
  if (!statusOutput) {
    return [];
  }
  const tokens = statusOutput.split("\0").filter((token) => token.length > 0);
  const files: DiffSummaryFile[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = parseStatusToken(tokens[i] ?? "");
    if (!token) {
      continue;
    }
    const pathInfo = resolvePathInfo(tokens, i, token);
    i = pathInfo.nextIndex;
    files.push({
      path: pathInfo.path,
      status: resolveFileStatus(token),
      staged: token.xStatus !== " " && token.xStatus !== "?",
      renamedFrom: pathInfo.renamedFrom,
    });
  }
  return files;
};

const resolveSafePath = (repoRoot: string, filePath: string) => {
  const resolved = path.resolve(repoRoot, filePath);
  const normalizedRoot = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  if (!resolved.startsWith(normalizedRoot)) {
    return null;
  }
  return resolved;
};

const buildDiffSummary = (
  repoRoot: string,
  rev: string | null,
  files: DiffSummary["files"],
  reason?: DiffSummary["reason"],
): DiffSummary => ({
  repoRoot,
  rev,
  generatedAt: nowIso(),
  files,
  reason,
});

const buildUnknownSummary = (reason: "cwd_unknown" | "not_git"): DiffSummary => ({
  repoRoot: null,
  rev: null,
  generatedAt: nowIso(),
  files: [],
  reason,
});

const getCachedSummary = (cacheKey: string, force: boolean | undefined, nowMs: number) => {
  const cached = summaryCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (
    !shouldReuseGitCache({
      force,
      cachedAt: cached.at,
      nowMs,
      ttlMs: GIT_CACHE_TTL_MS,
    })
  ) {
    return null;
  }
  return cached.summary;
};

type ComparedDiffTarget = {
  baseBranch: string;
  mergeBase: string;
  head: string;
};

type ComparedDiffTargetResult =
  | { ok: true; target: ComparedDiffTarget }
  | { ok: false; reason: "default_branch_unavailable" | "error" };

const resolveComparedDiffTarget = async (repoRoot: string): Promise<ComparedDiffTargetResult> => {
  const baseBranch = await resolveDefaultBranch(repoRoot);
  if (baseBranch == null) {
    return { ok: false, reason: "default_branch_unavailable" };
  }
  try {
    const [mergeBaseOutput, head] = await Promise.all([
      runGit(repoRoot, ["merge-base", baseBranch, "HEAD"], { allowStdoutOnError: false }),
      resolveGitHead(repoRoot),
    ]);
    const mergeBase = mergeBaseOutput.trim();
    if (!mergeBase || head == null) {
      return { ok: false, reason: "error" };
    }
    return { ok: true, target: { baseBranch, mergeBase, head } };
  } catch {
    return { ok: false, reason: "error" };
  }
};

const fetchUntrackedNumstat = async (
  repoRoot: string,
  filePath: string,
): Promise<NumstatCounts | null> => {
  const safePath = resolveSafePath(repoRoot, filePath);
  if (!safePath) {
    return null;
  }
  const output = await runGit(repoRoot, [
    "diff",
    "--no-index",
    "--numstat",
    "--",
    "/dev/null",
    safePath,
  ]);
  return parseNumstatLine(output);
};

const collectUntrackedStats = async (repoRoot: string, files: DiffSummaryFile[]) => {
  const untrackedFiles = files.filter((file) => file.status === "?");
  if (untrackedFiles.length === 0) {
    return new Map<string, NumstatCounts>();
  }
  const resolved = await Promise.all(
    untrackedFiles.map(async (file) => {
      const parsed = await fetchUntrackedNumstat(repoRoot, file.path);
      return parsed ? ({ path: file.path, parsed } as const) : null;
    }),
  );
  const untrackedStats = new Map<string, NumstatCounts>();
  resolved.forEach((item) => {
    if (!item) {
      return;
    }
    untrackedStats.set(item.path, item.parsed);
  });
  return untrackedStats;
};

const attachFileStats = (
  files: DiffSummaryFile[],
  trackedStats: Map<string, NumstatCounts>,
  untrackedStats: Map<string, NumstatCounts>,
) =>
  files.map((file) => {
    const stat = file.status === "?" ? untrackedStats.get(file.path) : trackedStats.get(file.path);
    return {
      ...file,
      additions: stat?.additions ?? null,
      deletions: stat?.deletions ?? null,
    };
  });

const buildEmptyDiffFile = (file: DiffSummaryFile, rev: string): DiffFile => ({
  path: file.path,
  status: file.status,
  patch: null,
  binary: false,
  truncated: false,
  rev,
});

const getCachedDiffFile = (
  cacheKey: string,
  force: boolean | undefined,
  nowMs: number,
): DiffFile | null => {
  const cached = fileCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (
    !shouldReuseGitCache({
      force,
      cachedAt: cached.at,
      nowMs,
      ttlMs: GIT_CACHE_TTL_MS,
    })
  ) {
    return null;
  }
  return cached.file;
};

const fetchPatchForUntrackedFile = async (repoRoot: string, safePath: string) => {
  const [patch, numstatOutput] = await Promise.all([
    runGit(repoRoot, ["diff", "--no-index", "--", "/dev/null", safePath]),
    runGit(repoRoot, ["diff", "--no-index", "--numstat", "--", "/dev/null", safePath]),
  ]);
  return { patch, numstat: parseNumstatLine(numstatOutput) };
};

const fetchPatchForTrackedFile = async (
  repoRoot: string,
  file: DiffSummaryFile,
  diffSpecifier: string,
) => {
  const pathArgs = file.renamedFrom ? [file.renamedFrom, file.path] : [file.path];
  const [patch, numstatOutput] = await Promise.all([
    runGit(repoRoot, ["diff", "--find-renames", diffSpecifier, "--", ...pathArgs]),
    runGit(repoRoot, ["diff", "--find-renames", diffSpecifier, "--numstat", "--", ...pathArgs]),
  ]);
  return { patch, numstat: parseNumstatLine(numstatOutput) };
};

const fetchPatchData = async (
  repoRoot: string,
  file: DiffSummaryFile,
  safePath: string,
  diffSpecifier: string,
) => {
  if (file.status === "?") {
    return fetchPatchForUntrackedFile(repoRoot, safePath);
  }
  return fetchPatchForTrackedFile(repoRoot, file, diffSpecifier);
};

const buildDiffFileFromPatch = (
  file: DiffSummaryFile,
  rev: string,
  patch: string,
  numstat: NumstatCounts | null,
): DiffFile => {
  const truncatedPatch = truncateTextByLength({
    text: patch,
    maxLength: GIT_PATCH_MAX_BYTES,
  });
  const binary = isBinaryPatch(patch) || numstat?.additions == null || numstat?.deletions == null;
  return {
    path: file.path,
    status: file.status,
    patch: truncatedPatch.text.length > 0 ? truncatedPatch.text : null,
    binary,
    truncated: truncatedPatch.truncated,
    rev,
  };
};

const fetchUncommittedDiffSummary = async (
  repoRoot: string,
  nowMs: number,
): Promise<DiffSummary> => {
  const [statusOutput, numstatOutput] = await Promise.all([
    runGit(repoRoot, ["status", "--porcelain", "-z", "--untracked-files=all"]),
    runGit(repoRoot, ["diff", "HEAD", "--numstat", "-z", "--"]),
  ]);
  const files = parseGitStatus(statusOutput);
  const trackedStats = parseNumstat(numstatOutput);
  const untrackedStats = await collectUntrackedStats(repoRoot, files);
  const withStats = attachFileStats(files, trackedStats, untrackedStats);
  const summary = buildDiffSummary(
    repoRoot,
    createRevision("uncommitted", statusOutput, numstatOutput),
    withStats,
  );
  setMapEntryWithLimit(
    summaryCache,
    `${repoRoot}:uncommitted`,
    { at: nowMs, summary },
    SUMMARY_CACHE_MAX_ENTRIES,
  );
  return summary;
};

const fetchComparedDiffSummary = async (
  repoRoot: string,
  mode: "total" | "committed",
  target: ComparedDiffTarget,
  nowMs: number,
): Promise<DiffSummary> => {
  const diffSpecifier = mode === "committed" ? `${target.baseBranch}...HEAD` : target.mergeBase;
  const statusPromise =
    mode === "total"
      ? runGit(repoRoot, ["status", "--porcelain", "-z", "--untracked-files=all"])
      : Promise.resolve("");
  const [statusOutput, nameStatusOutput, numstatOutput] = await Promise.all([
    statusPromise,
    runGit(repoRoot, ["diff", "--name-status", "-z", "--find-renames", diffSpecifier]),
    runGit(repoRoot, ["diff", diffSpecifier, "--numstat", "-z", "--"]),
  ]);
  const trackedFiles = parseBranchNameStatus(nameStatusOutput);
  const untrackedFiles =
    mode === "total" ? parseGitStatus(statusOutput).filter((file) => file.status === "?") : [];
  const files = [...trackedFiles, ...untrackedFiles];
  const trackedStats = parseNumstat(numstatOutput);
  const untrackedStats = await collectUntrackedStats(repoRoot, untrackedFiles);
  const withStats = attachFileStats(files, trackedStats, untrackedStats);
  const summary = buildDiffSummary(
    repoRoot,
    createRevision(mode, target.mergeBase, target.head, statusOutput, numstatOutput),
    withStats,
  );
  setMapEntryWithLimit(
    summaryCache,
    `${repoRoot}:${mode}`,
    { at: nowMs, summary },
    SUMMARY_CACHE_MAX_ENTRIES,
  );
  return summary;
};

export const fetchDiffSummary = async (
  cwd: string | null,
  options: { mode: DiffMode; force?: boolean },
): Promise<DiffSummary> => {
  const context = await resolveGitRepoContext(cwd);
  if (context.reason) {
    return buildUnknownSummary(context.reason);
  }
  const repoRoot = context.repoRoot;
  const nowMs = Date.now();
  const cached = getCachedSummary(`${repoRoot}:${options.mode}`, options.force, nowMs);
  if (cached) {
    return cached;
  }
  try {
    if (options.mode === "uncommitted") {
      return await fetchUncommittedDiffSummary(repoRoot, nowMs);
    }
    const targetResult = await resolveComparedDiffTarget(repoRoot);
    if (!targetResult.ok) {
      return buildDiffSummary(repoRoot, null, [], targetResult.reason);
    }
    return await fetchComparedDiffSummary(repoRoot, options.mode, targetResult.target, nowMs);
  } catch {
    return buildDiffSummary(repoRoot, null, [], "error");
  }
};

export const fetchDiffFile = async (
  repoRoot: string,
  file: DiffSummaryFile,
  rev: string,
  options: { mode: DiffMode; force?: boolean },
): Promise<DiffFile> => {
  const cacheKey = `${repoRoot}:${options.mode}:${file.path}:${rev}`;
  const nowMs = Date.now();
  const cached = getCachedDiffFile(cacheKey, options?.force, nowMs);
  if (cached) {
    return cached;
  }
  const safePath = resolveSafePath(repoRoot, file.path);
  if (!safePath) {
    return buildEmptyDiffFile(file, rev);
  }
  let patch = "";
  let numstat: NumstatCounts | null = null;
  try {
    let diffSpecifier = "HEAD";
    if (options.mode !== "uncommitted") {
      const targetResult = await resolveComparedDiffTarget(repoRoot);
      if (!targetResult.ok) {
        return buildEmptyDiffFile(file, rev);
      }
      diffSpecifier =
        options.mode === "committed"
          ? `${targetResult.target.baseBranch}...HEAD`
          : targetResult.target.mergeBase;
    }
    const patchData = await fetchPatchData(repoRoot, file, safePath, diffSpecifier);
    patch = patchData.patch;
    numstat = patchData.numstat;
  } catch {
    patch = "";
  }
  const diffFile = buildDiffFileFromPatch(file, rev, patch, numstat);
  setMapEntryWithLimit(
    fileCache,
    cacheKey,
    { at: nowMs, rev, file: diffFile },
    FILE_CACHE_MAX_ENTRIES,
  );
  return diffFile;
};
