import crypto from "node:crypto";
import path from "node:path";

import type { DiffFile, DiffFileStatus, DiffSummary, DiffSummaryFile } from "@vde-monitor/shared";

import { setMapEntryWithLimit } from "./cache";
import { isBinaryPatch, parseNumstat, parseNumstatLine, pickStatus } from "./git-parsers";
import { resolveRepoRoot, runGit } from "./git-utils";

const SUMMARY_TTL_MS = 3000;
const FILE_TTL_MS = 3000;
const MAX_PATCH_BYTES = 2_000_000;
const SUMMARY_CACHE_MAX_ENTRIES = 200;
const FILE_CACHE_MAX_ENTRIES = 500;

const nowIso = () => new Date().toISOString();

const summaryCache = new Map<string, { at: number; summary: DiffSummary; statusOutput: string }>();
const fileCache = new Map<string, { at: number; rev: string; file: DiffFile }>();

const createRevision = (statusOutput: string) =>
  crypto.createHash("sha1").update(statusOutput).digest("hex");

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
  return { path: nextPath, renamedFrom: token.rawPath, nextIndex: index + 1 };
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

type NumstatResult = { additions: number | null; deletions: number | null };

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

const getCachedSummary = (repoRoot: string, force: boolean | undefined, nowMs: number) => {
  const cached = summaryCache.get(repoRoot);
  if (force || !cached) {
    return null;
  }
  return nowMs - cached.at < SUMMARY_TTL_MS ? cached.summary : null;
};

const fetchUntrackedNumstat = async (
  repoRoot: string,
  filePath: string,
): Promise<NumstatResult | null> => {
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
  const untrackedStats = new Map<string, NumstatResult>();
  for (const file of files) {
    if (file.status !== "?") {
      continue;
    }
    const parsed = await fetchUntrackedNumstat(repoRoot, file.path);
    if (parsed) {
      untrackedStats.set(file.path, parsed);
    }
  }
  return untrackedStats;
};

const attachFileStats = (
  files: DiffSummaryFile[],
  trackedStats: Map<string, NumstatResult>,
  untrackedStats: Map<string, NumstatResult>,
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
  if (force || !cached) {
    return null;
  }
  return nowMs - cached.at < FILE_TTL_MS ? cached.file : null;
};

const fetchPatchForUntrackedFile = async (repoRoot: string, safePath: string) => {
  const patch = await runGit(repoRoot, ["diff", "--no-index", "--", "/dev/null", safePath]);
  const numstatOutput = await runGit(repoRoot, [
    "diff",
    "--no-index",
    "--numstat",
    "--",
    "/dev/null",
    safePath,
  ]);
  return { patch, numstat: parseNumstatLine(numstatOutput) };
};

const fetchPatchForTrackedFile = async (repoRoot: string, filePath: string) => {
  const patch = await runGit(repoRoot, ["diff", "HEAD", "--", filePath]);
  const numstatOutput = await runGit(repoRoot, ["diff", "HEAD", "--numstat", "--", filePath]);
  return { patch, numstat: parseNumstatLine(numstatOutput) };
};

const fetchPatchData = async (repoRoot: string, file: DiffSummaryFile, safePath: string) => {
  if (file.status === "?") {
    return fetchPatchForUntrackedFile(repoRoot, safePath);
  }
  return fetchPatchForTrackedFile(repoRoot, file.path);
};

const truncatePatch = (patch: string) => {
  if (patch.length <= MAX_PATCH_BYTES) {
    return { patch, truncated: false };
  }
  return { patch: patch.slice(0, MAX_PATCH_BYTES), truncated: true };
};

const buildDiffFileFromPatch = (
  file: DiffSummaryFile,
  rev: string,
  patch: string,
  numstat: NumstatResult | null,
): DiffFile => {
  const truncatedPatch = truncatePatch(patch);
  const binary = isBinaryPatch(patch) || numstat?.additions == null || numstat?.deletions == null;
  return {
    path: file.path,
    status: file.status,
    patch: truncatedPatch.patch.length > 0 ? truncatedPatch.patch : null,
    binary,
    truncated: truncatedPatch.truncated,
    rev,
  };
};

export const fetchDiffSummary = async (
  cwd: string | null,
  options?: { force?: boolean },
): Promise<DiffSummary> => {
  if (!cwd) {
    return buildUnknownSummary("cwd_unknown");
  }
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) {
    return buildUnknownSummary("not_git");
  }
  const nowMs = Date.now();
  const cached = getCachedSummary(repoRoot, options?.force, nowMs);
  if (cached) {
    return cached;
  }
  try {
    const statusOutput = await runGit(repoRoot, ["status", "--porcelain", "-z"]);
    const files = parseGitStatus(statusOutput);
    const numstatOutput = await runGit(repoRoot, ["diff", "HEAD", "--numstat", "--"]);
    const trackedStats = parseNumstat(numstatOutput);
    const untrackedStats = await collectUntrackedStats(repoRoot, files);
    const withStats = attachFileStats(files, trackedStats, untrackedStats);
    const summary = buildDiffSummary(repoRoot, createRevision(statusOutput), withStats);
    setMapEntryWithLimit(
      summaryCache,
      repoRoot,
      { at: nowMs, summary, statusOutput },
      SUMMARY_CACHE_MAX_ENTRIES,
    );
    return summary;
  } catch {
    return buildDiffSummary(repoRoot, null, [], "error");
  }
};

export const fetchDiffFile = async (
  repoRoot: string,
  file: DiffSummaryFile,
  rev: string,
  options?: { force?: boolean },
): Promise<DiffFile> => {
  const cacheKey = `${repoRoot}:${file.path}:${rev}`;
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
  let numstat: NumstatResult | null = null;
  try {
    const patchData = await fetchPatchData(repoRoot, file, safePath);
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
