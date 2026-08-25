import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  type CompilerCoverageDispositionReview,
  buildCompilerCoverageReport,
  buildCompilerEligibilityReport,
  createCompilerCoverageReviewTemplate,
  reconcileCompilerCoverage,
} from "../apps/web/react-compiler-coverage.ts";
import { reactCompilerPilotManifest } from "../apps/web/react-compiler.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const eligibilityPath = path.join(repoRoot, "scripts/react-compiler-eligible-baseline.json");
const coveragePath = path.join(repoRoot, "scripts/react-compiler-coverage-baseline.json");
const dispositionPath = path.join(repoRoot, "scripts/react-compiler-bailout-review.json");

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const assertCurrent = (file: string, current: unknown): void => {
  if (!existsSync(file)) throw new Error(`Missing baseline: ${path.relative(repoRoot, file)}`);
  const baseline = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (JSON.stringify(baseline) !== JSON.stringify(current)) {
    throw new Error(`React Compiler baseline is stale: ${path.relative(repoRoot, file)}`);
  }
};

const main = async (): Promise<void> => {
  const eligibility = buildCompilerEligibilityReport();
  const dispositionReview = JSON.parse(
    readFileSync(dispositionPath, "utf8"),
  ) as CompilerCoverageDispositionReview;
  const rawCoverage = await buildCompilerCoverageReport(eligibility, reactCompilerPilotManifest);
  if (process.argv.includes("--review-template")) {
    process.stdout.write(
      serialize(createCompilerCoverageReviewTemplate(rawCoverage, dispositionReview)),
    );
    return;
  }
  const coverage = reconcileCompilerCoverage(rawCoverage, dispositionReview);
  if (process.argv.includes("--write")) {
    writeFileSync(eligibilityPath, serialize(eligibility));
    writeFileSync(coveragePath, serialize(coverage));
    console.log("Wrote React Compiler eligibility and coverage baselines");
    return;
  }
  if (process.argv.includes("--check")) {
    assertCurrent(eligibilityPath, eligibility);
    assertCurrent(coveragePath, coverage);
    if (coverage.summary.successRate < 0.9) {
      throw new Error(`React Compiler coverage is below 90%: ${coverage.summary.successRate}`);
    }
    if (
      coverage.summary.skip > 0 ||
      coverage.summary.pipelineError > 0 ||
      coverage.summary.unmatchedTerminalEvents > 0 ||
      coverage.summary.unmatchedDiagnosticEvents > 0 ||
      coverage.summary.unreconciled > 0 ||
      coverage.annotatedManifest.success !== coverage.annotatedManifest.total
    ) {
      throw new Error(
        `React Compiler coverage has blocking outcomes: ${JSON.stringify(coverage.summary)}`,
      );
    }
    console.log(
      `React Compiler coverage is current: ${coverage.summary.success}/${eligibility.metrics.eligible} (${(coverage.summary.successRate * 100).toFixed(2)}%)`,
    );
    return;
  }
  if (process.argv.includes("--json")) {
    process.stdout.write(serialize({ eligibility, coverage }));
    return;
  }
  console.log(
    JSON.stringify({ eligibility: eligibility.metrics, coverage: coverage.summary }, null, 2),
  );
};

await main();
