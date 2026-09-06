import type {
  PromptCompletionItem,
  PromptCompletionResult,
  PromptCompletionTrigger,
  RepoFileSearchPage,
} from "@vde-monitor/shared";
import type { KeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  type PromptCompletionToken,
  type PromptCompletionTokenTrigger,
  findPromptCompletionToken,
  quotePromptFilePath,
} from "./prompt-completion-token";

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
const FILE_SEARCH_DEBOUNCE_MS = 150;

const toAgentOptions = (
  items: PromptCompletionItem[],
  trigger: "at" | "dollar" | "slash",
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

export const usePromptCompletion = ({
  config,
  textInputRef,
  enabled,
  onTextareaMutated,
}: {
  config: PromptCompletionConfig | null;
  textInputRef: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
  onTextareaMutated: (textarea: HTMLTextAreaElement) => void;
}) => {
  const scopeKey = enabled && config ? `${config.paneId}:${config.agent}` : null;
  const [previousScopeKey, setPreviousScopeKey] = useState(scopeKey);
  const [token, setToken] = useState<PromptCompletionToken | null>(null);
  const [options, setOptions] = useState<PromptCompletionOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isComposingRef = useRef(false);
  const dismissedTokenRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  if (previousScopeKey !== scopeKey) {
    setPreviousScopeKey(scopeKey);
    setToken(null);
    setOptions([]);
    setActiveIndex(0);
    setLoading(false);
    setError(null);
  }

  useLayoutEffect(() => {
    isComposingRef.current = false;
    dismissedTokenRef.current = null;
  }, [scopeKey]);

  const evaluate = useCallback(
    (textarea: HTMLTextAreaElement) => {
      if (!enabled || !config || isComposingRef.current) {
        setToken(null);
        return;
      }
      const next = findPromptCompletionToken({
        value: textarea.value,
        caret: textarea.selectionStart,
        agent: config.agent,
      });
      const fingerprint = next ? `${next.trigger}:${next.start}:${next.end}:${next.query}` : null;
      if (fingerprint && fingerprint === dismissedTokenRef.current) {
        setToken(null);
        return;
      }
      dismissedTokenRef.current = null;
      setToken((current) =>
        current?.trigger === next?.trigger &&
        current?.query === next?.query &&
        current?.start === next?.start &&
        current?.end === next?.end
          ? current
          : next,
      );
    },
    [config, enabled],
  );

  const close = useCallback(() => {
    if (token) {
      dismissedTokenRef.current = `${token.trigger}:${token.start}:${token.end}:${token.query}`;
    }
    setToken(null);
  }, [token]);

  const paneId = config?.paneId;
  const agent = config?.agent;
  const requestPromptCompletions = config?.requestPromptCompletions;
  const requestRepoFileSearch = config?.requestRepoFileSearch;
  const tokenTrigger = token?.trigger;
  const tokenQuery = token?.query ?? "";

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    // oxlint-disable-next-line react/set-state-in-effect -- A new async request clears stale choices before its response arrives.
    setOptions([]);
    setActiveIndex(0);
    if (
      !enabled ||
      !paneId ||
      !requestPromptCompletions ||
      !requestRepoFileSearch ||
      !tokenTrigger
    ) {
      setLoading(false);
      setError(null);
      return;
    }
    if (tokenTrigger === "at" && tokenQuery.length === 0 && agent !== "codex") {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        let nextOptions: PromptCompletionOption[];
        if (tokenTrigger === "at" && agent === "codex") {
          const [pluginResult, fileResult] = await Promise.all([
            requestPromptCompletions(paneId, "at", tokenQuery),
            tokenQuery
              ? requestRepoFileSearch(paneId, tokenQuery, { limit: MAX_FILE_OPTIONS })
              : null,
          ]);
          nextOptions = [
            ...toAgentOptions(pluginResult.items, "at"),
            ...(fileResult ? toFileOptions(fileResult) : []),
          ];
        } else if (tokenTrigger === "at") {
          nextOptions = toFileOptions(
            await requestRepoFileSearch(paneId, tokenQuery, {
              limit: MAX_FILE_OPTIONS,
            }),
          );
        } else {
          nextOptions = toAgentOptions(
            (await requestPromptCompletions(paneId, tokenTrigger, tokenQuery)).items,
            tokenTrigger,
          );
        }
        if (requestIdRef.current === requestId) {
          setOptions(nextOptions);
          setActiveIndex(0);
          setLoading(false);
        }
      } catch {
        if (requestIdRef.current === requestId) {
          setOptions([]);
          setError("Failed to load suggestions.");
          setLoading(false);
        }
      }
    };
    const timeout = setTimeout(
      () => void load(),
      tokenTrigger === "at" ? FILE_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timeout);
      requestIdRef.current += 1;
    };
  }, [
    agent,
    enabled,
    paneId,
    requestPromptCompletions,
    requestRepoFileSearch,
    tokenQuery,
    tokenTrigger,
  ]);

  const select = useCallback(
    (option: PromptCompletionOption) => {
      const textarea = textInputRef.current;
      if (!textarea || !token || option.disabledReason) {
        return;
      }
      const rawInsert =
        option.kind === "file" ? quotePromptFilePath(option.insertText) : option.insertText;
      const nextCharacter = textarea.value[token.end] ?? "";
      const insertText = nextCharacter && /\s/.test(nextCharacter) ? rawInsert : `${rawInsert} `;
      textarea.setRangeText(insertText, token.start, token.end, "end");
      onTextareaMutated(textarea);
      setToken(null);
      setOptions([]);
      textarea.focus();
    },
    [onTextareaMutated, textInputRef, token],
  );

  const insertTrigger = useCallback(
    (trigger: PromptCompletionTokenTrigger) => {
      const textarea = textInputRef.current;
      if (!textarea || !enabled || !config) {
        return;
      }
      const sigil = trigger === "dollar" ? "$" : trigger === "at" ? "@" : "/";
      const start = textarea.selectionStart;
      const prefix = start > 0 && !/\s/.test(textarea.value[start - 1] ?? "") ? " " : "";
      textarea.setRangeText(`${prefix}${sigil}`, start, textarea.selectionEnd, "end");
      onTextareaMutated(textarea);
      textarea.focus();
      dismissedTokenRef.current = null;
      evaluate(textarea);
    },
    [config, enabled, evaluate, onTextareaMutated, textInputRef],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!token || isComposingRef.current || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return true;
      }
      if (options.length === 0) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + direction + options.length) % options.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = options[activeIndex];
        if (selected) {
          select(selected);
        }
        return true;
      }
      return false;
    },
    [activeIndex, close, options, select, token],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    setToken(null);
  }, []);

  const handleCompositionEnd = useCallback(
    (textarea: HTMLTextAreaElement) => {
      isComposingRef.current = false;
      evaluate(textarea);
    },
    [evaluate],
  );

  const activeOptionId =
    token && options.length > 0 ? `prompt-completion-list-option-${activeIndex}` : undefined;

  return {
    visible: token != null,
    token,
    options,
    activeIndex,
    activeOptionId,
    loading,
    error,
    emptyMessage:
      token?.trigger === "at" && token.query.length === 0 && agent !== "codex"
        ? "Type a file name to search."
        : null,
    evaluate,
    select,
    insertTrigger,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  };
};
