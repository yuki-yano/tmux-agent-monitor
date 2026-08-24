import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import * as ts from "typescript/unstable/ast";
import { API, type Program } from "typescript/unstable/sync";

import {
  type ReviewedEffectCategory,
  reviewedEffectClassifications,
  reviewedRefMirrorEventMigration,
  reviewedRetainedDerivedStateEffects,
  reviewedRetainedIdentityEffects,
  reviewedUseEffectEventCandidates,
} from "./react-effect-classification.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webSourceRoot = path.join(repoRoot, "apps/web/src");
const sourcePattern = /\.(?:ts|tsx)$/u;
const testPattern = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.(?:ts|tsx)$)/u;

type EffectCategory = ReviewedEffectCategory;

type EffectDisposition =
  | "delete-or-useEffectEvent"
  | "event-handler"
  | "key-reset"
  | "maintain"
  | "query"
  | "render-or-reducer"
  | "review";

type EffectEventCheck = "manual-review" | "no" | "not-applicable" | "yes";

export interface EffectSite {
  id: string;
  file: string;
  line: number;
  column: number;
  owner: string;
  hook: "useEffect" | "useLayoutEffect";
  dependencies: string[] | "dynamic" | "none";
  fingerprint: string;
  category: EffectCategory;
  disposition: EffectDisposition;
  confidence: "high" | "medium" | "low";
  effectEvent: {
    readsLatestReactiveValuesInsideCallback: EffectEventCheck;
    callbackIdentityIsNotSubscriptionContract: EffectEventCheck;
    effectEventIsNotExported: EffectEventCheck;
  };
  testEvidence: {
    adjacentFiles: string[];
    behaviorVerified: false;
  };
  preview: string;
}

type SiteDraft = Omit<EffectSite, "id">;

interface Classification {
  category: EffectCategory;
  disposition: EffectDisposition;
  confidence: EffectSite["confidence"];
  effectEventCandidate: boolean;
}

interface ArchitectureReport {
  schemaVersion: 1;
  scope: {
    root: "apps/web/src";
    productionExtensions: [".ts", ".tsx"];
    excluded: ["*.test.*", "*.spec.*", "__tests__"];
  };
  metrics: {
    productionFiles: number;
    useEffect: number;
    useLayoutEffect: number;
    effectTotal: number;
    sessionDetailEffects: number;
    useMemo: number;
    useCallback: number;
    memo: number;
    sessionDetailAndLibUseMemo: number;
    sessionDetailAndLibUseCallback: number;
    visibilityPollingCallerFiles: number;
    sessionDetailOwnershipLines: number;
    sessionFilesHookFamilyLines: number;
    largestSessionFilesHookModuleLines: number;
    reactOxlintDisable: number;
    reactDoctorDisable: number;
    exhaustiveDepsSuppression: number;
    useNoMemoDirective: number;
  };
  limits: {
    sessionFilesHookFamilyLines: 2450;
    largestSessionFilesHookModuleLines: 1000;
  };
  classificationSummary: Record<EffectCategory, number>;
  inventory: EffectSite[];
}

const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(file) : [file];
    })
    .sort();

const toRepoPath = (file: string): string =>
  path.relative(repoRoot, file).split(path.sep).join("/");

const isProductionSource = (file: string): boolean => {
  const repoPath = toRepoPath(file);
  return sourcePattern.test(repoPath) && !testPattern.test(repoPath);
};

const getName = (name: ts.BindingName | ts.PropertyName | undefined): string | null => {
  if (name == null) {
    return null;
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const findOwner = (node: ts.Node): string => {
  let current: ts.Node | undefined = node.parent;
  while (current != null) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return getName(current.name) ?? "<anonymous>";
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent)) {
        return getName(parent.name) ?? "<anonymous>";
      }
      if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
        return getName(parent.name) ?? "<anonymous>";
      }
    }
    current = current.parent;
  }
  return "<module>";
};

const isCurrentProperty = (node: ts.Node): boolean =>
  (ts.isPropertyAccessExpression(node) && node.name.text === "current") ||
  (ts.isElementAccessExpression(node) &&
    node.argumentExpression != null &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === "current");

const isCurrentAssignment = (node: ts.Node): boolean =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  isCurrentProperty(node.left);

const isPureRefMirror = (callback: ts.Expression | undefined): boolean => {
  if (callback == null || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return false;
  }
  if (!ts.isBlock(callback.body)) {
    return isCurrentAssignment(callback.body);
  }
  return (
    callback.body.statements.length > 0 &&
    callback.body.statements.every(
      (statement) =>
        ts.isExpressionStatement(statement) && isCurrentAssignment(statement.expression),
    )
  );
};

const classifyEffect = (
  hook: EffectSite["hook"],
  callback: ts.Expression | undefined,
  callbackText: string,
  dependencyText: string,
): Classification => {
  if (isPureRefMirror(callback)) {
    return {
      category: "ref-mirror",
      disposition: "delete-or-useEffectEvent",
      confidence: "high",
      effectEventCandidate: true,
    };
  }

  const text = `${callbackText}\n${dependencyText}`;
  const hasDomContract =
    hook === "useLayoutEffect" ||
    /\b(?:document|window|ResizeObserver|MutationObserver|IntersectionObserver|getBoundingClientRect|scroll(?:To|IntoView|Top|Left|Height|Width)|client(?:Height|Width)|focus\()\b/u.test(
      text,
    );
  const hasExternalLifecycle =
    /\b(?:addEventListener|removeEventListener|subscribe|unsubscribe|EventSource|WebSocket|setInterval|clearInterval|setTimeout|clearTimeout|requestAnimationFrame|cancelAnimationFrame|AbortController|matchMedia)\b/u.test(
      text,
    );
  const hasRequest =
    /\b(?:fetch|load[A-Z]\w*|refresh[A-Z]\w*|request[A-Z]\w*|reload[A-Z]\w*|poll[A-Z]\w*|invalidate[A-Z]\w*)\b/u.test(
      text,
    );
  const hasPersistence = /\b(?:localStorage|sessionStorage|indexedDB)\b/u.test(text);
  const hasStateWrite = /\b(?:set[A-Z]\w*|dispatch)\s*\(/u.test(callbackText);
  const hasIdentityReset =
    /\b(?:paneId|sessionId|scopeKey|contextKey|repoRoot|worktree|branch)\b/u.test(dependencyText) &&
    (hasStateWrite || /\.current\s*=/u.test(callbackText));

  if (hasExternalLifecycle) {
    return {
      category: "external-sync",
      disposition: "maintain",
      confidence: "high",
      effectEventCandidate: false,
    };
  }
  if (hasDomContract) {
    return {
      category: "dom-layout",
      disposition: "maintain",
      confidence: hook === "useLayoutEffect" ? "high" : "medium",
      effectEventCandidate: false,
    };
  }
  if (hasRequest) {
    return {
      category: "request-bridge",
      disposition: "query",
      confidence: "medium",
      effectEventCandidate: false,
    };
  }
  if (hasPersistence) {
    return {
      category: "event-migration",
      disposition: "event-handler",
      confidence: "medium",
      effectEventCandidate: false,
    };
  }
  if (hasIdentityReset) {
    return {
      category: "identity-reset",
      disposition: "key-reset",
      confidence: "medium",
      effectEventCandidate: false,
    };
  }
  if (hasStateWrite) {
    return {
      category: "derived-state",
      disposition: "render-or-reducer",
      confidence: "low",
      effectEventCandidate: false,
    };
  }
  return {
    category: "external-sync",
    disposition: "review",
    confidence: "low",
    effectEventCandidate: false,
  };
};

const getDependencies = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): EffectSite["dependencies"] => {
  const dependencies = call.arguments[1];
  if (dependencies == null) {
    return "none";
  }
  if (!ts.isArrayLiteralExpression(dependencies)) {
    return "dynamic";
  }
  return dependencies.elements.map((element) => element.getText(sourceFile));
};

const findDirectTests = (sourcePath: string, tests: Set<string>): string[] => {
  const extension = path.posix.extname(sourcePath);
  const base = sourcePath.slice(0, -extension.length);
  return [`${base}.test.ts`, `${base}.test.tsx`, `${base}.spec.ts`, `${base}.spec.tsx`].filter(
    (candidate) => tests.has(candidate),
  );
};

const getReactBindings = (sourceFile: ts.SourceFile) => {
  const hooks = new Map<string, EffectSite["hook"]>();
  const memoHooks = new Map<string, "memo" | "useCallback" | "useMemo">();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "react" ||
      statement.importClause == null
    ) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings == null) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "useEffect" || importedName === "useLayoutEffect") {
        hooks.set(element.name.text, importedName);
      }
      if (importedName === "memo" || importedName === "useMemo" || importedName === "useCallback") {
        memoHooks.set(element.name.text, importedName);
      }
    }
  }
  return { hooks, memoHooks, namespaces };
};

const resolveReactCall = (
  expression: ts.LeftHandSideExpression,
  bindings: ReturnType<typeof getReactBindings>,
): EffectSite["hook"] | "memo" | "useCallback" | "useMemo" | null => {
  if (ts.isIdentifier(expression)) {
    return bindings.hooks.get(expression.text) ?? bindings.memoHooks.get(expression.text) ?? null;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text)
  ) {
    const name = expression.name.text;
    if (
      name === "useEffect" ||
      name === "useLayoutEffect" ||
      name === "useMemo" ||
      name === "useCallback" ||
      name === "memo"
    ) {
      return name;
    }
  }
  return null;
};

const analyzeFile = (file: string, tests: Set<string>, program: Program) => {
  const sourcePath = toRepoPath(file);
  const sourceFile = program.getSourceFile(file);
  if (sourceFile == null) {
    throw new Error(`TypeScript program does not contain ${sourcePath}`);
  }
  const bindings = getReactBindings(sourceFile);
  const effects: SiteDraft[] = [];
  let useMemo = 0;
  let useCallback = 0;
  let memo = 0;
  let visibilityPollingCalls = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const reactCall = resolveReactCall(node.expression, bindings);
      if (reactCall === "useMemo") {
        useMemo += 1;
      } else if (reactCall === "useCallback") {
        useCallback += 1;
      } else if (reactCall === "memo") {
        memo += 1;
      } else if (reactCall === "useEffect" || reactCall === "useLayoutEffect") {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const callback = node.arguments[0];
        const callbackText = callback?.getText(sourceFile) ?? "";
        const dependencies = getDependencies(node, sourceFile);
        const dependencyText = Array.isArray(dependencies) ? dependencies.join(", ") : dependencies;
        const classification = classifyEffect(reactCall, callback, callbackText, dependencyText);
        const effectEventCheck: EffectEventCheck = classification.effectEventCandidate
          ? "manual-review"
          : "not-applicable";
        effects.push({
          file: sourcePath,
          line: position.line + 1,
          column: position.character + 1,
          owner: findOwner(node),
          hook: reactCall,
          dependencies,
          fingerprint: createHash("sha256")
            .update(`${reactCall}\0${callbackText}\0${dependencyText}`)
            .digest("hex")
            .slice(0, 12),
          category: classification.category,
          disposition: classification.disposition,
          confidence: classification.confidence,
          effectEvent: {
            readsLatestReactiveValuesInsideCallback: effectEventCheck,
            callbackIdentityIsNotSubscriptionContract: effectEventCheck,
            effectEventIsNotExported: effectEventCheck,
          },
          testEvidence: {
            adjacentFiles: findDirectTests(sourcePath, tests),
            behaviorVerified: false,
          },
          preview: callbackText.replaceAll(/\s+/gu, " ").slice(0, 180),
        });
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "useVisibilityPolling") {
        visibilityPollingCalls += 1;
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return { effects, useMemo, useCallback, memo, visibilityPollingCalls };
};

const countMatches = (texts: string[], pattern: RegExp): number =>
  texts.reduce((total, text) => total + [...text.matchAll(pattern)].length, 0);

const collectOxlintDisableRules = (texts: string[]): string[] => {
  const lineDirective = /\/\/[^\n]*\boxlint-disable(?:-next-line|-line)?\b[^\n]*/gu;
  const blockDirective =
    /\/\*(?:(?!\*\/)[\s\S])*?\boxlint-disable(?:-next-line|-line)?\b(?:(?!\*\/)[\s\S])*?\*\//gu;
  return texts.flatMap((text) =>
    [...text.matchAll(lineDirective), ...text.matchAll(blockDirective)].map(
      (match) => match[0].split(/\s+--\s+/u, 1)[0]!,
    ),
  );
};

const getStableSelector = (site: SiteDraft, sites: SiteDraft[]): string => {
  const duplicateOrdinal =
    sites.filter(
      (candidate) =>
        candidate.file === site.file &&
        candidate.owner === site.owner &&
        candidate.hook === site.hook &&
        candidate.fingerprint === site.fingerprint &&
        (candidate.line < site.line ||
          (candidate.line === site.line && candidate.column <= site.column)),
    ).length || 1;
  return `${site.file}::${site.owner}::${site.hook}::${site.fingerprint}::${duplicateOrdinal}`;
};

const resolveReviewedSelector = (selector: string, sites: SiteDraft[]): SiteDraft => {
  const matches = sites.filter((site) => getStableSelector(site, sites) === selector);
  if (matches.length !== 1) {
    throw new Error(
      `Stable reviewed Effect selector must match exactly once: ${selector} (${matches.length})`,
    );
  }
  return matches[0]!;
};

const applyReviewedClassifications = (sites: SiteDraft[]): SiteDraft[] => {
  const categoryBySite = new Map<string, EffectCategory>();
  const siteKey = (site: SiteDraft): string => getStableSelector(site, sites);
  for (const [category, selectors] of Object.entries(reviewedEffectClassifications) as [
    EffectCategory,
    readonly string[],
  ][]) {
    for (const selector of selectors) {
      const site = resolveReviewedSelector(selector, sites);
      const key = siteKey(site);
      if (categoryBySite.has(key)) {
        throw new Error(`Effect site has multiple reviewed categories: ${key}`);
      }
      categoryBySite.set(key, category);
    }
  }
  if (categoryBySite.size !== sites.length) {
    const missing = sites.filter((site) => !categoryBySite.has(siteKey(site))).map(siteKey);
    throw new Error(`Reviewed Effect inventory is incomplete: ${missing.join(", ")}`);
  }

  const resolveSelectorSet = (selectors: readonly string[]): Set<string> =>
    new Set(selectors.map((selector) => siteKey(resolveReviewedSelector(selector, sites))));
  const effectEventCandidates = resolveSelectorSet(reviewedUseEffectEventCandidates);
  const refMirrorEventMigration = resolveSelectorSet(reviewedRefMirrorEventMigration);
  const retainedDerivedStateEffects = resolveSelectorSet(reviewedRetainedDerivedStateEffects);
  const retainedIdentityEffects = resolveSelectorSet(reviewedRetainedIdentityEffects);

  return sites.map((site) => {
    const key = siteKey(site);
    const category = categoryBySite.get(key)!;
    const effectEventCandidate = effectEventCandidates.has(key);
    const disposition: EffectDisposition = (() => {
      if (category === "external-sync" || category === "dom-layout") {
        return "maintain";
      }
      if (category === "request-bridge") {
        return "query";
      }
      if (category === "event-migration" || refMirrorEventMigration.has(key)) {
        return "event-handler";
      }
      if (category === "derived-state") {
        return retainedDerivedStateEffects.has(key) ? "maintain" : "render-or-reducer";
      }
      if (category === "identity-reset") {
        return retainedIdentityEffects.has(key) ? "maintain" : "key-reset";
      }
      return effectEventCandidate ? "delete-or-useEffectEvent" : "maintain";
    })();
    const effectEventCheck: EffectEventCheck = effectEventCandidate
      ? "yes"
      : category === "ref-mirror"
        ? "no"
        : "not-applicable";
    return {
      ...site,
      category,
      disposition,
      confidence: "high",
      effectEvent: {
        readsLatestReactiveValuesInsideCallback: effectEventCheck,
        callbackIdentityIsNotSubscriptionContract: effectEventCheck,
        effectEventIsNotExported: effectEventCheck,
      },
    };
  });
};

export const buildArchitectureReport = (): ArchitectureReport => {
  const api = new API({ cwd: repoRoot });
  const tsConfigPath = path.join(repoRoot, "apps/web/tsconfig.json");
  const snapshot = api.updateSnapshot({ openProjects: [tsConfigPath] });
  const project = snapshot.getProject(tsConfigPath);
  if (project == null) {
    snapshot.dispose();
    api.close();
    throw new Error(`TypeScript project did not load: ${tsConfigPath}`);
  }
  const allFiles = collectFiles(webSourceRoot).filter((file) => sourcePattern.test(file));
  const productionFiles = allFiles.filter(isProductionSource);
  const tests = new Set(allFiles.filter((file) => !isProductionSource(file)).map(toRepoPath));
  const texts = productionFiles.map((file) => readFileSync(file, "utf8"));
  const oxlintDisableRules = collectOxlintDisableRules(texts);
  const results = productionFiles.map((file) => analyzeFile(file, tests, project.program));
  const inventory = applyReviewedClassifications(
    results
      .flatMap((result) => result.effects)
      .sort((left, right) =>
        left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
      ),
  ).map((site, index) => ({ ...site, id: `E${String(index + 1).padStart(3, "0")}` }));
  const categories: EffectCategory[] = [
    "derived-state",
    "dom-layout",
    "event-migration",
    "external-sync",
    "identity-reset",
    "ref-mirror",
    "request-bridge",
  ];
  const classificationSummary = Object.fromEntries(
    categories.map((category) => [
      category,
      inventory.filter((site) => site.category === category).length,
    ]),
  ) as Record<EffectCategory, number>;
  const isSessionDetailOrLib = (file: string): boolean =>
    file.startsWith(path.join(webSourceRoot, "pages/SessionDetail")) ||
    file.startsWith(path.join(webSourceRoot, "lib"));
  const ownershipFiles = [
    "apps/web/src/pages/SessionDetail/SessionDetailProvider.tsx",
    "apps/web/src/pages/SessionDetail/SessionDetailView.tsx",
    "apps/web/src/pages/SessionDetail/hooks/useSessionDetailViewDataSectionProps.ts",
    "apps/web/src/pages/SessionDetail/hooks/useSessionDetailViewExplorerSectionProps.ts",
    "apps/web/src/pages/SessionDetail/hooks/useSessionDetailViewShellSectionProps.ts",
    "apps/web/src/pages/SessionDetail/hooks/useSessionDetailViewWorktreeBranchSectionProps.ts",
  ];
  const sessionDetailOwnershipLines = ownershipFiles.reduce((total, file) => {
    const absolutePath = path.join(repoRoot, file);
    return existsSync(absolutePath)
      ? total + readFileSync(absolutePath, "utf8").split("\n").length - 1
      : total;
  }, 0);
  const sessionFilesHookLineCounts = productionFiles
    .filter((file) => {
      const repoPath = toRepoPath(file);
      const name = path.basename(file);
      return (
        repoPath.startsWith("apps/web/src/pages/SessionDetail/hooks/") &&
        (name.startsWith("useSessionFiles") || name.startsWith("session-files-"))
      );
    })
    .map((file) => readFileSync(file, "utf8").split("\n").length - 1);
  const sessionFilesHookFamilyLines = sessionFilesHookLineCounts.reduce(
    (total, lines) => total + lines,
    0,
  );
  const largestSessionFilesHookModuleLines = Math.max(0, ...sessionFilesHookLineCounts);
  const limits: ArchitectureReport["limits"] = {
    sessionFilesHookFamilyLines: 2450,
    largestSessionFilesHookModuleLines: 1000,
  };
  if (sessionFilesHookFamilyLines > limits.sessionFilesHookFamilyLines) {
    throw new Error(
      `Session files hook family exceeds ${limits.sessionFilesHookFamilyLines} lines: ${sessionFilesHookFamilyLines}`,
    );
  }
  if (largestSessionFilesHookModuleLines > limits.largestSessionFilesHookModuleLines) {
    throw new Error(
      `Largest session files hook module exceeds ${limits.largestSessionFilesHookModuleLines} lines: ${largestSessionFilesHookModuleLines}`,
    );
  }

  const report: ArchitectureReport = {
    schemaVersion: 1,
    scope: {
      root: "apps/web/src",
      productionExtensions: [".ts", ".tsx"],
      excluded: ["*.test.*", "*.spec.*", "__tests__"],
    },
    metrics: {
      productionFiles: productionFiles.length,
      useEffect: inventory.filter((site) => site.hook === "useEffect").length,
      useLayoutEffect: inventory.filter((site) => site.hook === "useLayoutEffect").length,
      effectTotal: inventory.length,
      sessionDetailEffects: inventory.filter((site) =>
        site.file.startsWith("apps/web/src/pages/SessionDetail/"),
      ).length,
      useMemo: results.reduce((total, result) => total + result.useMemo, 0),
      useCallback: results.reduce((total, result) => total + result.useCallback, 0),
      memo: results.reduce((total, result) => total + result.memo, 0),
      sessionDetailAndLibUseMemo: results.reduce(
        (total, result, index) =>
          total + (isSessionDetailOrLib(productionFiles[index]!) ? result.useMemo : 0),
        0,
      ),
      sessionDetailAndLibUseCallback: results.reduce(
        (total, result, index) =>
          total + (isSessionDetailOrLib(productionFiles[index]!) ? result.useCallback : 0),
        0,
      ),
      visibilityPollingCallerFiles: results.filter(
        (result, index) =>
          result.visibilityPollingCalls > 0 &&
          toRepoPath(productionFiles[index]!) !== "apps/web/src/lib/use-visibility-polling.ts",
      ).length,
      sessionDetailOwnershipLines,
      sessionFilesHookFamilyLines,
      largestSessionFilesHookModuleLines,
      reactOxlintDisable: oxlintDisableRules.filter((rules) => /\breact(?:\/|\b)/u.test(rules))
        .length,
      reactDoctorDisable: countMatches(texts, /react-doctor-disable/gu),
      exhaustiveDepsSuppression: oxlintDisableRules.filter((rules) =>
        /\breact\/exhaustive-deps\b/u.test(rules),
      ).length,
      useNoMemoDirective: countMatches(texts, /["']use no memo["']/gu),
    },
    limits,
    classificationSummary,
    inventory,
  };
  snapshot.dispose();
  api.close();
  return report;
};

const parseOutputPath = (flag: "--check" | "--write"): string | null => {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (value == null || value.startsWith("--")) {
    throw new Error(`${flag} requires a file path`);
  }
  return path.resolve(repoRoot, value);
};

const main = (): void => {
  const report = buildArchitectureReport();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const writePath = parseOutputPath("--write");
  const checkPath = parseOutputPath("--check");
  if (writePath != null && checkPath != null) {
    throw new Error("--write and --check cannot be used together");
  }
  if (writePath != null) {
    writeFileSync(writePath, serialized);
    console.log(`Wrote ${path.relative(repoRoot, writePath)}`);
    return;
  }
  if (checkPath != null) {
    const baseline = JSON.parse(readFileSync(checkPath, "utf8")) as ArchitectureReport;
    if (JSON.stringify(baseline) !== JSON.stringify(report)) {
      console.error(`React architecture baseline is stale: ${path.relative(repoRoot, checkPath)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`React architecture baseline is current: ${path.relative(repoRoot, checkPath)}`);
    return;
  }
  if (process.argv.includes("--json")) {
    process.stdout.write(serialized);
    return;
  }
  console.log(
    JSON.stringify(
      { metrics: report.metrics, classification: report.classificationSummary },
      null,
      2,
    ),
  );
};

if (
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  main();
}
