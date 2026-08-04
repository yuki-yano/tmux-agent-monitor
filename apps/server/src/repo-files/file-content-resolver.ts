import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { RepoFileContent, RepoFileLanguageHint } from "@vde-monitor/shared";

import { resolveSafeRepoPath } from "./repo-path-resolver";
import { createServiceError, isNotFoundError, isReadablePermissionError } from "./service-context";

const BINARY_SAMPLE_BYTES = 8_192;

const readFileSlice = async ({
  fileHandle,
  byteLength,
}: {
  fileHandle: fs.FileHandle;
  byteLength: number;
}) => {
  if (byteLength <= 0) {
    return Buffer.alloc(0);
  }

  const buffer = Buffer.alloc(byteLength);
  const { bytesRead } = await fileHandle.read(buffer, 0, byteLength, 0);
  return buffer.subarray(0, bytesRead);
};

const isPathInside = (rootPath: string, targetPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const containsGitMetadataSegment = (rootPath: string, targetPath: string) =>
  path
    .relative(rootPath, targetPath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase() === ".git");

const isSameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
) => left.dev === right.dev && left.ino === right.ino;

const openVerifiedFile = async ({
  absolutePath,
  allowedRootPath,
}: {
  absolutePath: string;
  allowedRootPath: string;
}) => {
  let fileHandle: fs.FileHandle | null = null;
  try {
    fileHandle = await fs.open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const handleStats = await fileHandle.stat();
    if (!handleStats.isFile()) {
      throw createServiceError("INVALID_PAYLOAD", 400, "path must point to a file");
    }

    const canonicalRoot = allowedRootPath;
    const canonicalTarget = await fs.realpath(absolutePath);
    if (
      !isPathInside(canonicalRoot, canonicalTarget) ||
      containsGitMetadataSegment(canonicalRoot, canonicalTarget)
    ) {
      throw createServiceError("FORBIDDEN_PATH", 403, "path is outside the allowed file root");
    }
    const pathStats = await fs.stat(canonicalTarget);
    if (!isSameFile(handleStats, pathStats)) {
      throw createServiceError("FORBIDDEN_PATH", 403, "file changed while it was being opened");
    }
    return { fileHandle, stats: handleStats };
  } catch (error) {
    await fileHandle?.close();
    if (isReadablePermissionError(error)) {
      throw createServiceError("PERMISSION_DENIED", 403, "permission denied");
    }
    if (isNotFoundError(error)) {
      throw createServiceError("NOT_FOUND", 404, "path not found");
    }
    throw error;
  }
};

const isTextControlByte = (byte: number) => {
  return (byte <= 8 || (byte >= 14 && byte <= 31) || byte === 127) && byte !== 0;
};

const isBinaryContent = (sample: Buffer) => {
  if (sample.length === 0) {
    return false;
  }
  let controlByteCount = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (isTextControlByte(byte)) {
      controlByteCount += 1;
    }
  }
  if (controlByteCount / sample.length >= 0.3) {
    return true;
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    // Sample bytes may end in the middle of a UTF-8 sequence.
    // `stream: true` validates complete sequences while tolerating an incomplete trailing tail.
    decoder.decode(sample, { stream: true });
    return false;
  } catch {
    return true;
  }
};

const resolveLanguageHint = (targetPath: string): RepoFileLanguageHint => {
  const normalized = targetPath.toLowerCase();
  const baseName = path.posix.basename(normalized);
  if (baseName === "dockerfile") {
    return "dockerfile";
  }
  const extension = path.posix.extname(normalized);
  if (extension === ".ts") {
    return "typescript";
  }
  if (extension === ".tsx") {
    return "tsx";
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return "javascript";
  }
  if (extension === ".jsx") {
    return "jsx";
  }
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".yml" || extension === ".yaml") {
    return "yaml";
  }
  if (extension === ".sh" || extension === ".bash" || extension === ".zsh") {
    return "bash";
  }
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".html" || extension === ".htm") {
    return "html";
  }
  if (extension === ".diff" || extension === ".patch") {
    return "diff";
  }
  if (extension === ".rs") {
    return "rust";
  }
  if (extension === ".go") {
    return "go";
  }
  if (extension === ".swift") {
    return "swift";
  }
  if (extension === ".lua") {
    return "lua";
  }
  if (extension === ".toml") {
    return "toml";
  }
  return "text";
};

type ResolveFileContentInput = {
  repoRoot: string;
  normalizedPath: string;
  maxBytes: number;
};

type ResolveFileStatsInput = {
  repoRoot: string;
  normalizedPath: string;
};

const resolveFileStats = async ({ repoRoot, normalizedPath }: ResolveFileStatsInput) => {
  const resolvedPath = await resolveSafeRepoPath({
    repoRoot,
    relativePath: normalizedPath,
  });
  const absolutePath = resolvedPath.realPath;

  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(absolutePath);
  } catch (error) {
    if (isReadablePermissionError(error)) {
      throw createServiceError("PERMISSION_DENIED", 403, "permission denied");
    }
    if (isNotFoundError(error)) {
      throw createServiceError("NOT_FOUND", 404, "path not found");
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw createServiceError("INVALID_PAYLOAD", 400, "path must point to a file");
  }
  return { absolutePath, allowedRootPath: resolvedPath.repoRootRealPath, stats };
};

export const resolveFileMetadata = async ({ repoRoot, normalizedPath }: ResolveFileStatsInput) => {
  await resolveFileStats({ repoRoot, normalizedPath });
  return {
    path: normalizedPath,
    name: path.posix.basename(normalizedPath),
    kind: "file" as const,
  };
};

export const resolveFileContent = async ({
  repoRoot,
  normalizedPath,
  maxBytes,
}: ResolveFileContentInput): Promise<RepoFileContent> => {
  const { absolutePath, allowedRootPath } = await resolveFileStats({
    repoRoot,
    normalizedPath,
  });

  return resolveFileContentFromAbsolutePath({
    absolutePath,
    allowedRootPath,
    displayPath: normalizedPath,
    maxBytes,
  });
};

export const resolveFileContentFromAbsolutePath = async ({
  absolutePath,
  allowedRootPath,
  displayPath,
  maxBytes,
}: {
  absolutePath: string;
  allowedRootPath: string;
  displayPath: string;
  maxBytes: number;
}): Promise<RepoFileContent> => {
  const { fileHandle, stats } = await openVerifiedFile({ absolutePath, allowedRootPath });
  try {
    const sample = await readFileSlice({
      fileHandle,
      byteLength: Math.min(stats.size, BINARY_SAMPLE_BYTES),
    });
    const isBinary = isBinaryContent(sample);
    if (isBinary) {
      return {
        path: displayPath,
        sizeBytes: stats.size,
        isBinary: true,
        truncated: false,
        languageHint: null,
        content: null,
      } satisfies RepoFileContent;
    }

    const readBytes = Math.min(stats.size, maxBytes);
    const fileBuffer = await readFileSlice({
      fileHandle,
      byteLength: readBytes,
    });

    return {
      path: displayPath,
      sizeBytes: stats.size,
      isBinary: false,
      truncated: stats.size > maxBytes,
      languageHint: resolveLanguageHint(displayPath),
      content: fileBuffer.toString("utf8"),
    } satisfies RepoFileContent;
  } finally {
    await fileHandle.close();
  }
};
