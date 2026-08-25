import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { PromptCompletionTokenTrigger } from "./prompt-completion-token";

const TRIGGER_BUTTON_CLASS = "h-7 w-7 p-0 font-mono text-sm sm:h-8 sm:w-8";

export const PromptCompletionTriggerRail = function PromptCompletionTriggerRail({
  agent,
  activeTrigger,
  onTrigger,
}: {
  agent: "codex" | "claude";
  activeTrigger: PromptCompletionTokenTrigger | null;
  onTrigger: (trigger: PromptCompletionTokenTrigger) => void;
}) {
  "use memo";

  const triggerButtonClass = (trigger: PromptCompletionTokenTrigger) =>
    cn(
      TRIGGER_BUTTON_CLASS,
      activeTrigger === trigger
        ? "border-latte-lavender/70 bg-latte-lavender/15 text-latte-lavender-text"
        : "text-latte-subtext0",
    );

  return (
    <div className="flex items-center gap-1">
      {agent === "codex" ? (
        <Button
          type="button"
          variant="ghost"
          className={triggerButtonClass("dollar")}
          onClick={() => onTrigger("dollar")}
          aria-label="Open Skill completions"
          title="Skills"
        >
          <strong>$</strong>
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className={triggerButtonClass("at")}
        onClick={() => onTrigger("at")}
        aria-label={
          agent === "codex" ? "Open Plugin and File completions" : "Open File completions"
        }
        title={agent === "codex" ? "Plugins and files" : "Files"}
      >
        <strong>@</strong>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={triggerButtonClass("slash")}
        onClick={() => onTrigger("slash")}
        aria-label={
          agent === "claude" ? "Open Skill and Command completions" : "Open Command completions"
        }
        title={agent === "claude" ? "Skills and commands" : "Commands"}
      >
        <strong>/</strong>
      </Button>
    </div>
  );
};
