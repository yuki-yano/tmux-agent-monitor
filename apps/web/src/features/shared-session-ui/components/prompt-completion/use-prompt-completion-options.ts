import { useCallback, useEffect, useState } from "react";

import {
  type PromptCompletionConfig,
  type PromptCompletionOption,
  loadPromptCompletionOptions,
} from "./prompt-completion-options";
import type { PromptCompletionTokenTrigger } from "./prompt-completion-token";

const FILE_SEARCH_DEBOUNCE_MS = 150;

const createOptionsState = (scopeKey: string | null) => ({
  scopeKey,
  options: [] as PromptCompletionOption[],
  loading: false,
  error: null as string | null,
});

export const usePromptCompletionOptions = ({
  scopeKey,
  config,
  trigger,
  query,
  resetSelection,
}: {
  scopeKey: string | null;
  config: PromptCompletionConfig | null;
  trigger: PromptCompletionTokenTrigger | undefined;
  query: string;
  resetSelection: () => void;
}) => {
  const [state, setState] = useState(() => createOptionsState(scopeKey));
  const current = state.scopeKey === scopeKey ? state : createOptionsState(scopeKey);
  if (current !== state) {
    setState(current);
  }
  const paneId = config?.paneId;
  const agent = config?.agent;
  const requestPromptCompletions = config?.requestPromptCompletions;
  const requestRepoFileSearch = config?.requestRepoFileSearch;

  useEffect(() => {
    resetSelection();
    const next = createOptionsState(scopeKey);
    const canRequest =
      scopeKey != null &&
      paneId &&
      agent &&
      requestPromptCompletions &&
      requestRepoFileSearch &&
      trigger &&
      !(trigger === "at" && query.length === 0 && agent !== "codex");
    // oxlint-disable-next-line react/set-state-in-effect -- A new async request clears stale choices before its response arrives.
    setState({ ...next, loading: !!canRequest });
    if (!canRequest) {
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const options = await loadPromptCompletionOptions(
          { paneId, agent, requestPromptCompletions, requestRepoFileSearch },
          trigger,
          query,
        );
        if (active) {
          setState({ ...next, options });
          resetSelection();
        }
      } catch {
        if (active) {
          setState({ ...next, error: "Failed to load suggestions." });
        }
      }
    };
    const timeout = setTimeout(() => void load(), trigger === "at" ? FILE_SEARCH_DEBOUNCE_MS : 0);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [
    agent,
    paneId,
    query,
    requestPromptCompletions,
    requestRepoFileSearch,
    resetSelection,
    scopeKey,
    trigger,
  ]);

  const clearOptions = useCallback(() => {
    setState((previous) => ({ ...previous, options: [] }));
  }, []);

  return {
    options: current.options,
    loading: current.loading,
    error: current.error,
    clearOptions,
  };
};
