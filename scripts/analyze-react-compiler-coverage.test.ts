import { describe, expect, it } from "vitest";

import {
  type CompilerCoverageDispositionReview,
  type CompilerEligibilityReport,
  type NormalizedCompilerEvent,
  analyzeCompilerEligibleProjectFile,
  createCompilerCoverageEvidenceTest,
  createCompilerCoverageReport,
  createCompilerCoverageReviewSignatures,
  createCompilerCoverageReviewTemplate,
  createCompilerStructuralFingerprint,
  isCompilerEligibleFunction,
  reconcileCompilerCoverage,
} from "../apps/web/react-compiler-coverage";

const eligibility: CompilerEligibilityReport = {
  schemaVersion: 1,
  scope: {
    root: "apps/web/src",
    productionExtensions: [".ts", ".tsx"],
    excluded: ["*.test.*", "*.spec.*", "__tests__"],
    topLevelOnly: true,
  },
  metrics: { productionFiles: 1, eligible: 2, components: 1, hooks: 1 },
  fingerprint: "fixture",
  inventory: [
    {
      file: "apps/web/src/fixture.tsx",
      symbol: "Fixture",
      kind: "component",
      span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
      fingerprint: "component",
    },
    {
      file: "apps/web/src/fixture.tsx",
      symbol: "useFixture",
      kind: "hook",
      span: { start: { line: 7, column: 0 }, end: { line: 10, column: 1 } },
      fingerprint: "hook",
    },
  ],
};

const event = (kind: NormalizedCompilerEvent["kind"], line: number): NormalizedCompilerEvent => ({
  file: "apps/web/src/fixture.tsx",
  kind,
  fnLocation: { line, column: 2 },
  category: kind === "CompileError" ? "Refs" : null,
  reason: kind === "CompileError" ? "Cannot access refs during render" : null,
  memo:
    kind === "CompileSuccess"
      ? { slots: 1, blocks: 1, values: 1, prunedBlocks: 0, prunedValues: 0 }
      : null,
});

describe("React Compiler coverage", () => {
  it("derives eligibility from the TypeScript project AST", () => {
    expect(
      analyzeCompilerEligibleProjectFile(
        "apps/web/src/__tests__/compiler-eligibility-fixture.tsx",
      ).map(({ symbol }) => symbol),
    ).toEqual(["useActualHook", "Component", "optedInHelper"]);
  });

  it("keeps custom hook eligibility tied to a hook call", () => {
    expect(
      isCompilerEligibleFunction({
        symbol: "useJsxOnly",
        annotated: false,
        createsJsx: true,
        callsHook: false,
      }),
    ).toBe(false);
    expect(
      isCompilerEligibleFunction({
        symbol: "useActualHook",
        annotated: false,
        createsJsx: false,
        callsHook: true,
      }),
    ).toBe(true);
    expect(
      isCompilerEligibleFunction({
        symbol: "optedInHelper",
        annotated: true,
        createsJsx: false,
        callsHook: false,
      }),
    ).toBe(true);
  });

  it("preserves meaningful literal whitespace in the structural fingerprint", () => {
    const fingerprints = ["a b", "a  b"].map((text) =>
      createCompilerStructuralFingerprint(`const Component = () => <div>{\`${text}\`}</div>;`),
    );

    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it("uses the static eligible inventory as the denominator", () => {
    const report = createCompilerCoverageReport(eligibility, [event("CompileSuccess", 1)], "1.0.0");

    expect(report.summary).toMatchObject({ success: 1, noEvent: 1, successRate: 0.5 });
    expect(report.results[1]?.status).toBe("no-event");
  });

  it("gives terminal failures priority while keeping diagnostics orthogonal", () => {
    const report = createCompilerCoverageReport(
      eligibility,
      [
        event("CompileSuccess", 1),
        event("CompileDiagnostic", 2),
        event("CompileError", 3),
        event("CompileSuccess", 7),
      ],
      "1.0.0",
    );

    expect(report.results[0]).toMatchObject({
      status: "bailout",
      events: { success: 1, diagnostic: 1, error: 1 },
      detail: { category: "Refs" },
    });
    expect(report.summary).toMatchObject({ success: 1, bailout: 1, diagnostic: 1 });
  });

  it("selects detail from the event that determines terminal status", () => {
    const pipelineError = {
      ...event("PipelineError", 4),
      category: "PipelineError",
      reason: "Compiler pipeline failed",
    };
    const report = createCompilerCoverageReport(
      eligibility,
      [event("CompileError", 2), pipelineError],
      "1.0.0",
    );

    expect(report.results[0]).toMatchObject({
      status: "pipeline-error",
      detail: { category: "PipelineError", reason: "Compiler pipeline failed" },
      eventDetails: [
        {
          kind: "CompileError",
          category: "Refs",
          reason: "Cannot access refs during render",
        },
        {
          kind: "PipelineError",
          category: "PipelineError",
          reason: "Compiler pipeline failed",
        },
      ],
    });
  });

  it("reports terminal events outside the static inventory", () => {
    const unmatched = event("PipelineError", 20);
    const report = createCompilerCoverageReport(eligibility, [unmatched], "1.0.0");

    expect(report.summary.unmatchedTerminalEvents).toBe(1);
    expect(report.unmatchedEvents).toEqual([unmatched]);
  });

  it("reports diagnostics outside the static inventory independently", () => {
    const unmatched = event("CompileDiagnostic", 20);
    const report = createCompilerCoverageReport(eligibility, [unmatched], "1.0.0");

    expect(report.summary).toMatchObject({
      unmatchedTerminalEvents: 0,
      unmatchedDiagnosticEvents: 1,
    });
    expect(report.unmatchedEvents).toEqual([unmatched]);
  });

  it("requires an exact reviewed disposition for every non-success outcome", () => {
    const report = createCompilerCoverageReport(eligibility, [event("CompileSuccess", 1)], "1.0.0");
    const signatures = createCompilerCoverageReviewSignatures(report, report.results[1]!);
    const reconciled = reconcileCompilerCoverage(report, {
      schemaVersion: 2,
      entries: [
        {
          key: "apps/web/src/fixture.tsx::useFixture",
          status: "no-event",
          type: "accept",
          reason: "Compiler inference intentionally emits no terminal event for this fixture.",
          reviewedAt: "2026-08-25",
          evidenceTests: [
            createCompilerCoverageEvidenceTest("scripts/analyze-react-compiler-coverage.test.ts"),
          ],
          ...signatures,
        },
      ],
    });

    expect(reconciled.summary.unreconciled).toBe(0);
    expect(reconciled.results[1]?.disposition?.type).toBe("accept");
  });

  it("reports malformed review entries with a stable validation error", () => {
    const report = createCompilerCoverageReport(eligibility, [], "1.0.0");
    const malformed = {
      schemaVersion: 2,
      entries: [null],
    } as unknown as CompilerCoverageDispositionReview;

    expect(() => reconcileCompilerCoverage(report, malformed)).toThrow(
      "Invalid React Compiler disposition: <unknown>",
    );
  });

  it("rejects a disposition after its compiler or result context changes", () => {
    const report = createCompilerCoverageReport(eligibility, [event("CompileSuccess", 1)], "1.0.0");
    const signatures = createCompilerCoverageReviewSignatures(report, report.results[1]!);
    const review = {
      schemaVersion: 2 as const,
      entries: [
        {
          key: "apps/web/src/fixture.tsx::useFixture",
          status: "no-event" as const,
          type: "accept" as const,
          reason: "Compiler inference intentionally emits no terminal event for this fixture.",
          reviewedAt: "2026-08-25",
          evidenceTests: [
            createCompilerCoverageEvidenceTest("scripts/analyze-react-compiler-coverage.test.ts"),
          ],
          ...signatures,
        },
      ],
    };

    expect(() =>
      reconcileCompilerCoverage(
        { ...report, compiler: { ...report.compiler, version: "2.0.0" } },
        review,
      ),
    ).toThrow("disposition context is stale");
    expect(() =>
      reconcileCompilerCoverage(
        {
          ...report,
          results: report.results.map((result) =>
            result.symbol === "useFixture" ? { ...result, fingerprint: "changed" } : result,
          ),
        },
        review,
      ),
    ).toThrow("disposition context is stale");
    expect(() =>
      reconcileCompilerCoverage(report, {
        ...review,
        entries: review.entries.map((entry) => ({
          ...entry,
          evidenceTests: entry.evidenceTests.map((test) => ({
            ...test,
            fingerprint: "0".repeat(64),
          })),
        })),
      }),
    ).toThrow("disposition context is stale");
  });

  it("emits a fail-closed review template for stale context", () => {
    const report = createCompilerCoverageReport(eligibility, [event("CompileSuccess", 1)], "1.0.0");
    const signatures = createCompilerCoverageReviewSignatures(report, report.results[1]!);
    const review = {
      schemaVersion: 2 as const,
      entries: [
        {
          key: "apps/web/src/fixture.tsx::useFixture",
          status: "no-event" as const,
          type: "accept" as const,
          reason: "Compiler inference emits no terminal event for this fixture.",
          reviewedAt: "2026-08-25",
          evidenceTests: [
            createCompilerCoverageEvidenceTest("scripts/analyze-react-compiler-coverage.test.ts"),
          ],
          ...signatures,
        },
      ],
    };
    const changedReport = {
      ...report,
      results: report.results.map((result) =>
        result.symbol === "useFixture" ? { ...result, fingerprint: "changed" } : result,
      ),
    };
    const template = createCompilerCoverageReviewTemplate(changedReport, review);

    expect(template.entries[0]).toMatchObject({
      key: "apps/web/src/fixture.tsx::useFixture",
      type: "accept",
      reviewedAt: "REVIEW_REQUIRED",
      evidenceTests: review.entries[0]?.evidenceTests,
    });
    expect(template.entries[0]?.resultSignature).not.toBe(signatures.resultSignature);
  });

  it("binds review context to every reported compiler error detail", () => {
    const firstError = event("CompileError", 1);
    const report = createCompilerCoverageReport(
      eligibility,
      [firstError, { ...firstError, reason: "Secondary compiler reason" }],
      "1.0.0",
    );
    const changedReport = createCompilerCoverageReport(
      eligibility,
      [firstError, { ...firstError, reason: "Changed secondary reason" }],
      "1.0.0",
    );

    expect(
      createCompilerCoverageReviewSignatures(report, report.results[0]!).resultSignature,
    ).not.toBe(
      createCompilerCoverageReviewSignatures(changedReport, changedReport.results[0]!)
        .resultSignature,
    );
  });
});
