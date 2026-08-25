import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommitSection } from "@/pages/SessionDetail/components/CommitSection";

import { CompilerContractAnnotated } from "./CompilerContractAnnotated";
import { CompilerContractUnannotated } from "./CompilerContractUnannotated";

void CommitSection;

describe("React Compiler annotation transform", () => {
  it("compiles annotated symbols and leaves the negative fixture uncompiled", async () => {
    expect(renderToStaticMarkup(<CompilerContractAnnotated value={2} />)).toBe("<span>4</span>");
    expect(renderToStaticMarkup(<CompilerContractUnannotated value={3} />)).toBe("<span>9</span>");
    expect(CompilerContractAnnotated.toString()).toContain("const $ =");
    expect(CompilerContractUnannotated.toString()).not.toContain("const $ =");

    const { default: artifact } = await import("virtual:react-compiler-artifact");
    const compiledSymbols = new Set(artifact.successes.map(({ symbol }) => symbol));
    const compiledPilotKeys = new Set(
      artifact.successes.flatMap(({ file, symbol }) =>
        file == null || symbol == null ? [] : [`${file}\0${symbol}`],
      ),
    );

    expect(artifact.compiler).toMatchObject({
      compilationMode: "annotation",
      panicThreshold: "all_errors",
      target: "19",
    });
    expect(artifact.failures).toEqual([]);
    expect(compiledSymbols).toContain("CompilerContractAnnotated");
    expect(compiledSymbols).not.toContain("CompilerContractUnannotated");
    expect(
      artifact.manifest
        .map(({ file, symbol }) => `${file}\0${symbol}`)
        .filter((key) => compiledPilotKeys.has(key)),
    ).toHaveLength(artifact.manifest.length);
  });
});
