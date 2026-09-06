import { ChevronDown, ChevronUp, ImagePlus, Loader2, Send } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { Button, Checkbox, PillToggle } from "@/components/ui";
import { cn } from "@/lib/cn";

import { PromptCompletionTriggerRail } from "../prompt-completion/PromptCompletionTriggerRail";

const RAW_MODE_TOGGLE_CLASS_DANGER =
  "border-latte-red/70 bg-latte-red/20 text-latte-red-text shadow-none hover:border-latte-red/80 hover:bg-latte-red/25 focus-visible:ring-latte-red/30";

const RAW_MODE_TOGGLE_CLASS_SAFE =
  "border-latte-peach/70 bg-latte-peach/10 text-latte-peach-text shadow-none hover:border-latte-peach/80 hover:bg-latte-peach/20 focus-visible:ring-latte-peach/30";

const DANGER_TOGGLE_CLASS_ACTIVE =
  "border-latte-red/85 bg-latte-red/30 text-latte-red-text shadow-none ring-1 ring-latte-red/40 hover:border-latte-red hover:bg-latte-red/40 focus-visible:ring-latte-red/45";

const DANGER_TOGGLE_CLASS_DEFAULT =
  "border-latte-surface2/70 bg-transparent text-latte-subtext0 shadow-none hover:border-latte-overlay1 hover:bg-latte-surface0/50 hover:text-latte-text";

const COMPOSER_PILL_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 px-1.5 text-[10px] tracking-[0.12em] sm:h-8";

const resolveRawModeToggleClass = (rawMode: boolean, allowDangerKeys: boolean) => {
  if (!rawMode) {
    return undefined;
  }
  return allowDangerKeys ? RAW_MODE_TOGGLE_CLASS_DANGER : RAW_MODE_TOGGLE_CLASS_SAFE;
};

const resolveDangerToggleClass = (allowDangerKeys: boolean) =>
  allowDangerKeys ? DANGER_TOGGLE_CLASS_ACTIVE : DANGER_TOGGLE_CLASS_DEFAULT;

const ComposerPill = ({ className, ...props }: ComponentPropsWithoutRef<typeof PillToggle>) => (
  <PillToggle className={cn(COMPOSER_PILL_CLASS, className)} {...props} />
);

export const ComposerToolbar = ({
  interactive,
  isSendingText,
  rawMode,
  allowDangerKeys,
  autoEnter,
  keysExpanded,
  canUseKeyPanel,
  completionAgent,
  completionActiveTrigger,
  onPickImage,
  onCompletionTrigger,
  onToggleKeysExpanded,
  onToggleAllowDangerKeys,
  onToggleRawMode,
  onToggleAutoEnter,
  onSendText,
}: {
  interactive: boolean;
  isSendingText: boolean;
  rawMode: boolean;
  allowDangerKeys: boolean;
  autoEnter: boolean;
  keysExpanded: boolean;
  canUseKeyPanel: boolean;
  completionAgent: "codex" | "claude" | null;
  completionActiveTrigger: "dollar" | "at" | "slash" | null;
  onPickImage: () => void;
  onCompletionTrigger: (trigger: "dollar" | "at" | "slash") => void;
  onToggleKeysExpanded: () => void;
  onToggleAllowDangerKeys: () => void;
  onToggleRawMode: () => void;
  onToggleAutoEnter: () => void;
  onSendText: () => void;
}) => (
  <div className="border-latte-surface2/65 bg-latte-mantle/50 flex items-center justify-between border-t px-1.5 py-1 sm:px-2 sm:py-1.5">
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={onPickImage}
        aria-label="Attach image"
        className="text-latte-subtext1 hover:text-latte-text h-8 w-8 p-0"
        disabled={!interactive}
        variant="ghost"
        size="sm"
      >
        <ImagePlus className="h-4 w-4" />
      </Button>
      {completionAgent && !rawMode ? (
        <PromptCompletionTriggerRail
          agent={completionAgent}
          activeTrigger={completionActiveTrigger}
          onTrigger={onCompletionTrigger}
        />
      ) : null}
      <span className="text-latte-subtext0 hidden text-[10px] tracking-[0.12em] @lg:inline">
        PNG / JPEG / WEBP
      </span>
    </div>
    <div className="flex items-center gap-1.5">
      {canUseKeyPanel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleKeysExpanded}
          disabled={!interactive}
          aria-expanded={keysExpanded}
          aria-label={keysExpanded ? "Hide key options" : "Show key options"}
          className="h-8 min-w-[72px] justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:h-8 sm:px-2.5"
        >
          <span>Keys</span>
          {keysExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>
      ) : null}
      {rawMode ? (
        <ComposerPill
          type="button"
          onClick={onToggleAllowDangerKeys}
          active={allowDangerKeys}
          title="Allow dangerous keys"
          className={resolveDangerToggleClass(allowDangerKeys)}
        >
          Danger
        </ComposerPill>
      ) : null}
      <ComposerPill
        type="button"
        onClick={onToggleRawMode}
        active={rawMode}
        disabled={!interactive}
        title="Raw input mode"
        className={resolveRawModeToggleClass(rawMode, allowDangerKeys)}
      >
        Raw
      </ComposerPill>
      <label
        className={cn(
          "text-latte-subtext0 inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg text-[10px] font-semibold transition sm:h-8",
          rawMode
            ? "cursor-not-allowed opacity-60"
            : "hover:bg-latte-surface0/50 hover:text-latte-text cursor-pointer",
        )}
      >
        <Checkbox
          aria-label="Enter after send"
          checked={autoEnter}
          disabled={rawMode}
          onChange={onToggleAutoEnter}
          className="h-3.5 w-3.5 shrink-0 disabled:opacity-100"
        />
        <span aria-hidden="true" className="hidden @lg:inline">
          Enter after send
        </span>
        <span aria-hidden="true" className="@lg:hidden">
          Enter
        </span>
      </label>
      <Button
        onClick={onSendText}
        aria-label="Send"
        className="h-8 min-w-[72px] justify-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:h-8 sm:px-2.5"
        disabled={rawMode || !interactive || isSendingText}
      >
        {isSendingText ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        <span>Send</span>
        {isSendingText ? <span className="sr-only">Sending</span> : null}
      </Button>
    </div>
  </div>
);
