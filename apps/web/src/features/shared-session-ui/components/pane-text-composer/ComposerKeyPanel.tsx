import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Button, ModifierToggle } from "@/components/ui";
import { cn } from "@/lib/cn";

const MODIFIER_TOGGLE_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 px-2 py-0.5 text-[10px] tracking-[0.16em] sm:h-8 sm:px-2.5";

const MODIFIER_DOT_CLASS_ACTIVE = "bg-latte-lavender";

const MODIFIER_DOT_CLASS_DEFAULT = "bg-latte-surface2";

const KEY_BUTTON_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 min-w-[44px] px-1.5 text-[10px] tracking-[0.12em] sm:px-2";

const FUNCTION_KEY_BUTTONS = [
  { label: "Esc", key: "Escape" },
  { label: "Tab", key: "Tab" },
  { label: "Backspace", key: "BSpace" },
  { label: "Enter", key: "Enter" },
] as const;

const ARROW_KEY_BUTTONS: { key: string; ariaLabel: string; Icon: LucideIcon }[] = [
  { key: "Left", ariaLabel: "Left", Icon: ArrowLeft },
  { key: "Up", ariaLabel: "Up", Icon: ArrowUp },
  { key: "Down", ariaLabel: "Down", Icon: ArrowDown },
  { key: "Right", ariaLabel: "Right", Icon: ArrowRight },
];

const ModifierKeyToggle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ModifierToggle>) => (
  <ModifierToggle className={cn(MODIFIER_TOGGLE_CLASS, className)} {...props} />
);

const KeyButton = ({
  label,
  ariaLabel,
  onClick,
  disabled,
}: {
  label: ReactNode;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={KEY_BUTTON_CLASS}
    disabled={disabled}
    aria-label={ariaLabel}
  >
    {label}
  </Button>
);

export const ComposerKeyPanel = ({
  interactive,
  shiftHeld,
  ctrlHeld,
  onToggleShift,
  onToggleCtrl,
  onSendKey,
}: {
  interactive: boolean;
  shiftHeld: boolean;
  ctrlHeld: boolean;
  onToggleShift: () => void;
  onToggleCtrl: () => void;
  onSendKey: (key: string) => void;
}) => {
  const shiftDotClass = shiftHeld ? MODIFIER_DOT_CLASS_ACTIVE : MODIFIER_DOT_CLASS_DEFAULT;
  const ctrlDotClass = ctrlHeld ? MODIFIER_DOT_CLASS_ACTIVE : MODIFIER_DOT_CLASS_DEFAULT;

  return (
    <div className="border-latte-surface2/65 bg-latte-mantle/40 space-y-2 border-t px-1.5 py-1.5 sm:px-2 sm:py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ModifierKeyToggle
          type="button"
          onClick={onToggleShift}
          active={shiftHeld}
          disabled={!interactive}
        >
          <span className={cn("h-2 w-2 rounded-full transition-colors", shiftDotClass)} />
          Shift
        </ModifierKeyToggle>
        <ModifierKeyToggle
          type="button"
          onClick={onToggleCtrl}
          active={ctrlHeld}
          disabled={!interactive}
        >
          <span className={cn("h-2 w-2 rounded-full transition-colors", ctrlDotClass)} />
          Ctrl
        </ModifierKeyToggle>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FUNCTION_KEY_BUTTONS.map((item) => (
          <KeyButton
            key={item.key}
            label={item.label}
            onClick={() => onSendKey(item.key)}
            disabled={!interactive}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ARROW_KEY_BUTTONS.map((item) => (
          <KeyButton
            key={item.key}
            label={
              <>
                <item.Icon className="h-4 w-4" />
                <span className="sr-only">{item.ariaLabel}</span>
              </>
            }
            ariaLabel={item.ariaLabel}
            onClick={() => onSendKey(item.key)}
            disabled={!interactive}
          />
        ))}
      </div>
    </div>
  );
};
