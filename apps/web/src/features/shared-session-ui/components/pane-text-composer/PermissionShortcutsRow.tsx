import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const PERMISSION_SHORTCUT_BUTTON_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 min-w-[40px] px-0 text-[10px] font-semibold tracking-[0.12em] sm:min-w-[36px]";

const PERMISSION_SHORTCUT_ESCAPE_BUTTON_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 min-w-[60px] px-1.5 text-[10px] font-semibold tracking-[0.12em] sm:px-2";

const PERMISSION_SHORTCUT_DIGITS = ["1", "2", "3", "4", "5", "6"] as const;

export type PermissionShortcutValue = (typeof PERMISSION_SHORTCUT_DIGITS)[number] | "Escape";

export const PermissionShortcutsRow = ({
  interactive,
  onShortcut,
}: {
  interactive: boolean;
  onShortcut: (value: PermissionShortcutValue) => void;
}) => (
  <div
    data-testid="permission-shortcuts-row"
    className="border-latte-surface2/65 bg-latte-mantle/40 flex items-center gap-1 border-b px-1.5 py-1 sm:px-2 sm:py-1.5"
  >
    <div className="flex items-center gap-1">
      {PERMISSION_SHORTCUT_DIGITS.map((digit) => (
        <Button
          key={digit}
          type="button"
          variant="ghost"
          size="sm"
          disabled={!interactive}
          onClick={() => onShortcut(digit)}
          className={PERMISSION_SHORTCUT_BUTTON_CLASS}
        >
          {digit}
        </Button>
      ))}
    </div>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!interactive}
      onClick={() => onShortcut("Escape")}
      className={cn("ml-auto", PERMISSION_SHORTCUT_ESCAPE_BUTTON_CLASS)}
    >
      Esc
    </Button>
  </div>
);
