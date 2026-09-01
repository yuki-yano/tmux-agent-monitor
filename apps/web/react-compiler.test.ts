import { describe, expect, it } from "vitest";

import {
  REACT_COMPILER_PRODUCTION_MODE,
  REACT_COMPILER_PRODUCTION_PANIC_THRESHOLD,
  assertReactCompilerRequiredCompileSuccesses,
  reactCompilerRequiredCompileSuccesses,
} from "./react-compiler";

const validArtifact = () => ({
  requiredCompileSuccesses: [...reactCompilerRequiredCompileSuccesses],
  successes: reactCompilerRequiredCompileSuccesses.map(({ file, symbol }) => ({ file, symbol })),
  failures: [],
});

describe("React Compiler production contract", () => {
  it("uses the infer production settings and tracks every cleanup owner", () => {
    expect(REACT_COMPILER_PRODUCTION_MODE).toBe("infer");
    expect(REACT_COMPILER_PRODUCTION_PANIC_THRESHOLD).toBe("none");
    expect(reactCompilerRequiredCompileSuccesses).toHaveLength(19);
    expect(() => assertReactCompilerRequiredCompileSuccesses(validArtifact())).not.toThrow();
  });

  it("allows unrelated infer outcomes", () => {
    expect(() =>
      assertReactCompilerRequiredCompileSuccesses({
        ...validArtifact(),
        successes: [
          ...validArtifact().successes,
          { file: "apps/web/src/Additional.tsx", symbol: "Additional" },
          { file: null, symbol: null },
        ],
        failures: [{ file: "apps/web/src/Additional.tsx", kind: "CompileError" }],
      }),
    ).not.toThrow();
  });

  it("rejects missing, duplicate, or repeated required successes", () => {
    const firstRequired = reactCompilerRequiredCompileSuccesses[0]!;
    expect(() =>
      assertReactCompilerRequiredCompileSuccesses({
        ...validArtifact(),
        successes: validArtifact().successes.slice(1),
      }),
    ).toThrow(/missing/u);
    expect(() =>
      assertReactCompilerRequiredCompileSuccesses({
        ...validArtifact(),
        requiredCompileSuccesses: [
          ...reactCompilerRequiredCompileSuccesses.slice(0, -1),
          firstRequired,
        ],
      }),
    ).toThrow(/duplicateRequiredCompileSuccesses/u);
    expect(() =>
      assertReactCompilerRequiredCompileSuccesses({
        ...validArtifact(),
        successes: [...validArtifact().successes, firstRequired],
      }),
    ).toThrow(/duplicateSuccesses/u);
    expect(() =>
      assertReactCompilerRequiredCompileSuccesses({
        ...validArtifact(),
        failures: [{ file: firstRequired.file, kind: "CompileError" }],
      }),
    ).toThrow(/blockingFailures/u);
  });
});
