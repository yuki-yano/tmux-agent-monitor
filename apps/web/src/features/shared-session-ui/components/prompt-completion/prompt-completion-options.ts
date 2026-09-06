import type {
  PromptCompletionItem,
  PromptCompletionResult,
  PromptCompletionTrigger,
  RepoFileSearchPage,
} from "@vde-monitor/shared";

import type { PromptCompletionTokenTrigger } from "./prompt-completion-token";

export type PromptCompletionOption = Omit<PromptCompletionItem, "kind"> & {
  trigger: PromptCompletionTokenTrigger;
  kind: PromptCompletionItem["kind"] | "file";
};

export type PromptCompletionConfig = {
  agent: "codex" | "claude" | "unknown";
  paneId: string;
  requestPromptCompletions: (
    paneId: string,
    trigger: PromptCompletionTrigger,
    query?: string,
  ) => Promise<PromptCompletionResult>;
  requestRepoFileSearch: (
    paneId: string,
    query: string,
    options?: { limit?: number },
  ) => Promise<RepoFileSearchPage>;
};

const MAX_FILE_OPTIONS = 5;

const toAgentOptions = (
  items: PromptCompletionItem[],
  trigger: PromptCompletionTokenTrigger,
): PromptCompletionOption[] => items.map((item) => ({ ...item, trigger }));

const toFileOptions = (page: RepoFileSearchPage): PromptCompletionOption[] =>
  page.items.slice(0, MAX_FILE_OPTIONS).map((item) => ({
    id: `file:${item.path}`,
    label: item.path,
    insertText: item.path,
    description: item.kind === "directory" ? "Directory" : "Repository file",
    argumentHint: "",
    kind: "file",
    scope: item.kind,
    trigger: "at",
  }));

export const loadPromptCompletionOptions = async (
  { paneId, agent, requestPromptCompletions, requestRepoFileSearch }: PromptCompletionConfig,
  trigger: PromptCompletionTokenTrigger,
  query: string,
): Promise<PromptCompletionOption[]> => {
  if (trigger === "at" && agent === "codex") {
    const [pluginResult, fileResult] = await Promise.all([
      requestPromptCompletions(paneId, "at", query),
      query ? requestRepoFileSearch(paneId, query, { limit: MAX_FILE_OPTIONS }) : null,
    ]);
    return [
      ...toAgentOptions(pluginResult.items, "at"),
      ...(fileResult ? toFileOptions(fileResult) : []),
    ];
  }
  if (trigger === "at") {
    return toFileOptions(await requestRepoFileSearch(paneId, query, { limit: MAX_FILE_OPTIONS }));
  }
  return toAgentOptions((await requestPromptCompletions(paneId, trigger, query)).items, trigger);
};
