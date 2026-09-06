import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

import type { PromptCompletionOption } from "./usePromptCompletion";

export const PROMPT_COMPLETION_LIST_ID = "prompt-completion-list";

export const PromptCompletionList = ({
  options,
  activeIndex,
  loading,
  error,
  emptyMessage,
  onSelect,
}: {
  options: PromptCompletionOption[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  emptyMessage: string | null;
  onSelect: (option: PromptCompletionOption) => void;
}) => (
  <div
    id={PROMPT_COMPLETION_LIST_ID}
    role="listbox"
    aria-label="Prompt completions"
    className="border-latte-surface2/70 bg-latte-base/95 min-h-0 border-y backdrop-blur"
  >
    <div className="text-latte-subtext0 flex min-h-8 items-center justify-between border-b border-latte-surface1/70 px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em]">
      <span>Suggestions</span>
      <span>↑↓ Select · Enter Accept · Esc Close</span>
    </div>
    {loading ? (
      <div className="text-latte-subtext0 flex min-h-12 items-center gap-2 px-3 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    ) : error ? (
      <div className="text-latte-red-text min-h-12 px-3 py-3 text-xs">{error}</div>
    ) : options.length === 0 ? (
      <div className="text-latte-subtext0 min-h-12 px-3 py-3 text-xs">
        {emptyMessage ?? "No suggestions found."}
      </div>
    ) : (
      <div className="max-h-[min(10rem,30dvh)] overflow-y-auto overscroll-contain sm:max-h-[min(15rem,40vh)]">
        {options.map((option, index) => {
          const active = index === activeIndex;
          const optionId = `${PROMPT_COMPLETION_LIST_ID}-option-${index}`;
          return (
            <button
              id={optionId}
              key={option.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={option.disabledReason != null}
              disabled={option.disabledReason != null}
              title={option.disabledReason}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option)}
              className={cn(
                "grid min-h-12 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-latte-surface1/60 px-2.5 py-1.5 text-left last:border-b-0 disabled:cursor-not-allowed disabled:opacity-55",
                active
                  ? "bg-latte-lavender/15 shadow-[inset_3px_0_0_var(--color-latte-lavender)]"
                  : "hover:bg-latte-surface0/50",
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg font-mono text-sm font-bold",
                  option.trigger === "dollar"
                    ? "bg-latte-mauve/15 text-latte-mauve-text"
                    : option.trigger === "at"
                      ? "bg-latte-blue/15 text-latte-blue-text"
                      : "bg-latte-peach/15 text-latte-peach-text",
                )}
              >
                {option.trigger === "dollar" ? "$" : option.trigger === "at" ? "@" : "/"}
              </span>
              <span className="min-w-0">
                <span className="text-latte-text block truncate font-mono text-xs font-semibold">
                  {option.label}
                  {option.argumentHint ? (
                    <span className="text-latte-subtext0 ml-1 font-sans font-normal">
                      {option.argumentHint}
                    </span>
                  ) : null}
                </span>
                <span className="text-latte-subtext0 block truncate text-[10px]">
                  {option.disabledReason ?? option.description}
                </span>
              </span>
              <span className="bg-latte-surface0 text-latte-subtext0 rounded-full px-1.5 py-0.5 text-[9px]">
                {option.scope ?? option.kind}
              </span>
            </button>
          );
        })}
      </div>
    )}
  </div>
);
