import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  ImagePlus,
  Send,
} from "lucide-react";
import {
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { Button, ModifierToggle, PillToggle } from "@/components/ui";
import { cn } from "@/lib/cn";

type ControlsPanelState = {
  interactive: boolean;
  textInputRef: RefObject<HTMLTextAreaElement | null>;
  autoEnter: boolean;
  controlsOpen: boolean;
  rawMode: boolean;
  allowDangerKeys: boolean;
  shiftHeld: boolean;
  ctrlHeld: boolean;
};

type ControlsPanelActions = {
  onSendText: () => void;
  onPickImage: (file: File) => void | Promise<void>;
  onToggleAutoEnter: () => void;
  onToggleControls: () => void;
  onToggleRawMode: () => void;
  onToggleAllowDangerKeys: () => void;
  onToggleShift: () => void;
  onToggleCtrl: () => void;
  onSendKey: (key: string) => void;
  onRawBeforeInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onRawInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onRawKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRawCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onRawCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
};

type ControlsPanelProps = {
  state: ControlsPanelState;
  actions: ControlsPanelActions;
};

const PROMPT_SCALE = 0.875;
const PROMPT_SCALE_INVERSE = 1 / PROMPT_SCALE;

const RAW_MODE_INPUT_CLASS_DANGER =
  "border-latte-red/70 bg-latte-red/10 focus-within:border-latte-red/80 focus-within:ring-2 focus-within:ring-latte-red/30";
const RAW_MODE_INPUT_CLASS_SAFE =
  "border-latte-peach/60 bg-latte-peach/10 focus-within:border-latte-peach/70 focus-within:ring-2 focus-within:ring-latte-peach/20";
const RAW_MODE_INPUT_CLASS_DEFAULT =
  "border-latte-surface2/80 bg-latte-base/70 focus-within:border-latte-lavender focus-within:ring-latte-lavender/30 focus-within:ring-2";
const RAW_MODE_TOGGLE_CLASS_DANGER =
  "border-latte-red/70 bg-latte-red/20 text-latte-red shadow-none hover:border-latte-red/80 hover:bg-latte-red/25 focus-visible:ring-latte-red/30";
const RAW_MODE_TOGGLE_CLASS_SAFE =
  "border-latte-peach/70 bg-latte-peach/10 text-latte-peach shadow-none hover:border-latte-peach/80 hover:bg-latte-peach/20 focus-visible:ring-latte-peach/30";
const DANGER_TOGGLE_CLASS_ACTIVE =
  "border-latte-red/85 bg-latte-red/30 text-latte-red shadow-none ring-1 ring-latte-red/40 hover:border-latte-red hover:bg-latte-red/40 focus-visible:ring-latte-red/45";
const DANGER_TOGGLE_CLASS_DEFAULT =
  "border-latte-surface2/70 bg-transparent text-latte-subtext0 shadow-none hover:border-latte-overlay1 hover:bg-latte-surface0/50 hover:text-latte-text";
const MODIFIER_DOT_CLASS_ACTIVE = "bg-latte-lavender";
const MODIFIER_DOT_CLASS_DEFAULT = "bg-latte-surface2";

const COMPOSER_PILL_CLASS = "h-8 px-1.5 text-[10px] tracking-[0.18em]";
const MODIFIER_TOGGLE_CLASS = "h-8 px-2.5 py-0.5 text-[10px] tracking-[0.16em]";
const KEY_BUTTON_CLASS = "h-8 min-w-[44px] px-2 text-[10px] tracking-[0.12em]";

const resolveRawModeInputClass = (rawMode: boolean, allowDangerKeys: boolean) => {
  if (!rawMode) return RAW_MODE_INPUT_CLASS_DEFAULT;
  return allowDangerKeys ? RAW_MODE_INPUT_CLASS_DANGER : RAW_MODE_INPUT_CLASS_SAFE;
};

const resolveRawModeToggleClass = (rawMode: boolean, allowDangerKeys: boolean) => {
  if (!rawMode) return undefined;
  return allowDangerKeys ? RAW_MODE_TOGGLE_CLASS_DANGER : RAW_MODE_TOGGLE_CLASS_SAFE;
};

const resolveDangerToggleClass = (allowDangerKeys: boolean) =>
  allowDangerKeys ? DANGER_TOGGLE_CLASS_ACTIVE : DANGER_TOGGLE_CLASS_DEFAULT;

const resolveModifierDotClass = (active: boolean) =>
  active ? MODIFIER_DOT_CLASS_ACTIVE : MODIFIER_DOT_CLASS_DEFAULT;

const isSendShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) =>
  event.key === "Enter" && (event.ctrlKey || event.metaKey);

const handlePromptInput = ({
  event,
  rawMode,
  onRawInput,
  syncPromptHeight,
}: {
  event: FormEvent<HTMLTextAreaElement>;
  rawMode: boolean;
  onRawInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  syncPromptHeight: (textarea: HTMLTextAreaElement) => void;
}) => {
  if (rawMode) {
    onRawInput(event);
  }
  syncPromptHeight(event.currentTarget);
};

const handlePromptKeyDown = ({
  event,
  rawMode,
  onRawKeyDown,
  onSend,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  rawMode: boolean;
  onRawKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
}) => {
  if (rawMode) {
    onRawKeyDown(event);
    return;
  }
  if (!isSendShortcut(event)) {
    return;
  }
  event.preventDefault();
  onSend();
};

const KeyButton = ({
  label,
  onClick,
  danger,
  disabled,
  ariaLabel,
}: {
  label: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <Button
    variant={danger ? "danger" : "ghost"}
    size="sm"
    onClick={onClick}
    className={KEY_BUTTON_CLASS}
    disabled={disabled}
    aria-label={ariaLabel}
  >
    {label}
  </Button>
);

const ComposerPill = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof PillToggle>) => (
  <PillToggle className={cn(COMPOSER_PILL_CLASS, className)} {...props} />
);

const ModifierKeyToggle = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ModifierToggle>) => (
  <ModifierToggle className={cn(MODIFIER_TOGGLE_CLASS, className)} {...props} />
);

type ComposerActionsRowState = {
  interactive: boolean;
  rawMode: boolean;
  autoEnter: boolean;
  allowDangerKeys: boolean;
  rawModeToggleClass: string | undefined;
  dangerToggleClass: string;
};

type ComposerActionsRowActions = {
  onPickImage: () => void;
  onToggleAllowDangerKeys: () => void;
  onToggleRawMode: () => void;
  onToggleAutoEnter: () => void;
  onSendText: () => void;
};

const ComposerActionsRow = ({
  state,
  actions,
}: {
  state: ComposerActionsRowState;
  actions: ComposerActionsRowActions;
}) => {
  const {
    interactive,
    rawMode,
    autoEnter,
    allowDangerKeys,
    rawModeToggleClass,
    dangerToggleClass,
  } = state;
  const { onPickImage, onToggleAllowDangerKeys, onToggleRawMode, onToggleAutoEnter, onSendText } =
    actions;

  return (
    <div className="border-latte-surface2/70 bg-latte-mantle/50 flex items-center justify-between border-t px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onPickImage}
          aria-label="Attach image"
          className="text-latte-subtext1 hover:text-latte-text h-8 gap-1 px-2 py-0.5"
          disabled={!interactive}
          variant="ghost"
          size="sm"
        >
          <ImagePlus className="h-4 w-4" />
        </Button>
        <span className="text-latte-subtext0 hidden text-[10px] tracking-[0.12em] sm:inline">
          PNG / JPEG / WEBP
        </span>
      </div>
      <div className="flex items-center gap-1">
        {rawMode ? (
          <ComposerPill
            type="button"
            onClick={onToggleAllowDangerKeys}
            active={allowDangerKeys}
            title="Allow dangerous keys"
            className={dangerToggleClass}
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
          className={rawModeToggleClass}
        >
          Raw
        </ComposerPill>
        <ComposerPill
          type="button"
          onClick={onToggleAutoEnter}
          active={autoEnter}
          disabled={rawMode}
          title="Auto-enter after send"
          className="group"
        >
          <span>Auto</span>
          <CornerDownLeft className="h-3 w-3" />
          <span className="sr-only">Auto-enter</span>
        </ComposerPill>
        <Button
          onClick={onSendText}
          aria-label="Send"
          className="h-8 gap-1 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          disabled={rawMode || !interactive}
        >
          <Send className="h-4 w-4" />
          <span>Send</span>
        </Button>
      </div>
    </div>
  );
};

type KeysSectionState = {
  controlsOpen: boolean;
  shiftHeld: boolean;
  ctrlHeld: boolean;
  shiftDotClass: string;
  ctrlDotClass: string;
};

type KeysSectionActions = {
  onToggleControls: () => void;
  onToggleShift: () => void;
  onToggleCtrl: () => void;
  onSendKey: (key: string) => void;
};

const KeysSection = ({
  state,
  actions,
}: {
  state: KeysSectionState;
  actions: KeysSectionActions;
}) => {
  const { controlsOpen, shiftHeld, ctrlHeld, shiftDotClass, ctrlDotClass } = state;
  const { onToggleControls, onToggleShift, onToggleCtrl, onSendKey } = actions;

  return (
    <div className="border-latte-surface2/50 space-y-1.5 border-t pt-2">
      <div className="flex items-center justify-between px-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleControls}
          aria-expanded={controlsOpen}
          aria-controls="session-controls"
          className="text-latte-subtext0 flex h-8 items-center gap-1.5 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em]"
        >
          {controlsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Keys
        </Button>
        <span className="text-latte-subtext0 text-[10px] uppercase tracking-[0.16em]">
          Quick keys
        </span>
      </div>
      {controlsOpen ? (
        <div id="session-controls" className="space-y-2.5 px-0.5 pb-0.5 pt-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <ModifierKeyToggle type="button" onClick={onToggleShift} active={shiftHeld}>
              <span className={`h-2 w-2 rounded-full transition-colors ${shiftDotClass}`} />
              Shift
            </ModifierKeyToggle>
            <ModifierKeyToggle type="button" onClick={onToggleCtrl} active={ctrlHeld}>
              <span className={`h-2 w-2 rounded-full transition-colors ${ctrlDotClass}`} />
              Ctrl
            </ModifierKeyToggle>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Esc", key: "Escape" },
                { label: "Tab", key: "Tab" },
                { label: "Backspace", key: "BSpace" },
                { label: "Enter", key: "Enter" },
              ].map((item) => (
                <KeyButton key={item.key} label={item.label} onClick={() => onSendKey(item.key)} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              {[
                {
                  label: (
                    <>
                      <ArrowLeft className="h-4 w-4" />
                      <span className="sr-only">Left</span>
                    </>
                  ),
                  key: "Left",
                  ariaLabel: "Left",
                },
                {
                  label: (
                    <>
                      <ArrowUp className="h-4 w-4" />
                      <span className="sr-only">Up</span>
                    </>
                  ),
                  key: "Up",
                  ariaLabel: "Up",
                },
                {
                  label: (
                    <>
                      <ArrowDown className="h-4 w-4" />
                      <span className="sr-only">Down</span>
                    </>
                  ),
                  key: "Down",
                  ariaLabel: "Down",
                },
                {
                  label: (
                    <>
                      <ArrowRight className="h-4 w-4" />
                      <span className="sr-only">Right</span>
                    </>
                  ),
                  key: "Right",
                  ariaLabel: "Right",
                },
              ].map((item) => (
                <KeyButton
                  key={item.key}
                  label={item.label}
                  ariaLabel={item.ariaLabel}
                  onClick={() => onSendKey(item.key)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const ControlsPanel = ({ state, actions }: ControlsPanelProps) => {
  const {
    interactive,
    textInputRef,
    autoEnter,
    controlsOpen,
    rawMode,
    allowDangerKeys,
    shiftHeld,
    ctrlHeld,
  } = state;
  const {
    onSendText,
    onPickImage,
    onToggleAutoEnter,
    onToggleControls,
    onToggleRawMode,
    onToggleAllowDangerKeys,
    onToggleShift,
    onToggleCtrl,
    onSendKey,
    onRawBeforeInput,
    onRawInput,
    onRawKeyDown,
    onRawCompositionStart,
    onRawCompositionEnd,
  } = actions;

  const inputWrapperRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const placeholder = rawMode ? "Raw input (sent immediately)..." : "Type a prompt…";
  const rawModeInputClass = resolveRawModeInputClass(rawMode, allowDangerKeys);
  const rawModeToggleClass = resolveRawModeToggleClass(rawMode, allowDangerKeys);
  const dangerToggleClass = resolveDangerToggleClass(allowDangerKeys);
  const shiftDotClass = resolveModifierDotClass(shiftHeld);
  const ctrlDotClass = resolveModifierDotClass(ctrlHeld);

  const syncPromptHeight = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    if (inputWrapperRef.current) {
      inputWrapperRef.current.style.height = `${textarea.scrollHeight * PROMPT_SCALE}px`;
    }
  }, []);

  const handleTextareaInput = (event: FormEvent<HTMLTextAreaElement>) =>
    handlePromptInput({ event, rawMode, onRawInput, syncPromptHeight });

  const handleSendText = () => {
    const result = onSendText();
    void Promise.resolve(result).finally(() => {
      if (textInputRef.current) {
        syncPromptHeight(textInputRef.current);
      }
    });
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    handlePromptKeyDown({ event, rawMode, onRawKeyDown, onSend: handleSendText });

  const handlePickImage = () => {
    if (!interactive) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImageFileChange = (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const result = onPickImage(file);
    void Promise.resolve(result).finally(() => {
      input.value = "";
      if (textInputRef.current) {
        syncPromptHeight(textInputRef.current);
      }
    });
  };

  useEffect(() => {
    if (textInputRef.current) {
      syncPromptHeight(textInputRef.current);
    }
  }, [syncPromptHeight, textInputRef]);

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <div
          className={`min-w-0 overflow-hidden rounded-2xl border transition ${rawModeInputClass}`}
        >
          <div ref={inputWrapperRef} className="min-h-[64px] overflow-hidden">
            <textarea
              placeholder={placeholder}
              ref={textInputRef}
              rows={2}
              disabled={!interactive}
              onBeforeInput={onRawBeforeInput}
              onCompositionStart={onRawCompositionStart}
              onCompositionEnd={onRawCompositionEnd}
              onInput={handleTextareaInput}
              onKeyDown={handleTextareaKeyDown}
              style={{
                transform: `scale(${PROMPT_SCALE})`,
                transformOrigin: "top left",
                width: `${PROMPT_SCALE_INVERSE * 100}%`,
              }}
              className="text-latte-text min-h-[60px] w-full resize-none rounded-2xl bg-transparent px-3 py-1.5 text-base outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          <ComposerActionsRow
            state={{
              interactive,
              rawMode,
              autoEnter,
              allowDangerKeys,
              rawModeToggleClass,
              dangerToggleClass,
            }}
            actions={{
              onPickImage: handlePickImage,
              onToggleAllowDangerKeys: onToggleAllowDangerKeys,
              onToggleRawMode: onToggleRawMode,
              onToggleAutoEnter: onToggleAutoEnter,
              onSendText: handleSendText,
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Attach image file"
            className="hidden"
            disabled={!interactive}
            onChange={handleImageFileChange}
          />
        </div>
      </div>
      <KeysSection
        state={{
          controlsOpen,
          shiftHeld,
          ctrlHeld,
          shiftDotClass,
          ctrlDotClass,
        }}
        actions={{
          onToggleControls,
          onToggleShift,
          onToggleCtrl,
          onSendKey,
        }}
      />
    </div>
  );
};
