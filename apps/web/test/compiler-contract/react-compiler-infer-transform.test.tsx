import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaneTextComposer } from "@/features/shared-session-ui/components/PaneTextComposer";
import { PromptCompletionList } from "@/features/shared-session-ui/components/prompt-completion/PromptCompletionList";
import { PromptCompletionTriggerRail } from "@/features/shared-session-ui/components/prompt-completion/PromptCompletionTriggerRail";
import { ScreenPanel } from "@/pages/SessionDetail/components/ScreenPanel";
import { ScreenPanelViewport } from "@/pages/SessionDetail/components/ScreenPanelViewport";
import { SmartScreenViewport } from "@/pages/SessionDetail/components/SmartScreenViewport";
import { useScreenFetch } from "@/pages/SessionDetail/hooks/useScreenFetch";

import { CompilerContractUnannotated } from "./CompilerContractUnannotated";

void PaneTextComposer;
void PromptCompletionList;
void PromptCompletionTriggerRail;
void ScreenPanel;
void ScreenPanelViewport;
void SmartScreenViewport;
void useScreenFetch;

const inferSymbolSentinels = [
  {
    file: "apps/web/src/features/shared-session-ui/components/prompt-completion/PromptCompletionList.tsx",
    symbol: "PromptCompletionList",
  },
  {
    file: "apps/web/src/pages/SessionDetail/components/ScreenPanelViewport.tsx",
    symbol: "ScreenPanelViewport",
  },
  {
    file: "apps/web/test/compiler-contract/CompilerContractUnannotated.tsx",
    symbol: "CompilerContractUnannotated",
  },
] as const;

const useScreenFetchFile = "apps/web/src/pages/SessionDetail/hooks/useScreenFetch.ts";
const inferCompiledFiles = new Set<string>([
  ...inferSymbolSentinels.map(({ file }) => file),
  "apps/web/src/features/shared-session-ui/components/PaneTextComposer.tsx",
  "apps/web/src/pages/SessionDetail/components/ScreenPanel.tsx",
  "apps/web/src/pages/SessionDetail/components/SmartScreenViewport.tsx",
]);

describe("React Compiler infer transform", () => {
  it("compiles annotated and unannotated critical sentinels", async () => {
    expect(renderToStaticMarkup(<CompilerContractUnannotated value={3} />)).toBe("<span>9</span>");
    expect(CompilerContractUnannotated.toString()).toContain("const $");

    const { default: artifact } = await import("virtual:react-compiler-artifact");
    const successKeys = new Set(
      artifact.successes.flatMap(({ file, symbol }) =>
        file == null || symbol == null ? [] : [`${file}\0${symbol}`],
      ),
    );
    expect(artifact.compiler).toMatchObject({
      compilationMode: "infer",
      panicThreshold: "none",
      target: "19",
    });
    for (const { file, symbol } of inferSymbolSentinels) {
      const key = `${file}\0${symbol}`;
      expect(successKeys, key).toContain(key);
    }
    expect(PaneTextComposer.toString()).toContain("const $");
    expect(SmartScreenViewport.toString()).toContain("const $");
    expect((ScreenPanel as typeof ScreenPanel & { type: () => unknown }).type.toString()).toContain(
      "const $",
    );
    expect(
      artifact.failures.filter(({ file }) => file != null && inferCompiledFiles.has(file)),
    ).toEqual([]);
    expect(artifact.failures.filter(({ file }) => file === useScreenFetchFile)).toEqual([
      { file: useScreenFetchFile, kind: "CompileError" },
    ]);
  });
});
