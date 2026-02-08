import { execa } from "execa";

export type RunGitOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
  allowStdoutOnError?: boolean;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BUFFER = 20_000_000;

const resolveRunGitOptions = (options?: RunGitOptions) => ({
  timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
  allowStdoutOnError: options?.allowStdoutOnError ?? true,
});

const extractStdoutFromError = (err: unknown) => {
  if (!err || typeof err !== "object" || !("stdout" in err)) {
    return null;
  }
  const { stdout } = err as { stdout?: unknown };
  return typeof stdout === "string" ? stdout : "";
};

export const runGit = async (
  cwd: string,
  args: string[],
  options?: RunGitOptions,
): Promise<string> => {
  const runOptions = resolveRunGitOptions(options);
  try {
    const result = await execa("git", ["-C", cwd, ...args], {
      timeout: runOptions.timeoutMs,
      maxBuffer: runOptions.maxBuffer,
    });
    return result.stdout ?? "";
  } catch (err) {
    if (!runOptions.allowStdoutOnError) {
      throw err;
    }
    const stdout = extractStdoutFromError(err);
    if (stdout != null) {
      return stdout;
    }
    throw err;
  }
};

export const resolveRepoRoot = async (
  cwd: string,
  options?: RunGitOptions,
): Promise<string | null> => {
  try {
    const output = await runGit(cwd, ["rev-parse", "--show-toplevel"], options);
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};
