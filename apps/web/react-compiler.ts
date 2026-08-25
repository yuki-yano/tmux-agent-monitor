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

const commitPilotContract = {
  annotation: "function-body-directive",
  behaviorTest: "apps/web/src/pages/SessionDetail/components/CommitSection.test.tsx",
  family: "commit",
  kind: "component",
  profilerOperation: "commit-expand-live",
} as const;

const screenPilotContract = {
  annotation: "function-body-directive",
  family: "screen",
  kind: "component",
  profilerOperation: "screen-output-follow",
} as const;

const composerPilotContract = {
  annotation: "function-body-directive",
  behaviorTest: "apps/web/src/features/shared-session-ui/components/PaneTextComposer.test.tsx",
  family: "composer",
  kind: "component",
  profilerOperation: "prompt-completion-open",
} as const;

export const reactCompilerPilotManifest = [
  {
    ...commitPilotContract,
    symbol: "CommitReasonCallout",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitVirtualBranchNotice",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitRepoRoot",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitFileRows",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-file-row.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitItem",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-item.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitList",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-list.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitSection",
    file: "apps/web/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitExpandedSection",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-expanded-section.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitFileDetailContent",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-file-detail-content.tsx",
  },
  {
    ...commitPilotContract,
    symbol: "CommitLoadMoreButton",
    file: "apps/web/src/pages/SessionDetail/components/commit-section/commit-load-more-button.tsx",
  },
  {
    ...screenPilotContract,
    behaviorTest: "apps/web/src/pages/SessionDetail/components/ScreenPanel.test.tsx",
    symbol: "ScreenPanelWorktreeSelectorPanel",
    file: "apps/web/src/pages/SessionDetail/components/ScreenPanelWorktreeSelectorPanel.tsx",
  },
  {
    ...screenPilotContract,
    behaviorTest: "apps/web/src/pages/SessionDetail/components/WorktreeStatusStack.test.tsx",
    symbol: "WorktreeStatusStack",
    file: "apps/web/src/pages/SessionDetail/components/WorktreeStatusStack.tsx",
  },
  {
    ...screenPilotContract,
    behaviorTest: "apps/web/src/pages/SessionDetail/components/ScreenPanelViewport.test.tsx",
    symbol: "ScreenPanelViewport",
    file: "apps/web/src/pages/SessionDetail/components/ScreenPanelViewport.tsx",
  },
  {
    ...composerPilotContract,
    symbol: "PromptCompletionList",
    file: "apps/web/src/features/shared-session-ui/components/prompt-completion/PromptCompletionList.tsx",
  },
  {
    ...composerPilotContract,
    symbol: "PromptCompletionTriggerRail",
    file: "apps/web/src/features/shared-session-ui/components/prompt-completion/PromptCompletionTriggerRail.tsx",
  },
] as const;

export const REACT_COMPILER_PILOT_MANIFEST_COUNT = 15;

export type ReactCompilerCompilationMode = "annotation" | "infer";

const createCompilerContract = (compilationMode: ReactCompilerCompilationMode) =>
  ({
    compilationMode,
    panicThreshold: compilationMode === "annotation" ? "all_errors" : "none",
    sources: ["apps/web/src/**/*.{ts,tsx}", "apps/web/test/compiler-contract/**/*.{ts,tsx}"],
    target: "19",
  }) as const;

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

type ReactCompilerPilotArtifact = {
  manifest: readonly { file: string; symbol: string }[];
  successes: readonly { file: string | null; symbol: string | null }[];
  failures: readonly unknown[];
};

export const assertReactCompilerPilotArtifact = (artifact: ReactCompilerPilotArtifact): void => {
  const expectedKeys = artifact.manifest.map(({ file, symbol }) => `${file}\0${symbol}`);
  const expectedKeySet = new Set(expectedKeys);
  const unkeyed = artifact.successes.filter(({ file, symbol }) => file == null || symbol == null);
  const successCounts = new Map<string, number>();
  for (const { file, symbol } of artifact.successes) {
    if (file == null || symbol == null) continue;
    const key = `${file}\0${symbol}`;
    successCounts.set(key, (successCounts.get(key) ?? 0) + 1);
  }
  const missing = expectedKeys.filter((key) => !successCounts.has(key));
  const unexpected = [...successCounts.keys()].filter((key) => !expectedKeySet.has(key));
  const duplicateManifest = expectedKeys.filter(
    (key, index) => expectedKeys.indexOf(key) !== index,
  );
  const duplicateSuccesses: Array<{ key: string; count: number }> = [];
  for (const [key, count] of successCounts) {
    if (count !== 1) duplicateSuccesses.push({ key, count });
  }
  if (
    artifact.manifest.length !== REACT_COMPILER_PILOT_MANIFEST_COUNT ||
    artifact.failures.length > 0 ||
    unkeyed.length > 0 ||
    missing.length > 0 ||
    unexpected.length > 0 ||
    duplicateManifest.length > 0 ||
    duplicateSuccesses.length > 0
  ) {
    throw new Error(
      `React Compiler pilot mismatch: ${JSON.stringify({
        manifestCount: artifact.manifest.length,
        failures: artifact.failures.length,
        unkeyed: unkeyed.length,
        missing,
        unexpected,
        duplicateManifest,
        duplicateSuccesses,
      })}`,
    );
  }
};

const normalizeFilename = (filename: string | null): string | null => {
  if (filename == null) return null;
  return path.relative(repoRoot, filename).split(path.sep).join("/");
};

export const createReactCompilerCollector = (
  runKind: "production" | "vitest",
  compilationMode: ReactCompilerCompilationMode = "annotation",
) => {
  const compilerContract = createCompilerContract(compilationMode);
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
      manifest: reactCompilerPilotManifest,
      successes,
      failures,
    };
  };

  const assertPilot = (): void => {
    const artifact = getArtifact();
    assertReactCompilerPilotArtifact(artifact);
  };

  return { assertPilot, compilationMode, getArtifact, options };
};

export type ReactCompilerCollector = ReturnType<typeof createReactCompilerCollector>;

export const createReactCompilerBuildArtifactPlugin = (
  collector: ReactCompilerCollector,
): Plugin => ({
  name: "react-compiler-pilot-artifact",
  apply: "build",
  generateBundle() {
    collector.assertPilot();
    this.emitFile({
      type: "asset",
      fileName: "react-compiler-pilot.json",
      source: `${JSON.stringify(collector.getArtifact(), null, 2)}\n`,
    });
  },
});
