import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaneTextComposer } from "@/features/shared-session-ui/components/PaneTextComposer";
import { PromptCompletionTriggerRail } from "@/features/shared-session-ui/components/prompt-completion/PromptCompletionTriggerRail";
import { CommitSection } from "@/pages/SessionDetail/components/CommitSection";
import { ScreenPanel } from "@/pages/SessionDetail/components/ScreenPanel";
import { ScreenPanelViewport } from "@/pages/SessionDetail/components/ScreenPanelViewport";
import { ScreenPanelWorktreeSelectorPanel } from "@/pages/SessionDetail/components/ScreenPanelWorktreeSelectorPanel";
import { SmartScreenViewport } from "@/pages/SessionDetail/components/SmartScreenViewport";
import { WorktreeStatusStack } from "@/pages/SessionDetail/components/WorktreeStatusStack";

import { CompilerContractAnnotated } from "./CompilerContractAnnotated";
import { CompilerContractUnannotated } from "./CompilerContractUnannotated";

void CommitSection;
void PaneTextComposer;
void PromptCompletionTriggerRail;
void ScreenPanel;
void ScreenPanelViewport;
void ScreenPanelWorktreeSelectorPanel;
void SmartScreenViewport;
void WorktreeStatusStack;

describe("React Compiler annotation transform", () => {
  it("compiles all annotated families and leaves the negative fixture uncompiled", async () => {
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
    const manifestKeys = artifact.manifest.map(({ file, symbol }) => `${file}\0${symbol}`);
    const manifestFamilies = new Set(artifact.manifest.map(({ family }) => family));
    const unkeyedSuccesses = artifact.successes.filter(
      ({ file, symbol }) => file == null || symbol == null,
    );

    expect(artifact.compiler).toMatchObject({
      compilationMode: "annotation",
      panicThreshold: "all_errors",
      target: "19",
    });
    expect(artifact.failures).toEqual([]);
    expect(compiledSymbols).toContain("CompilerContractAnnotated");
    expect(compiledSymbols).not.toContain("CompilerContractUnannotated");
    expect(artifact.manifest).toHaveLength(15);
    expect(manifestFamilies).toEqual(new Set(["commit", "composer", "screen"]));
    expect(new Set(manifestKeys).size).toBe(manifestKeys.length);
    expect(unkeyedSuccesses).toEqual([]);
    expect(manifestKeys.filter((key) => compiledPilotKeys.has(key))).toHaveLength(
      artifact.manifest.length,
    );
  });
});
