import { transformAsync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import type {
  LoggerEvent,
  PluginOptions as ReactCompilerOptions,
} from "babel-plugin-react-compiler";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const webSourceRoot = path.join(import.meta.dirname, "src");
const sourcePattern = /\.(?:ts|tsx)$/u;
const testPattern = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.(?:ts|tsx)$)/u;
const hookNamePattern = /^use(?:[A-Z0-9]|$)/u;
const componentNamePattern = /^[A-Z]/u;

export type CompilerEligibleKind = "component" | "hook";

export type SourcePosition = {
  line: number;
  column: number;
};

export type SourceSpan = {
  start: SourcePosition;
  end: SourcePosition;
};

export type CompilerEligibleEntry = {
  file: string;
  symbol: string;
  kind: CompilerEligibleKind;
  span: SourceSpan;
  fingerprint: string;
};

export type CompilerEligibilityReport = {
  schemaVersion: 1;
  scope: {
    root: "apps/web/src";
    productionExtensions: [".ts", ".tsx"];
    excluded: ["*.test.*", "*.spec.*", "__tests__"];
    topLevelOnly: true;
  };
  metrics: {
    productionFiles: number;
    eligible: number;
    components: number;
    hooks: number;
  };
  fingerprint: string;
  inventory: CompilerEligibleEntry[];
};

type CompilerTerminalStatus = "bailout" | "no-event" | "pipeline-error" | "skip" | "success";

export type CompilerCoverageDisposition = {
  type: "accept" | "fix" | "rc08-defer";
  reason: string;
  reviewedAt: string;
};

export type CompilerCoverageDispositionReview = {
  schemaVersion: 2;
  entries: Array<
    CompilerCoverageDisposition & {
      key: string;
      status: Exclude<CompilerTerminalStatus, "success">;
      resultSignature: string;
      compilerSignature: string;
      evidenceTests: Array<{ path: string; fingerprint: string }>;
    }
  >;
};

export type NormalizedCompilerEvent = {
  file: string | null;
  kind: LoggerEvent["kind"];
  fnLocation: SourcePosition | null;
  category: string | null;
  reason: string | null;
  memo: {
    slots: number;
    blocks: number;
    values: number;
    prunedBlocks: number;
    prunedValues: number;
  } | null;
};

export type CompilerCoverageResult = CompilerEligibleEntry & {
  status: CompilerTerminalStatus;
  events: {
    success: number;
    diagnostic: number;
    error: number;
    skip: number;
    pipelineError: number;
  };
  detail: {
    category: string | null;
    reason: string | null;
  } | null;
  eventDetails: Array<{
    kind: NormalizedCompilerEvent["kind"];
    category: string | null;
    reason: string | null;
  }>;
  memo: NormalizedCompilerEvent["memo"];
  disposition: CompilerCoverageDisposition | null;
};

export type CompilerCoverageReport = {
  schemaVersion: 1;
  compiler: {
    package: "babel-plugin-react-compiler";
    version: string;
    compilationMode: "infer";
    panicThreshold: "none";
    target: "19";
    optionsHash: string;
    overridesFromProduction: ["compilationMode", "panicThreshold"];
  };
  eligible: {
    total: number;
    baselineFingerprint: string;
  };
  annotatedManifest: {
    total: number;
    success: number;
  };
  summary: {
    success: number;
    bailout: number;
    skip: number;
    pipelineError: number;
    noEvent: number;
    diagnostic: number;
    unmatchedTerminalEvents: number;
    unmatchedDiagnosticEvents: number;
    unreconciled: number;
    successRate: number;
  };
  results: CompilerCoverageResult[];
  unmatchedEvents: NormalizedCompilerEvent[];
};

const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(file) : [file];
    })
    .sort();

const toRepoPath = (file: string): string =>
  path.relative(repoRoot, file).split(path.sep).join("/");

const collectProductionFiles = (): string[] =>
  collectFiles(webSourceRoot).filter((file) => {
    const repoPath = toRepoPath(file);
    return sourcePattern.test(repoPath) && !testPattern.test(repoPath);
  });

const getName = (name: ts.BindingName | undefined): string | null =>
  name != null && ts.isIdentifier(name) ? name.text : null;

const findWrappedFunction = (expression: ts.Expression): ts.FunctionLikeDeclaration | null => {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return findWrappedFunction(expression.expression);
  }
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return findWrappedFunction(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) {
      const candidate = findWrappedFunction(argument);
      if (candidate != null) return candidate;
    }
  }
  return null;
};

const hasCompilerOptInDirective = (node: ts.FunctionLikeDeclaration): boolean =>
  node.body != null &&
  ts.isBlock(node.body) &&
  node.body.statements[0] != null &&
  ts.isExpressionStatement(node.body.statements[0]) &&
  ts.isStringLiteral(node.body.statements[0].expression) &&
  node.body.statements[0].expression.text === "use memo";

const getReactSignals = (
  node: ts.FunctionLikeDeclaration,
): { createsJsx: boolean; callsHook: boolean } => {
  let createsJsx = false;
  let callsHook = false;
  const visit = (current: ts.Node): void => {
    if (
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current)
    ) {
      createsJsx = true;
    }
    if (ts.isCallExpression(current)) {
      const calledName = ts.isIdentifier(current.expression)
        ? current.expression.text
        : ts.isPropertyAccessExpression(current.expression)
          ? current.expression.name.text
          : null;
      if (calledName != null && hookNamePattern.test(calledName)) {
        callsHook = true;
      }
    }
    current.forEachChild(visit);
  };
  if (node.body != null) visit(node.body);
  return { createsJsx, callsHook };
};

const toPosition = (sourceFile: ts.SourceFile, position: number): SourcePosition => {
  const result = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: result.line + 1, column: result.character };
};

const createEligibleEntry = (
  file: string,
  symbol: string,
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): CompilerEligibleEntry | null => {
  const annotated = hasCompilerOptInDirective(node);
  const { createsJsx, callsHook } = getReactSignals(node);
  const kind = hookNamePattern.test(symbol) ? "hook" : "component";
  if (!isCompilerEligibleFunction({ symbol, annotated, createsJsx, callsHook })) return null;

  return {
    file: toRepoPath(file),
    symbol,
    kind,
    span: {
      start: toPosition(sourceFile, node.getStart(sourceFile)),
      end: toPosition(sourceFile, node.getEnd()),
    },
    fingerprint: createCompilerStructuralFingerprint(node.getText(sourceFile)),
  };
};

export const isCompilerEligibleFunction = ({
  symbol,
  annotated,
  createsJsx,
  callsHook,
}: {
  symbol: string;
  annotated: boolean;
  createsJsx: boolean;
  callsHook: boolean;
}): boolean => {
  if (annotated) return true;
  return hookNamePattern.test(symbol)
    ? callsHook
    : componentNamePattern.test(symbol) && (createsJsx || callsHook);
};

export const createCompilerStructuralFingerprint = (source: string): string =>
  createHash("sha256").update(source).digest("hex").slice(0, 16);

const analyzeEligibleFile = (file: string, sourceFile: ts.SourceFile): CompilerEligibleEntry[] => {
  const entries: CompilerEligibleEntry[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const symbol = statement.name?.text ?? null;
      if (symbol == null) continue;
      const entry = createEligibleEntry(file, symbol, statement, sourceFile);
      if (entry != null) entries.push(entry);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const symbol = getName(declaration.name);
      if (symbol == null || declaration.initializer == null) continue;
      const fn = findWrappedFunction(declaration.initializer);
      if (fn == null) continue;
      const entry = createEligibleEntry(file, symbol, fn, sourceFile);
      if (entry != null) entries.push(entry);
    }
  }
  return entries;
};

export const analyzeCompilerEligibleProjectFile = (repoPath: string): CompilerEligibleEntry[] => {
  const api = new API({ cwd: repoRoot });
  const tsConfigPath = path.join(repoRoot, "apps/web/tsconfig.json");
  const snapshot = api.updateSnapshot({ openProjects: [tsConfigPath] });
  try {
    const project = snapshot.getProject(tsConfigPath);
    const file = path.resolve(repoRoot, repoPath);
    const sourceFile = project?.program.getSourceFile(file);
    if (sourceFile == null) {
      throw new Error(`TypeScript project does not contain ${repoPath}`);
    }
    return analyzeEligibleFile(file, sourceFile);
  } finally {
    snapshot.dispose();
    api.close();
  }
};

export const buildCompilerEligibilityReport = (): CompilerEligibilityReport => {
  const api = new API({ cwd: repoRoot });
  const tsConfigPath = path.join(repoRoot, "apps/web/tsconfig.json");
  const snapshot = api.updateSnapshot({ openProjects: [tsConfigPath] });
  const project = snapshot.getProject(tsConfigPath);
  if (project == null) {
    snapshot.dispose();
    api.close();
    throw new Error(`TypeScript project did not load: ${tsConfigPath}`);
  }
  const productionFiles = collectProductionFiles();
  const inventory = productionFiles
    .flatMap((file) => {
      const sourceFile = project.program.getSourceFile(file);
      if (sourceFile == null) {
        throw new Error(`TypeScript program does not contain ${toRepoPath(file)}`);
      }
      return analyzeEligibleFile(file, sourceFile);
    })
    .sort((left, right) =>
      left.file === right.file
        ? left.symbol.localeCompare(right.symbol)
        : left.file.localeCompare(right.file),
    );
  const keys = new Set<string>();
  for (const entry of inventory) {
    const key = `${entry.file}\0${entry.symbol}`;
    if (keys.has(key)) throw new Error(`Duplicate compiler eligible symbol: ${key}`);
    keys.add(key);
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(inventory))
    .digest("hex")
    .slice(0, 16);
  snapshot.dispose();
  api.close();
  return {
    schemaVersion: 1,
    scope: {
      root: "apps/web/src",
      productionExtensions: [".ts", ".tsx"],
      excluded: ["*.test.*", "*.spec.*", "__tests__"],
      topLevelOnly: true,
    },
    metrics: {
      productionFiles: productionFiles.length,
      eligible: inventory.length,
      components: inventory.filter(({ kind }) => kind === "component").length,
      hooks: inventory.filter(({ kind }) => kind === "hook").length,
    },
    fingerprint,
    inventory,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value != null;

const getString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const normalizeEventDetail = (
  event: LoggerEvent,
): { category: string | null; reason: string | null } => {
  if (event.kind === "CompileSkip") {
    return { category: null, reason: event.reason };
  }
  if (event.kind === "PipelineError") {
    return { category: "PipelineError", reason: event.data };
  }
  if (event.kind !== "CompileError" && event.kind !== "CompileDiagnostic") {
    return { category: null, reason: null };
  }
  const detail = event.detail as unknown;
  const options = isRecord(detail) && isRecord(detail.options) ? detail.options : detail;
  return isRecord(options)
    ? { category: getString(options.category), reason: getString(options.reason) }
    : { category: null, reason: null };
};

const normalizeCompilerEvent = (
  filename: string | null,
  event: LoggerEvent,
): NormalizedCompilerEvent => {
  const detail = normalizeEventDetail(event);
  return {
    file: filename == null ? null : toRepoPath(filename),
    kind: event.kind,
    fnLocation:
      "fnLoc" in event && event.fnLoc != null
        ? { line: event.fnLoc.start.line, column: event.fnLoc.start.column }
        : null,
    category: detail.category,
    reason: detail.reason,
    memo:
      event.kind === "CompileSuccess"
        ? {
            slots: event.memoSlots,
            blocks: event.memoBlocks,
            values: event.memoValues,
            prunedBlocks: event.prunedMemoBlocks,
            prunedValues: event.prunedMemoValues,
          }
        : null,
  };
};

const comparePosition = (left: SourcePosition, right: SourcePosition): number =>
  left.line === right.line ? left.column - right.column : left.line - right.line;

const spanContains = (span: SourceSpan, position: SourcePosition): boolean =>
  comparePosition(span.start, position) <= 0 && comparePosition(position, span.end) <= 0;

const isTerminalEvent = (event: NormalizedCompilerEvent): boolean =>
  ["CompileError", "CompileSkip", "CompileSuccess", "PipelineError"].includes(event.kind);

const isReportableUnmatchedEvent = (event: NormalizedCompilerEvent): boolean =>
  isTerminalEvent(event) || event.kind === "CompileDiagnostic";

export const createCompilerCoverageReport = (
  eligibility: CompilerEligibilityReport,
  events: readonly NormalizedCompilerEvent[],
  compilerVersion: string,
  annotatedManifest: readonly { file: string; symbol: string }[] = [],
): CompilerCoverageReport => {
  const eventsByKey = new Map<string, NormalizedCompilerEvent[]>();
  const unmatchedEvents: NormalizedCompilerEvent[] = [];
  for (const event of events) {
    if (event.file == null || event.fnLocation == null) {
      if (isReportableUnmatchedEvent(event)) unmatchedEvents.push(event);
      continue;
    }
    const candidates = eligibility.inventory.filter(
      (entry) => entry.file === event.file && spanContains(entry.span, event.fnLocation!),
    );
    const entry = candidates.sort((left, right) =>
      comparePosition(right.span.start, left.span.start),
    )[0];
    if (entry == null) {
      if (isReportableUnmatchedEvent(event)) unmatchedEvents.push(event);
      continue;
    }
    const key = `${entry.file}\0${entry.symbol}`;
    const existing = eventsByKey.get(key) ?? [];
    existing.push(event);
    eventsByKey.set(key, existing);
  }

  const results = eligibility.inventory.map((entry): CompilerCoverageResult => {
    const entryEvents = eventsByKey.get(`${entry.file}\0${entry.symbol}`) ?? [];
    const counts = {
      success: entryEvents.filter(({ kind }) => kind === "CompileSuccess").length,
      diagnostic: entryEvents.filter(({ kind }) => kind === "CompileDiagnostic").length,
      error: entryEvents.filter(({ kind }) => kind === "CompileError").length,
      skip: entryEvents.filter(({ kind }) => kind === "CompileSkip").length,
      pipelineError: entryEvents.filter(({ kind }) => kind === "PipelineError").length,
    };
    const status: CompilerTerminalStatus =
      counts.pipelineError > 0
        ? "pipeline-error"
        : counts.error > 0
          ? "bailout"
          : counts.skip > 0
            ? "skip"
            : counts.success > 0
              ? "success"
              : "no-event";
    const detailKind =
      status === "pipeline-error"
        ? "PipelineError"
        : status === "bailout"
          ? "CompileError"
          : status === "skip"
            ? "CompileSkip"
            : null;
    const detailEvent = entryEvents.find(({ kind }) => kind === detailKind);
    const successEvent = entryEvents.find(({ kind }) => kind === "CompileSuccess");
    const eventDetails = entryEvents
      .filter(
        ({ kind }) =>
          kind === "CompileError" ||
          kind === "CompileDiagnostic" ||
          kind === "CompileSkip" ||
          kind === "PipelineError",
      )
      .map(({ kind, category, reason }) => ({ kind, category, reason }));
    return {
      ...entry,
      status,
      events: counts,
      detail:
        detailEvent == null ? null : { category: detailEvent.category, reason: detailEvent.reason },
      eventDetails,
      memo: successEvent?.memo ?? null,
      disposition: null,
    };
  });
  const summary = {
    success: results.filter(({ status }) => status === "success").length,
    bailout: results.filter(({ status }) => status === "bailout").length,
    skip: results.filter(({ status }) => status === "skip").length,
    pipelineError: results.filter(({ status }) => status === "pipeline-error").length,
    noEvent: results.filter(({ status }) => status === "no-event").length,
    diagnostic: results.reduce((total, result) => total + result.events.diagnostic, 0),
    unmatchedTerminalEvents: unmatchedEvents.filter(isTerminalEvent).length,
    unmatchedDiagnosticEvents: unmatchedEvents.filter(({ kind }) => kind === "CompileDiagnostic")
      .length,
    unreconciled: results.filter(({ status }) => status !== "success").length,
    successRate: 0,
  };
  summary.successRate =
    eligibility.metrics.eligible === 0 ? 0 : summary.success / eligibility.metrics.eligible;
  const compilerContract = {
    package: "babel-plugin-react-compiler",
    version: compilerVersion,
    ...compilerCoverageOptions,
    overridesFromProduction: ["compilationMode", "panicThreshold"] as [
      "compilationMode",
      "panicThreshold",
    ],
  } as const;
  return {
    schemaVersion: 1,
    compiler: {
      ...compilerContract,
      optionsHash: hashReviewValue(compilerCoverageOptions),
    },
    eligible: {
      total: eligibility.metrics.eligible,
      baselineFingerprint: eligibility.fingerprint,
    },
    annotatedManifest: {
      total: annotatedManifest.length,
      success: annotatedManifest.filter(({ file, symbol }) =>
        results.some(
          (result) =>
            result.file === file && result.symbol === symbol && result.status === "success",
        ),
      ).length,
    },
    summary,
    results,
    unmatchedEvents,
  };
};

const hashReviewValue = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const compilerCoverageOptions = {
  compilationMode: "infer",
  panicThreshold: "none",
  target: "19",
} as const satisfies ReactCompilerOptions;

export const createCompilerCoverageReviewSignatures = (
  report: CompilerCoverageReport,
  result: CompilerCoverageResult,
): { resultSignature: string; compilerSignature: string } => ({
  resultSignature: hashReviewValue({
    file: result.file,
    symbol: result.symbol,
    kind: result.kind,
    span: result.span,
    fingerprint: result.fingerprint,
    status: result.status,
    events: result.events,
    detail: result.detail,
    eventDetails: result.eventDetails,
  }),
  compilerSignature: hashReviewValue(report.compiler),
});

const isValidEvidenceTestPath = (testPath: string): boolean =>
  !path.isAbsolute(testPath) &&
  !testPath.split("/").includes("..") &&
  testPattern.test(testPath) &&
  existsSync(path.join(repoRoot, testPath));

export const createCompilerCoverageEvidenceTest = (
  testPath: string,
): { path: string; fingerprint: string } => {
  if (!isValidEvidenceTestPath(testPath)) {
    throw new Error(`Invalid React Compiler evidence test path: ${testPath}`);
  }
  return {
    path: testPath,
    fingerprint: createHash("sha256")
      .update(readFileSync(path.join(repoRoot, testPath)))
      .digest("hex"),
  };
};

export const createCompilerCoverageReviewTemplate = (
  report: CompilerCoverageReport,
  review: CompilerCoverageDispositionReview,
): CompilerCoverageDispositionReview => {
  const existingByKey = new Map(
    Array.isArray(review.entries) ? review.entries.map((entry) => [entry?.key, entry]) : [],
  );
  return {
    schemaVersion: 2,
    entries: report.results
      .filter(
        (
          result,
        ): result is CompilerCoverageResult & {
          status: Exclude<CompilerTerminalStatus, "success">;
        } => result.status !== "success",
      )
      .map((result) => {
        const key = `${result.file}::${result.symbol}`;
        const existing = existingByKey.get(key);
        const signatures = createCompilerCoverageReviewSignatures(report, result);
        const evidenceTests = Array.isArray(existing?.evidenceTests)
          ? existing.evidenceTests.flatMap((test) =>
              isRecord(test) && typeof test.path === "string" && isValidEvidenceTestPath(test.path)
                ? [createCompilerCoverageEvidenceTest(test.path)]
                : [],
            )
          : [];
        const isCurrent =
          existing?.status === result.status &&
          Array.isArray(existing.evidenceTests) &&
          existing.resultSignature === signatures.resultSignature &&
          existing.compilerSignature === signatures.compilerSignature &&
          existing.evidenceTests.length === evidenceTests.length &&
          existing.evidenceTests.every(
            (test, index) => test.fingerprint === evidenceTests[index]?.fingerprint,
          );
        return {
          key,
          status: result.status,
          type: existing?.type ?? "fix",
          reason: existing?.reason ?? "REVIEW_REQUIRED",
          reviewedAt: isCurrent ? existing.reviewedAt : "REVIEW_REQUIRED",
          evidenceTests,
          ...signatures,
        };
      }),
  };
};

export const reconcileCompilerCoverage = (
  report: CompilerCoverageReport,
  review: CompilerCoverageDispositionReview,
): CompilerCoverageReport => {
  if (review.schemaVersion !== 2 || !Array.isArray(review.entries)) {
    throw new Error(
      `Unsupported React Compiler disposition schema: ${String(review.schemaVersion)}`,
    );
  }
  for (const entry of review.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      !["bailout", "no-event", "pipeline-error", "skip"].includes(entry.status) ||
      !["accept", "fix", "rc08-defer"].includes(entry.type) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim() === "" ||
      typeof entry.reviewedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(entry.reviewedAt) ||
      typeof entry.resultSignature !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.resultSignature) ||
      typeof entry.compilerSignature !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.compilerSignature) ||
      !Array.isArray(entry.evidenceTests) ||
      entry.evidenceTests.length === 0 ||
      entry.evidenceTests.some(
        (test) =>
          !isRecord(test) ||
          typeof test.path !== "string" ||
          typeof test.fingerprint !== "string" ||
          !isValidEvidenceTestPath(test.path) ||
          !/^[a-f0-9]{64}$/u.test(test.fingerprint),
      )
    ) {
      const entryKey = isRecord(entry) && typeof entry.key === "string" ? entry.key : "<unknown>";
      throw new Error(`Invalid React Compiler disposition: ${entryKey}`);
    }
  }
  const reviewedByKey = new Map(review.entries.map((entry) => [entry.key, entry]));
  if (reviewedByKey.size !== review.entries.length) {
    throw new Error("React Compiler disposition review has duplicate keys");
  }
  const nonSuccessKeys = new Set(
    report.results
      .filter(({ status }) => status !== "success")
      .map(({ file, symbol }) => `${file}::${symbol}`),
  );
  const stale = [...reviewedByKey.keys()].filter((key) => !nonSuccessKeys.has(key));
  if (stale.length > 0) {
    throw new Error(`React Compiler disposition review is stale: ${stale.join(", ")}`);
  }
  const staleStatuses = report.results
    .filter(({ status }) => status !== "success")
    .flatMap((result) => {
      const key = `${result.file}::${result.symbol}`;
      const reviewed = reviewedByKey.get(key);
      return reviewed != null && reviewed.status !== result.status ? [key] : [];
    });
  if (staleStatuses.length > 0) {
    throw new Error(`React Compiler disposition status is stale: ${staleStatuses.join(", ")}`);
  }
  const staleContexts = report.results
    .filter(({ status }) => status !== "success")
    .flatMap((result) => {
      const key = `${result.file}::${result.symbol}`;
      const reviewed = reviewedByKey.get(key);
      if (reviewed == null || reviewed.status !== result.status) return [];
      const signatures = createCompilerCoverageReviewSignatures(report, result);
      const evidenceIsCurrent = reviewed.evidenceTests.every(
        (test) => createCompilerCoverageEvidenceTest(test.path).fingerprint === test.fingerprint,
      );
      return reviewed.resultSignature === signatures.resultSignature &&
        reviewed.compilerSignature === signatures.compilerSignature &&
        evidenceIsCurrent
        ? []
        : [key];
    });
  if (staleContexts.length > 0) {
    throw new Error(`React Compiler disposition context is stale: ${staleContexts.join(", ")}`);
  }
  const results = report.results.map((result): CompilerCoverageResult => {
    if (result.status === "success") return result;
    const key = `${result.file}::${result.symbol}`;
    const reviewed = reviewedByKey.get(key);
    if (reviewed == null || reviewed.status !== result.status) {
      return result;
    }
    return {
      ...result,
      disposition: {
        type: reviewed.type,
        reason: reviewed.reason,
        reviewedAt: reviewed.reviewedAt,
      },
    };
  });
  return {
    ...report,
    summary: {
      ...report.summary,
      unreconciled: results.filter(
        ({ status, disposition }) => status !== "success" && disposition == null,
      ).length,
    },
    results,
  };
};

export const buildCompilerCoverageReport = async (
  eligibility: CompilerEligibilityReport,
  annotatedManifest: readonly { file: string; symbol: string }[] = [],
): Promise<CompilerCoverageReport> => {
  const packageJson = JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "node_modules/babel-plugin-react-compiler/package.json"),
      "utf8",
    ),
  ) as { version: string };
  const events: NormalizedCompilerEvent[] = [];
  const options: ReactCompilerOptions = {
    ...compilerCoverageOptions,
    logger: {
      logEvent(filename, event) {
        if (
          [
            "CompileSuccess",
            "CompileError",
            "CompileDiagnostic",
            "CompileSkip",
            "PipelineError",
          ].includes(event.kind)
        ) {
          events.push(normalizeCompilerEvent(filename, event));
        }
      },
    },
  };
  for (const file of collectProductionFiles()) {
    await transformAsync(readFileSync(file, "utf8"), {
      ast: false,
      babelrc: false,
      code: false,
      configFile: false,
      filename: file,
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [[reactCompiler, options]],
      sourceMaps: false,
    });
  }
  return createCompilerCoverageReport(eligibility, events, packageJson.version, annotatedManifest);
};
