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

const commitPilotContract = {
  annotation: "function-body-directive",
  behaviorTest: "apps/web/src/pages/SessionDetail/components/CommitSection.test.tsx",
  family: "commit",
  kind: "component",
  profilerOperation: "commit-expand-live",
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
] as const;

const compilerContract = {
  compilationMode: "annotation",
  panicThreshold: "all_errors",
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

const compilerBaseOptions = {
  compilationMode: compilerContract.compilationMode,
  panicThreshold: compilerContract.panicThreshold,
  sources: isReactCompilerSource,
  target: compilerContract.target,
} satisfies ReactCompilerOptions;

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

const normalizeFilename = (filename: string | null): string | null => {
  if (filename == null) return null;
  return path.relative(repoRoot, filename).split(path.sep).join("/");
};

export const createReactCompilerCollector = (runKind: "production" | "vitest") => {
  const records: CompilerEventRecord[] = [];
  const options: ReactCompilerOptions = {
    ...compilerBaseOptions,
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
    const failures = records.flatMap(({ file, event }) =>
      ["CompileError", "CompileDiagnostic", "CompileSkip", "PipelineError"].includes(event.kind)
        ? [{ file, kind: event.kind }]
        : [],
    );

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

  const assertSymbols = (expectedSymbols: readonly string[]): void => {
    const artifact = getArtifact();
    if (artifact.failures.length > 0) {
      throw new Error(`React Compiler reported failures: ${JSON.stringify(artifact.failures)}`);
    }

    const successCounts = new Map<string, number>();
    for (const success of artifact.successes) {
      if (success.symbol == null) continue;
      successCounts.set(success.symbol, (successCounts.get(success.symbol) ?? 0) + 1);
    }
    const missing = expectedSymbols.filter((symbol) => !successCounts.has(symbol));
    if (missing.length > 0) {
      throw new Error(`React Compiler did not compile: ${missing.join(", ")}`);
    }
  };

  const assertPilot = (): void => {
    const pilotManifest: readonly { file: string; symbol: string }[] = reactCompilerPilotManifest;
    assertSymbols(pilotManifest.map(({ symbol }) => symbol));
    const artifact = getArtifact();
    const expectedKeys = new Set(pilotManifest.map(({ file, symbol }) => `${file}\0${symbol}`));
    const successKeys = new Set(
      artifact.successes.flatMap(({ file, symbol }) =>
        file == null || symbol == null ? [] : [`${file}\0${symbol}`],
      ),
    );
    const missing = [...expectedKeys].filter((key) => !successKeys.has(key));
    const unexpected = [...successKeys].filter((key) => !expectedKeys.has(key));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(`React Compiler pilot mismatch: ${JSON.stringify({ missing, unexpected })}`);
    }
  };

  return { assertPilot, assertSymbols, getArtifact, options };
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
