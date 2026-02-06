import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Pin,
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

import { Button, Callout, IconButton, ModifierToggle, PillToggle, Toolbar } from "@/components/ui";

type ControlsPanelState = {
  readOnly: boolean;
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
  onTouchSession: () => void;
};

type ControlsPanelProps = {
  state: ControlsPanelState;
  actions: ControlsPanelActions;
};

const PROMPT_SCALE = 0.875;
const PROMPT_SCALE_INVERSE = 1 / PROMPT_SCALE;

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
    className="h-8 min-w-[44px] px-2 text-[10px] tracking-[0.12em]"
    disabled={disabled}
    aria-label={ariaLabel}
  >
    {label}
  </Button>
);

const RAW_MODE_INPUT_CLASS_DANGER =
  "border-latte-red/90 bg-latte-base/90 ring-4 ring-latte-red/50 ring-offset-2 ring-offset-latte-base/70 shadow-[0_0_0_1px_rgb(var(--ctp-red)/0.25),0_0_24px_rgb(var(--ctp-red)/0.6),0_0_52px_rgb(var(--ctp-red)/0.28)]";
const RAW_MODE_INPUT_CLASS_SAFE =
  "border-latte-peach/90 bg-latte-base/90 ring-4 ring-latte-peach/55 ring-offset-2 ring-offset-latte-base/70 shadow-[0_0_0_1px_rgb(var(--ctp-peach)/0.25),0_0_24px_rgb(var(--ctp-peach)/0.6),0_0_52px_rgb(var(--ctp-peach)/0.28)]";
const RAW_MODE_INPUT_CLASS_DEFAULT =
  "focus-within:border-latte-lavender focus-within:ring-latte-lavender/30 focus-within:ring-2";
const RAW_MODE_TOGGLE_CLASS_DANGER =
  "border-latte-red/85 bg-latte-red/20 text-latte-red ring-2 ring-latte-red/40 ring-offset-2 ring-offset-latte-base/70 shadow-[0_0_0_1px_rgb(var(--ctp-red)/0.3),0_0_16px_rgb(var(--ctp-red)/0.45)]";
const RAW_MODE_TOGGLE_CLASS_SAFE =
  "border-latte-peach/85 bg-latte-peach/20 text-latte-peach ring-2 ring-latte-peach/45 ring-offset-2 ring-offset-latte-base/70 shadow-[0_0_0_1px_rgb(var(--ctp-peach)/0.3),0_0_16px_rgb(var(--ctp-peach)/0.45)]";
const DANGER_TOGGLE_CLASS_ACTIVE = "border-latte-red/70 bg-latte-red/10 text-latte-red";
const DANGER_TOGGLE_CLASS_DEFAULT = "border-latte-surface2/70 text-latte-subtext0";
const MODIFIER_DOT_CLASS_ACTIVE = "bg-latte-lavender";
const MODIFIER_DOT_CLASS_DEFAULT = "bg-latte-surface2";

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

export const ControlsPanel = ({ state, actions }: ControlsPanelProps) => {
  const {
    readOnly,
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
    onTouchSession,
  } = actions;
  const tabLabel = "Tab";
  const inputWrapperRef = useRef<HTMLDivElement | null>(null);
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

  const handleTextareaInput = (e: FormEvent<HTMLTextAreaElement>) =>
    handlePromptInput({ event: e, rawMode, onRawInput, syncPromptHeight });

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    handlePromptKeyDown({ event, rawMode, onRawKeyDown, onSend: handleSendText });

  const handleSendText = () => {
    const result = onSendText();
    void Promise.resolve(result).finally(() => {
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

  if (readOnly) {
    return (
      <Callout tone="warning" size="sm">
        Read-only mode is active. Interactive controls are hidden.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div
          ref={inputWrapperRef}
          className={`border-latte-surface2/80 bg-latte-base/70 min-h-[56px] min-w-0 flex-1 overflow-hidden rounded-2xl border transition ${
            rawModeInputClass
          }`}
        >
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
            className="text-latte-text min-h-[64px] w-full resize-none rounded-2xl bg-transparent px-4 py-2 text-base outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div className="flex shrink-0 items-center self-center">
          <Button
            onClick={handleSendText}
            aria-label="Send"
            className="h-11 w-11 p-0"
            disabled={rawMode || !interactive}
          >
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
      <Toolbar>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleControls}
            aria-expanded={controlsOpen}
            aria-controls="session-controls"
            className="text-latte-subtext0 flex items-center gap-2 px-2.5 py-1 text-[10px] uppercase tracking-[0.3em]"
          >
            {controlsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Keys
          </Button>
          <PillToggle
            type="button"
            onClick={onToggleRawMode}
            active={rawMode}
            disabled={!interactive}
            title="Raw input mode"
            className={rawModeToggleClass}
          >
            Raw
          </PillToggle>
          {rawMode && (
            <PillToggle
              type="button"
              onClick={onToggleAllowDangerKeys}
              active={allowDangerKeys}
              title="Allow dangerous keys"
              className={dangerToggleClass}
            >
              Danger
            </PillToggle>
          )}
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            type="button"
            size="sm"
            onClick={onTouchSession}
            disabled={!interactive}
            aria-label="Pin session to top"
            title="Pin session to top"
          >
            <Pin className="h-4 w-4" />
          </IconButton>
          <PillToggle
            type="button"
            onClick={onToggleAutoEnter}
            active={autoEnter}
            disabled={rawMode}
            title="Auto-enter after send"
            className="group"
          >
            <span className="text-[9px] font-semibold tracking-[0.3em]">Auto</span>
            <CornerDownLeft className="h-3.5 w-3.5" />
            <span className="sr-only">Auto-enter</span>
          </PillToggle>
        </div>
      </Toolbar>
      {controlsOpen && (
        <div id="session-controls" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ModifierToggle
              type="button"
              onClick={onToggleShift}
              active={shiftHeld}
              className="px-2.5 py-1 text-[10px] tracking-[0.18em]"
            >
              <span className={`h-2 w-2 rounded-full transition-colors ${shiftDotClass}`} />
              Shift
            </ModifierToggle>
            <ModifierToggle
              type="button"
              onClick={onToggleCtrl}
              active={ctrlHeld}
              className="px-2.5 py-1 text-[10px] tracking-[0.18em]"
            >
              <span className={`h-2 w-2 rounded-full transition-colors ${ctrlDotClass}`} />
              Ctrl
            </ModifierToggle>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Esc", key: "Escape" },
                { label: tabLabel, key: "Tab" },
                { label: "Backspace", key: "BSpace" },
                { label: "Enter", key: "Enter" },
              ].map((item) => (
                <KeyButton key={item.key} label={item.label} onClick={() => onSendKey(item.key)} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
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
      )}
    </div>
  );
};
