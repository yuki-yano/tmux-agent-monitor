import path from "node:path";

import { describe, expect, it } from "vitest";

import { shouldTransformReactCompilerVitestModule } from "./react-compiler-vitest";

const sourceFile = (relativePath: string): string => path.join(import.meta.dirname, relativePath);

describe("React Compiler Vitest module selection", () => {
  it.each(["src/Component.test.tsx", "src/helper.spec.ts", "src/__tests__/Component.tsx"])(
    "excludes test module %s",
    (relativePath) => {
      const id = `${sourceFile(relativePath)}?v=1`;

      expect(shouldTransformReactCompilerVitestModule(id)).toBe(false);
    },
  );

  it("selects production and compiler contract modules", () => {
    const id = sourceFile("src/Component.tsx");

    expect(shouldTransformReactCompilerVitestModule(id)).toBe(true);
    expect(
      shouldTransformReactCompilerVitestModule(
        sourceFile("test/compiler-contract/CompilerContractUnannotated.tsx"),
      ),
    ).toBe(true);
  });
});
