import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import type {
  DiffFile,
  DiffFileStatus,
  DiffSummary,
  DiffSummaryFile,
} from "@tmux-agent-monitor/shared";

const execFileAsync = promisify(execFile);

const SUMMARY_TTL_MS = 3000;
const FILE_TTL_MS = 3000;
const MAX_PATCH_BYTES = 2_000_000;
const MAX_OUTPUT_BUFFER = 20_000_000;

const nowIso = () => new Date().toISOString();

const summaryCache = new Map<string, { at: number; summary: DiffSummary; statusOutput: string }>();
const fileCache = new Map<string, { at: number; rev: string; file: DiffFile }>();

const createRevision = (statusOutput: string) =>
  crypto.createHash("sha1").update(statusOutput).digest("hex");

const runGit = async (cwd: string, args: string[]) => {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });
    return result.stdout ?? "";
  } catch (err) {
    if (err && typeof err === "object" && "stdout" in err) {
      const stdout = (err as { stdout?: string }).stdout;
      return stdout ?? "";
    }
    throw err;
  }
};

const resolveRepoRoot = async (cwd: string) => {
  try {
    const output = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

const pickStatus = (value: string) => {
  const allowed: DiffFileStatus[] = ["A", "M", "D", "R", "C", "U", "?"];
  return allowed.includes(value as DiffFileStatus) ? (value as DiffFileStatus) : "?";
};

const parseNumstat = (output: string) => {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>();
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const addRaw = parts[0] ?? "";
    const delRaw = parts[1] ?? "";
    const pathValue = parts[parts.length - 1] ?? "";
    const additions = addRaw === "-" ? null : Number.parseInt(addRaw, 10);
    const deletions = delRaw === "-" ? null : Number.parseInt(delRaw, 10);
    stats.set(pathValue, {
      additions: Number.isFinite(additions) ? additions : null,
      deletions: Number.isFinite(deletions) ? deletions : null,
    });
  }
  return stats;
};

const parseNumstatLine = (output: string) => {
  const line = output
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!line) {
    return null;
  }
  const parts = line.split("\t");
  if (parts.length < 2) {
    return null;
  }
  const addRaw = parts[0] ?? "";
  const delRaw = parts[1] ?? "";
  const additions = addRaw === "-" ? null : Number.parseInt(addRaw, 10);
  const deletions = delRaw === "-" ? null : Number.parseInt(delRaw, 10);
  return {
    additions: Number.isFinite(additions) ? additions : null,
    deletions: Number.isFinite(deletions) ? deletions : null,
  };
};

export const parseGitStatus = (statusOutput: string) => {
  if (!statusOutput) {
    return [];
  }
  const tokens = statusOutput.split("\0").filter((token) => token.length > 0);
  const files: DiffSummaryFile[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (token.length < 3) {
      continue;
    }
    const statusCode = token.slice(0, 2);
    if (statusCode === "!!") {
      continue;
    }
    const rawPath = token.length > 3 ? token.slice(3) : "";
    if (!rawPath) {
      continue;
    }
    let pathValue = rawPath;
    let renamedFrom: string | undefined;
    const xStatus = statusCode[0] ?? " ";
    const yStatus = statusCode[1] ?? " ";
    const hasRename = xStatus === "R" || xStatus === "C" || yStatus === "R" || yStatus === "C";
    if (hasRename && tokens[i + 1]) {
      renamedFrom = rawPath;
      pathValue = tokens[i + 1] ?? rawPath;
      i += 1;
    }
    const staged = xStatus !== " " && xStatus !== "?";
    let status: DiffFileStatus;
    if (statusCode === "??") {
      status = "?";
    } else if (xStatus !== " ") {
      status = pickStatus(xStatus);
    } else {
      status = pickStatus(yStatus);
    }
    files.push({ path: pathValue, status, staged, renamedFrom });
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

export const fetchDiffSummary = async (
  cwd: string | null,
  options?: { force?: boolean },
): Promise<DiffSummary> => {
  if (!cwd) {
    return {
      repoRoot: null,
      rev: null,
      generatedAt: nowIso(),
      files: [],
      reason: "cwd_unknown",
    };
  }
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) {
    return {
      repoRoot: null,
      rev: null,
      generatedAt: nowIso(),
      files: [],
      reason: "not_git",
    };
  }
  const cached = summaryCache.get(repoRoot);
  const nowMs = Date.now();
  if (!options?.force && cached && nowMs - cached.at < SUMMARY_TTL_MS) {
    return cached.summary;
  }
  try {
    const statusOutput = await runGit(repoRoot, ["status", "--porcelain", "-z"]);
    const files = parseGitStatus(statusOutput);
    const numstatOutput = await runGit(repoRoot, ["diff", "HEAD", "--numstat", "--"]);
    const stats = parseNumstat(numstatOutput);
    const untrackedStats = new Map<
      string,
      { additions: number | null; deletions: number | null }
    >();
    for (const file of files) {
      if (file.status !== "?") continue;
      const safePath = resolveSafePath(repoRoot, file.path);
      if (!safePath) continue;
      const output = await runGit(repoRoot, [
        "diff",
        "--no-index",
        "--numstat",
        "--",
        "/dev/null",
        safePath,
      ]);
      const parsed = parseNumstatLine(output);
      if (parsed) {
        untrackedStats.set(file.path, parsed);
      }
    }
    const withStats = files.map((file) => {
      const stat = file.status === "?" ? untrackedStats.get(file.path) : stats.get(file.path);
      return {
        ...file,
        additions: stat?.additions ?? null,
        deletions: stat?.deletions ?? null,
      };
    });
    const rev = createRevision(statusOutput);
    const summary: DiffSummary = {
      repoRoot,
      rev,
      generatedAt: nowIso(),
      files: withStats,
    };
    summaryCache.set(repoRoot, { at: nowMs, summary, statusOutput });
    return summary;
  } catch {
    return {
      repoRoot,
      rev: null,
      generatedAt: nowIso(),
      files: [],
      reason: "error",
    };
  }
};

const isBinaryPatch = (patch: string) =>
  patch.includes("Binary files ") ||
  patch.includes("GIT binary patch") ||
  patch.includes("literal ");

export const fetchDiffFile = async (
  repoRoot: string,
  file: DiffSummaryFile,
  rev: string,
  options?: { force?: boolean },
): Promise<DiffFile> => {
  const cacheKey = `${repoRoot}:${file.path}:${rev}`;
  const cached = fileCache.get(cacheKey);
  const nowMs = Date.now();
  if (!options?.force && cached && nowMs - cached.at < FILE_TTL_MS) {
    return cached.file;
  }
  const safePath = resolveSafePath(repoRoot, file.path);
  if (!safePath) {
    return {
      path: file.path,
      status: file.status,
      patch: null,
      binary: false,
      truncated: false,
      rev,
    };
  }
  let patch = "";
  let numstat = null as { additions: number | null; deletions: number | null } | null;
  try {
    if (file.status === "?") {
      patch = await runGit(repoRoot, ["diff", "--no-index", "--", "/dev/null", safePath]);
      const numstatOutput = await runGit(repoRoot, [
        "diff",
        "--no-index",
        "--numstat",
        "--",
        "/dev/null",
        safePath,
      ]);
      numstat = parseNumstatLine(numstatOutput);
    } else {
      patch = await runGit(repoRoot, ["diff", "HEAD", "--", file.path]);
      const numstatOutput = await runGit(repoRoot, ["diff", "HEAD", "--numstat", "--", file.path]);
      numstat = parseNumstatLine(numstatOutput);
    }
  } catch {
    patch = "";
  }
  const binary = isBinaryPatch(patch) || numstat?.additions === null || numstat?.deletions === null;
  let truncated = false;
  if (patch.length > MAX_PATCH_BYTES) {
    truncated = true;
    patch = patch.slice(0, MAX_PATCH_BYTES);
  }
  const diffFile: DiffFile = {
    path: file.path,
    status: file.status,
    patch: patch.length > 0 ? patch : null,
    binary,
    truncated,
    rev,
  };
  fileCache.set(cacheKey, { at: nowMs, rev, file: diffFile });
  return diffFile;
};
