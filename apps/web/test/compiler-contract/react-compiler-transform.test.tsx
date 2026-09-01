import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaneTextComposer } from "@/features/shared-session-ui/components/PaneTextComposer";
import { PromptCompletionList } from "@/features/shared-session-ui/components/prompt-completion/PromptCompletionList";
import { PromptCompletionTriggerRail } from "@/features/shared-session-ui/components/prompt-completion/PromptCompletionTriggerRail";
import { CommitSection } from "@/pages/SessionDetail/components/CommitSection";
import { ScreenPanel } from "@/pages/SessionDetail/components/ScreenPanel";
import { ScreenPanelViewport } from "@/pages/SessionDetail/components/ScreenPanelViewport";
import { ScreenPanelWorktreeSelectorPanel } from "@/pages/SessionDetail/components/ScreenPanelWorktreeSelectorPanel";
import { SmartScreenViewport } from "@/pages/SessionDetail/components/SmartScreenViewport";
import { WorktreeStatusStack } from "@/pages/SessionDetail/components/WorktreeStatusStack";
import { useScreenFetch } from "@/pages/SessionDetail/hooks/useScreenFetch";

import { reactCompilerRequiredCompileSuccesses } from "../../react-compiler";
import { CompilerContractUnannotated } from "./CompilerContractUnannotated";

void CommitSection;
void PaneTextComposer;
void PromptCompletionList;
void PromptCompletionTriggerRail;
void ScreenPanel;
void ScreenPanelViewport;
void ScreenPanelWorktreeSelectorPanel;
void SmartScreenViewport;
void WorktreeStatusStack;
void useScreenFetch;

const useScreenFetchFile = "apps/web/src/pages/SessionDetail/hooks/useScreenFetch.ts";
const blockingFailureKinds = new Set(["CompileError", "CompileSkip", "PipelineError"]);

describe("React Compiler infer transform", () => {
  it("compiles every cleanup owner and preserves the accepted bailout", async () => {
    expect(renderToStaticMarkup(<CompilerContractUnannotated value={3} />)).toBe("<span>9</span>");
    expect(CompilerContractUnannotated.toString()).toContain("const $");

    const { default: artifact } = await import("virtual:react-compiler-artifact");
    const successCounts = new Map<string, number>();
    for (const { file, symbol } of artifact.successes) {
      if (file == null || symbol == null) continue;
      const key = `${file}\0${symbol}`;
      successCounts.set(key, (successCounts.get(key) ?? 0) + 1);
    }
    const requiredKeys = reactCompilerRequiredCompileSuccesses.map(
      ({ file, symbol }) => `${file}\0${symbol}`,
    );
    const requiredFiles = new Set<string>(
      reactCompilerRequiredCompileSuccesses.map(({ file }) => file),
    );

    expect(artifact.compiler).toMatchObject({
      compilationMode: "infer",
      panicThreshold: "none",
      target: "19",
    });
    expect(new Set(requiredKeys).size).toBe(requiredKeys.length);
    expect(requiredKeys.filter((key) => !successCounts.has(key))).toEqual([]);
    expect(
      artifact.failures.filter(
        ({ file, kind }) =>
          file != null && requiredFiles.has(file) && blockingFailureKinds.has(kind),
      ),
    ).toEqual([]);
    expect(artifact.failures.filter(({ file }) => file === useScreenFetchFile)).toEqual([
      { file: useScreenFetchFile, kind: "CompileError" },
    ]);
  });
});
