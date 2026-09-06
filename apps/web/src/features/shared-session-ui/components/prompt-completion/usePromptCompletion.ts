import type { KeyboardEvent, RefObject } from "react";
import { useCallback } from "react";

import type { PromptCompletionConfig, PromptCompletionOption } from "./prompt-completion-options";
import {
  insertPromptCompletionTrigger,
  replacePromptCompletionToken,
} from "./prompt-completion-textarea";
import type { PromptCompletionTokenTrigger } from "./prompt-completion-token";
import { usePromptCompletionInput } from "./use-prompt-completion-input";
import { usePromptCompletionOptions } from "./use-prompt-completion-options";

export type { PromptCompletionConfig, PromptCompletionOption } from "./prompt-completion-options";

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
  const scopeKey = enabled && config ? config.paneId + ":" + config.agent : null;
  const {
    token,
    activeIndex,
    evaluate,
    evaluateTrigger,
    clearToken,
    dismiss,
    moveSelection,
    resetSelection,
    isComposing,
    handleCompositionStart,
    handleCompositionEnd,
  } = usePromptCompletionInput({ scopeKey, agent: config?.agent });
  const { options, loading, error, clearOptions } = usePromptCompletionOptions({
    scopeKey,
    config,
    trigger: token?.trigger,
    query: token?.query ?? "",
    resetSelection,
  });

  const select = useCallback(
    (option: PromptCompletionOption) => {
      const textarea = textInputRef.current;
      if (!textarea || !token || option.disabledReason) {
        return;
      }
      replacePromptCompletionToken(textarea, token, option);
      onTextareaMutated(textarea);
      clearToken();
      clearOptions();
      textarea.focus();
    },
    [clearOptions, clearToken, onTextareaMutated, textInputRef, token],
  );

  const insertTrigger = useCallback(
    (trigger: PromptCompletionTokenTrigger) => {
      const textarea = textInputRef.current;
      if (!textarea || scopeKey == null) {
        return;
      }
      insertPromptCompletionTrigger(textarea, trigger);
      onTextareaMutated(textarea);
      textarea.focus();
      evaluateTrigger(textarea);
    },
    [evaluateTrigger, onTextareaMutated, scopeKey, textInputRef],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!token || isComposing() || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return true;
      }
      if (options.length === 0) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(event.key === "ArrowDown" ? 1 : -1, options.length);
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
    [activeIndex, dismiss, isComposing, moveSelection, options, select, token],
  );

  return {
    visible: token != null,
    token,
    options,
    activeIndex,
    activeOptionId:
      token && options.length > 0 ? `prompt-completion-list-option-${activeIndex}` : undefined,
    loading,
    error,
    emptyMessage:
      token?.trigger === "at" && token.query.length === 0 && config?.agent !== "codex"
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
