import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import type {
  LoggerEvent,
  PluginOptions as ReactCompilerOptions,
} from "babel-plugin-react-compiler";
import type { Plugin } from "vite";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const webRoot = import.meta.dirname;
const webSourceRoot = path.join(webRoot, "src");
const compilerContractRoot = path.join(webRoot, "test/compiler-contract");
// Vitest normalizes query-bearing module IDs. Coverage keeps a local pattern because its production
// inventory and evidence inputs are already repo-relative TypeScript paths.
const reactCompilerTestPattern = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.(?:ts|tsx)$)/u;

export const reactCompilerRequiredCompileSuccesses = [
  {
    symbol: "CommitReasonCallout",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitVirtualBranchNotice",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitRepoRoot",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitErrorCallout",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitLoadingOverlay",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitEmptyStateNotice",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitFileRows",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-file-row.tsx",
  },
  {
    symbol: "CommitFileRow",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-file-row.tsx",
  },
  {
    symbol: "CommitItem",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-item.tsx",
  },
  {
    symbol: "CommitList",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-list.tsx",
  },
  {
    symbol: "CommitSection",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    symbol: "CommitExpandedSection",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-expanded-section.tsx",
  },
  {
    symbol: "CommitFileDetailContent",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-file-detail-content.tsx",
  },
  {
    symbol: "CommitLoadMoreButton",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-load-more-button.tsx",
  },
  {
    symbol: "ScreenPanelWorktreeSelectorPanel",
    file: "apps/web/src/pages/SessionDetail/components/ScreenPanelWorktreeSelectorPanel.tsx",
  },
  {
    symbol: "WorktreeStatusStack",
    file: "apps/web/src/pages/SessionDetail/components/WorktreeStatusStack.tsx",
  },
  {
    symbol: "ScreenPanelViewport",
    file: "apps/web/src/pages/SessionDetail/components/ScreenPanelViewport.tsx",
  },
  {
    symbol: "PromptCompletionList",
    file: "apps/web/src/features/shared-session-ui/components/prompt-completion/PromptCompletionList.tsx",
  },
  {
    symbol: "PromptCompletionTriggerRail",
    file: "apps/web/src/features/shared-session-ui/components/prompt-completion/PromptCompletionTriggerRail.tsx",
  },
] as const;

export const REACT_COMPILER_PRODUCTION_MODE = "infer" as const;
export const REACT_COMPILER_PRODUCTION_PANIC_THRESHOLD = "none" as const;

const compilerContract = {
  compilationMode: REACT_COMPILER_PRODUCTION_MODE,
  panicThreshold: REACT_COMPILER_PRODUCTION_PANIC_THRESHOLD,
  sources: ["apps/web/src/**/*.{ts,tsx}", "apps/web/test/compiler-contract/**/*.{ts,tsx}"],
  target: "19",
} as const;

const isWithinDirectory = (directory: string, filename: string): boolean => {
  const relativePath = path.relative(directory, filename);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

export const isReactCompilerSource = (filename: string): boolean => {
  const sourceId = filename.split("?", 1)[0]!;
  return (
    (isWithinDirectory(webSourceRoot, sourceId) ||
      isWithinDirectory(compilerContractRoot, sourceId)) &&
    /\.tsx?$/u.test(sourceId)
  );
};

export const isReactCompilerTestModule = (filename: string): boolean =>
  reactCompilerTestPattern.test(filename.split(path.sep).join("/"));

type CompilerEventRecord = {
  file: string | null;
  event: LoggerEvent;
};

type CompilerSuccess = {
  file: string | null;
  symbol: string | null;
  memoSlots: number;
  memoBlocks: number;
  memoValues: number;
};

type ReactCompilerArtifact = {
  requiredCompileSuccesses: readonly { file: string; symbol: string }[];
  successes: readonly { file: string | null; symbol: string | null }[];
  failures: readonly { file: string | null; kind: string }[];
};

const blockingFailureKinds = new Set(["CompileError", "CompileSkip", "PipelineError"]);

export const assertReactCompilerRequiredCompileSuccesses = (
  artifact: ReactCompilerArtifact,
): void => {
  const requiredKeys = artifact.requiredCompileSuccesses.map(
    ({ file, symbol }) => `${file}\0${symbol}`,
  );
  const requiredKeySet = new Set(requiredKeys);
  const requiredFiles = new Set(artifact.requiredCompileSuccesses.map(({ file }) => file));
  const successCounts = new Map<string, number>();
  for (const { file, symbol } of artifact.successes) {
    if (file == null || symbol == null) continue;
    const key = `${file}\0${symbol}`;
    if (requiredKeySet.has(key)) {
      successCounts.set(key, (successCounts.get(key) ?? 0) + 1);
    }
  }
  const missing = requiredKeys.filter((key) => !successCounts.has(key));
  const duplicateRequiredCompileSuccesses = requiredKeys.filter(
    (key, index) => requiredKeys.indexOf(key) !== index,
  );
  const duplicateSuccesses: Array<{ key: string; count: number }> = [];
  for (const [key, count] of successCounts) {
    if (count !== 1) duplicateSuccesses.push({ key, count });
  }
  const blockingFailures = artifact.failures.filter(
    ({ file, kind }) => file != null && requiredFiles.has(file) && blockingFailureKinds.has(kind),
  );
  if (
    missing.length > 0 ||
    duplicateRequiredCompileSuccesses.length > 0 ||
    duplicateSuccesses.length > 0 ||
    blockingFailures.length > 0
  ) {
    throw new Error(
      `React Compiler required success mismatch: ${JSON.stringify({
        missing,
        duplicateRequiredCompileSuccesses,
        duplicateSuccesses,
        blockingFailures,
      })}`,
    );
  }
};

const normalizeFilename = (filename: string | null): string | null => {
  if (filename == null) return null;
  return path.relative(repoRoot, filename).split(path.sep).join("/");
};

export const createReactCompilerCollector = (runKind: "production" | "vitest") => {
  const records: CompilerEventRecord[] = [];
  const options: ReactCompilerOptions = {
    compilationMode: compilerContract.compilationMode,
    panicThreshold: compilerContract.panicThreshold,
    sources: isReactCompilerSource,
    target: compilerContract.target,
    logger: {
      logEvent(filename, event) {
        records.push({ file: normalizeFilename(filename), event });
      },
    },
  };

  const getArtifact = () => {
    const successes: CompilerSuccess[] = records.flatMap(({ file, event }) =>
      event.kind === "CompileSuccess"
        ? [
            {
              file,
              symbol: event.fnName,
              memoSlots: event.memoSlots,
              memoBlocks: event.memoBlocks,
              memoValues: event.memoValues,
            },
          ]
        : [],
    );
    const failures = records.flatMap(({ file, event }) => {
      switch (event.kind) {
        case "CompileError":
        case "CompileDiagnostic":
        case "CompileSkip":
        case "PipelineError":
          return [
            {
              file,
              kind: event.kind,
            },
          ];
        default:
          return [];
      }
    });

    return {
      schemaVersion: 1,
      run: {
        kind: runKind,
        measurementCommit: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repoRoot,
          encoding: "utf8",
        }).trim(),
        node: process.version,
        workingTreeClean:
          execFileSync("git", ["status", "--porcelain"], {
            cwd: repoRoot,
            encoding: "utf8",
          }).trim() === "",
      },
      compiler: {
        ...compilerContract,
        optionsHash: createHash("sha256").update(JSON.stringify(compilerContract)).digest("hex"),
      },
      requiredCompileSuccesses: reactCompilerRequiredCompileSuccesses,
      successes,
      failures,
    };
  };

  const assertBuild = (): void => {
    assertReactCompilerRequiredCompileSuccesses(getArtifact());
  };

  return { assertBuild, getArtifact, options };
};

export type ReactCompilerCollector = ReturnType<typeof createReactCompilerCollector>;

export const createReactCompilerBuildValidationPlugin = (
  collector: ReactCompilerCollector,
): Plugin => ({
  name: "react-compiler-build-validation",
  apply: "build",
  generateBundle() {
    collector.assertBuild();
  },
});
