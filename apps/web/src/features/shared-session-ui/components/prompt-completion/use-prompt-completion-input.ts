import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { PromptCompletionConfig } from "./prompt-completion-options";
import { type PromptCompletionToken, findPromptCompletionToken } from "./prompt-completion-token";

const fingerprintToken = (token: PromptCompletionToken | null) =>
  token ? `${token.trigger}:${token.start}:${token.end}:${token.query}` : null;

const sameToken = (current: PromptCompletionToken | null, next: PromptCompletionToken | null) =>
  current?.trigger === next?.trigger &&
  current?.query === next?.query &&
  current?.start === next?.start &&
  current?.end === next?.end;

const createInputState = (scopeKey: string | null) => ({
  scopeKey,
  token: null as PromptCompletionToken | null,
  activeIndex: 0,
});

export const usePromptCompletionInput = ({
  scopeKey,
  agent,
}: {
  scopeKey: string | null;
  agent: PromptCompletionConfig["agent"] | undefined;
}) => {
  const [state, setState] = useState(() => createInputState(scopeKey));
  const current = state.scopeKey === scopeKey ? state : createInputState(scopeKey);
  if (current !== state) {
    setState(current);
  }
  const { token, activeIndex } = current;
  const isComposingRef = useRef(false);
  const dismissedTokenRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    isComposingRef.current = false;
    dismissedTokenRef.current = null;
  }, [scopeKey]);

  const clearToken = useCallback(() => {
    setState((previous) => (previous.token ? { ...previous, token: null } : previous));
  }, []);

  const evaluate = useCallback(
    (textarea: HTMLTextAreaElement) => {
      if (scopeKey == null || agent == null || isComposingRef.current) {
        clearToken();
        return;
      }
      const next = findPromptCompletionToken({
        value: textarea.value,
        caret: textarea.selectionStart,
        agent,
      });
      const fingerprint = fingerprintToken(next);
      if (fingerprint && fingerprint === dismissedTokenRef.current) {
        clearToken();
        return;
      }
      dismissedTokenRef.current = null;
      setState((previous) =>
        sameToken(previous.token, next) ? previous : { ...previous, token: next },
      );
    },
    [agent, clearToken, scopeKey],
  );

  const dismiss = useCallback(() => {
    if (token) {
      dismissedTokenRef.current = fingerprintToken(token);
    }
    clearToken();
  }, [clearToken, token]);

  const resetSelection = useCallback(() => {
    setState((previous) =>
      previous.activeIndex === 0 ? previous : { ...previous, activeIndex: 0 },
    );
  }, []);

  const moveSelection = useCallback((direction: number, optionCount: number) => {
    setState((previous) => ({
      ...previous,
      activeIndex: (previous.activeIndex + direction + optionCount) % optionCount,
    }));
  }, []);

  const evaluateTrigger = useCallback(
    (textarea: HTMLTextAreaElement) => {
      dismissedTokenRef.current = null;
      evaluate(textarea);
    },
    [evaluate],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    clearToken();
  }, [clearToken]);

  const handleCompositionEnd = useCallback(
    (textarea: HTMLTextAreaElement) => {
      isComposingRef.current = false;
      evaluate(textarea);
    },
    [evaluate],
  );

  const isComposing = useCallback(() => isComposingRef.current, []);

  return {
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
  };
};
