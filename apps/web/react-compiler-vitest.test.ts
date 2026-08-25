import path from "node:path";

import { describe, expect, it } from "vitest";

import { createReactCompilerCollector } from "./react-compiler";
import { shouldTransformReactCompilerVitestModule } from "./react-compiler-vitest";

const sourceFile = (relativePath: string): string => path.join(import.meta.dirname, relativePath);

describe("React Compiler Vitest module selection", () => {
  const annotationCollector = createReactCompilerCollector("vitest", "annotation");
  const inferCollector = createReactCompilerCollector("vitest", "infer");

  it.each(["src/Component.test.tsx", "src/helper.spec.ts", "src/__tests__/Component.tsx"])(
    "excludes test module %s in both modes",
    (relativePath) => {
      const id = `${sourceFile(relativePath)}?v=1`;

      expect(shouldTransformReactCompilerVitestModule('"use memo";', id, annotationCollector)).toBe(
        false,
      );
      expect(
        shouldTransformReactCompilerVitestModule("export const value = 1;", id, inferCollector),
      ).toBe(false);
    },
  );

  it("selects annotated modules in annotation mode and all production modules in infer mode", () => {
    const id = sourceFile("src/Component.tsx");

    expect(shouldTransformReactCompilerVitestModule('"use memo";', id, annotationCollector)).toBe(
      true,
    );
    expect(
      shouldTransformReactCompilerVitestModule("export const value = 1;", id, annotationCollector),
    ).toBe(false);
    expect(
      shouldTransformReactCompilerVitestModule("export const value = 1;", id, inferCollector),
    ).toBe(true);
  });

  it("selects unannotated compiler contract fixtures in annotation mode", () => {
    expect(
      shouldTransformReactCompilerVitestModule(
        "export const value = 1;",
        sourceFile("test/compiler-contract/CompilerContractUnannotated.tsx"),
        annotationCollector,
      ),
    ).toBe(true);
  });
});
