import { type RefObject, useEffect } from "react";

import { PROMPT_COMPLETION_LIST_ID } from "../prompt-completion/PromptCompletionList";
import { resolvePromptCompletionScrollDelta } from "../prompt-completion/prompt-completion-scroll";

export const useRevealPromptCompletion = ({
  visible,
  loading,
  optionCount,
  textInputRef,
  composerRef,
}: {
  visible: boolean;
  loading: boolean;
  optionCount: number;
  textInputRef: RefObject<HTMLTextAreaElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
}) => {
  useEffect(() => {
    if (!visible || window.innerWidth >= 768) {
      return;
    }
    let frame = 0;
    const revealCompletion = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const textarea = textInputRef.current;
        const listbox = composerRef.current?.querySelector<HTMLElement>(
          `#${PROMPT_COMPLETION_LIST_ID}`,
        );
        if (!textarea || !listbox) {
          return;
        }
        const visualViewport = window.visualViewport;
        const viewportTop = visualViewport?.offsetTop ?? 0;
        const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
        const delta = resolvePromptCompletionScrollDelta({
          inputRect: textarea.getBoundingClientRect(),
          listRect: listbox.getBoundingClientRect(),
          viewportTop,
          viewportBottom,
        });
        if (Math.abs(delta) < 1) {
          return;
        }
        window.scrollBy({
          top: delta,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      });
    };

    revealCompletion();
    window.visualViewport?.addEventListener("resize", revealCompletion);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", revealCompletion);
    };
  }, [composerRef, loading, optionCount, textInputRef, visible]);
};
