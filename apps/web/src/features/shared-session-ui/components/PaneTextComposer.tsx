import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  type LucideIcon,
  Send,
} from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button, Checkbox, ModifierToggle, PillToggle, ZoomSafeTextarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { IOS_ZOOM_SAFE_FIELD_SCALE } from "@/lib/ios-zoom-safe-textarea";
import {
  readStoredPromptDraft,
  syncStoredPromptDraft,
} from "@/features/shared-session-ui/lib/pane-text-draft-storage";

import {
  PROMPT_COMPLETION_LIST_ID,
  PromptCompletionList,
} from "./prompt-completion/PromptCompletionList";
import { PromptCompletionTriggerRail } from "./prompt-completion/PromptCompletionTriggerRail";
import {
  type PromptCompletionConfig,
  usePromptCompletion,
} from "./prompt-completion/usePromptCompletion";
import { resolvePromptCompletionScrollDelta } from "./prompt-completion/prompt-completion-scroll";

const RAW_MODE_INPUT_CLASS_DANGER =
  "border-latte-red/70 bg-latte-red/10 focus-within:border-latte-red/80 focus-within:ring-2 focus-within:ring-latte-red/30";
const RAW_MODE_INPUT_CLASS_SAFE =
  "border-latte-peach/60 bg-latte-peach/10 focus-within:border-latte-peach/70 focus-within:ring-2 focus-within:ring-latte-peach/20";
const RAW_MODE_INPUT_CLASS_DEFAULT =
  "border-latte-surface2/80 bg-latte-base/70 focus-within:border-latte-lavender focus-within:ring-latte-lavender/30 focus-within:ring-2";
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
const MODIFIER_TOGGLE_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 px-2 py-0.5 text-[10px] tracking-[0.16em] sm:h-8 sm:px-2.5";
const MODIFIER_DOT_CLASS_ACTIVE = "bg-latte-lavender";
const MODIFIER_DOT_CLASS_DEFAULT = "bg-latte-surface2";
const KEY_BUTTON_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 min-w-[44px] px-1.5 text-[10px] tracking-[0.12em] sm:px-2";
const PERMISSION_SHORTCUT_BUTTON_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 min-w-[40px] px-0 text-[10px] font-semibold tracking-[0.12em] sm:min-w-[36px]";
const PERMISSION_SHORTCUT_ESCAPE_BUTTON_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] h-8 min-w-[60px] px-1.5 text-[10px] font-semibold tracking-[0.12em] sm:px-2";
const PERMISSION_SHORTCUT_DIGITS = ["1", "2", "3", "4", "5", "6"] as const;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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

type PaneTextComposerKeyPanelState = {
  shiftHeld: boolean;
  ctrlHeld: boolean;
};

type PaneTextComposerKeyPanelActions = {
  onToggleShift: () => void;
  onToggleCtrl: () => void;
  onSendKey: (key: string) => void;
};

type PaneTextComposerState = {
  interactive: boolean;
  isSendingText: boolean;
  textInputRef: RefObject<HTMLTextAreaElement | null>;
  draftStorageKey?: string;
  autoEnter: boolean;
  rawMode: boolean;
  allowDangerKeys: boolean;
  showPermissionShortcuts?: boolean;
  keyPanel?: PaneTextComposerKeyPanelState;
  completion?: PromptCompletionConfig;
};

export type PermissionShortcutValue = (typeof PERMISSION_SHORTCUT_DIGITS)[number] | "Escape";

type PaneTextComposerActions = {
  onSendText: () => void;
  onSendPermissionShortcut?: (value: PermissionShortcutValue) => void | Promise<void>;
  onPickImage: (file: File) => void | Promise<void>;
  onToggleAutoEnter: () => void;
  onToggleRawMode: () => void;
  onToggleAllowDangerKeys: () => void;
  keyPanel?: PaneTextComposerKeyPanelActions;
  onRawBeforeInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onRawInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onRawKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRawCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onRawCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
};

type PaneTextComposerProps = {
  state: PaneTextComposerState;
  actions: PaneTextComposerActions;
};

const isAllowedImageMimeType = (file: File) => ALLOWED_IMAGE_MIME_TYPES.has(file.type);

const resolveRawModeInputClass = (rawMode: boolean, allowDangerKeys: boolean) => {
  if (!rawMode) {
    return RAW_MODE_INPUT_CLASS_DEFAULT;
  }
  return allowDangerKeys ? RAW_MODE_INPUT_CLASS_DANGER : RAW_MODE_INPUT_CLASS_SAFE;
};

const resolveRawModeToggleClass = (rawMode: boolean, allowDangerKeys: boolean) => {
  if (!rawMode) {
    return undefined;
  }
  return allowDangerKeys ? RAW_MODE_TOGGLE_CLASS_DANGER : RAW_MODE_TOGGLE_CLASS_SAFE;
};

const resolveDangerToggleClass = (allowDangerKeys: boolean) =>
  allowDangerKeys ? DANGER_TOGGLE_CLASS_ACTIVE : DANGER_TOGGLE_CLASS_DEFAULT;

const extractAllowedImageFileFromClipboard = (data: DataTransfer | null): File | null => {
  if (!data) {
    return null;
  }

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (file != null && isAllowedImageMimeType(file)) {
      return file;
    }
  }

  const directFiles = Array.from(data.files ?? []);
  for (const file of directFiles) {
    if (isAllowedImageMimeType(file)) {
      return file;
    }
  }
  return null;
};

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
  sendDisabled,
  onRawKeyDown,
  onSend,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  rawMode: boolean;
  sendDisabled: boolean;
  onRawKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
}) => {
  if (rawMode) {
    onRawKeyDown(event);
    return;
  }
  if (sendDisabled || !isSendShortcut(event)) {
    return;
  }
  event.preventDefault();
  onSend();
};

const ComposerPill = ({ className, ...props }: ComponentPropsWithoutRef<typeof PillToggle>) => (
  <PillToggle className={cn(COMPOSER_PILL_CLASS, className)} {...props} />
);

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

const PermissionShortcutsRow = ({
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

const ComposerToolbar = ({
  interactive,
  isSendingText,
  rawMode,
  allowDangerKeys,
  autoEnter,
  keysExpanded,
  canUseKeyPanel,
  rawModeToggleClass,
  dangerToggleClass,
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
  rawModeToggleClass: string | undefined;
  dangerToggleClass: string;
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

const ComposerKeyPanel = ({
  interactive,
  state,
  actions,
}: {
  interactive: boolean;
  state: PaneTextComposerKeyPanelState;
  actions: PaneTextComposerKeyPanelActions;
}) => {
  const shiftDotClass = state.shiftHeld ? MODIFIER_DOT_CLASS_ACTIVE : MODIFIER_DOT_CLASS_DEFAULT;
  const ctrlDotClass = state.ctrlHeld ? MODIFIER_DOT_CLASS_ACTIVE : MODIFIER_DOT_CLASS_DEFAULT;

  return (
    <div className="border-latte-surface2/65 bg-latte-mantle/40 space-y-2 border-t px-1.5 py-1.5 sm:px-2 sm:py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ModifierKeyToggle
          type="button"
          onClick={actions.onToggleShift}
          active={state.shiftHeld}
          disabled={!interactive}
        >
          <span className={cn("h-2 w-2 rounded-full transition-colors", shiftDotClass)} />
          Shift
        </ModifierKeyToggle>
        <ModifierKeyToggle
          type="button"
          onClick={actions.onToggleCtrl}
          active={state.ctrlHeld}
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
            onClick={() => actions.onSendKey(item.key)}
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
            onClick={() => actions.onSendKey(item.key)}
            disabled={!interactive}
          />
        ))}
      </div>
    </div>
  );
};

const useRevealPromptCompletion = ({
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

export const PaneTextComposer = ({ state, actions }: PaneTextComposerProps) => {
  const {
    interactive,
    isSendingText,
    textInputRef,
    draftStorageKey,
    autoEnter,
    rawMode,
    allowDangerKeys,
    showPermissionShortcuts,
    keyPanel,
    completion: completionConfig,
  } = state;
  const {
    onSendText,
    onSendPermissionShortcut,
    onPickImage,
    onToggleAutoEnter,
    onToggleRawMode,
    onToggleAllowDangerKeys,
    keyPanel: keyPanelActions,
    onRawBeforeInput,
    onRawInput,
    onRawKeyDown,
    onRawCompositionStart,
    onRawCompositionEnd,
  } = actions;
  const inputWrapperRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialPromptDraft = readStoredPromptDraft(draftStorageKey);
  const placeholder = rawMode ? "Raw input (sent immediately)..." : "Type a prompt…";
  const rawModeInputClass = resolveRawModeInputClass(rawMode, allowDangerKeys);
  const rawModeToggleClass = resolveRawModeToggleClass(rawMode, allowDangerKeys);
  const dangerToggleClass = resolveDangerToggleClass(allowDangerKeys);
  const [keysExpanded, setKeysExpanded] = useState(false);
  const keyPanelState = keyPanel ?? null;
  const keyPanelHandlers = keyPanelActions ?? null;
  const canUseKeyPanel = keyPanelState != null && keyPanelHandlers != null;
  const canShowPermissionShortcuts =
    showPermissionShortcuts === true && onSendPermissionShortcut != null;
  const syncPromptHeight = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    if (inputWrapperRef.current) {
      inputWrapperRef.current.style.height = `${textarea.scrollHeight * IOS_ZOOM_SAFE_FIELD_SCALE}px`;
    }
  }, []);

  const syncPromptDraftFromTextarea = useCallback(
    (textarea: HTMLTextAreaElement) => {
      syncStoredPromptDraft(draftStorageKey, textarea);
    },
    [draftStorageKey],
  );

  const syncPromptDraftFromRef = useCallback(() => {
    if (textInputRef.current) {
      syncPromptDraftFromTextarea(textInputRef.current);
    }
  }, [syncPromptDraftFromTextarea, textInputRef]);

  const handleProgrammaticTextareaMutation = useCallback(
    (textarea: HTMLTextAreaElement) => {
      syncPromptHeight(textarea);
      syncPromptDraftFromTextarea(textarea);
    },
    [syncPromptDraftFromTextarea, syncPromptHeight],
  );

  const promptCompletion = usePromptCompletion({
    config: completionConfig ?? null,
    textInputRef,
    enabled:
      interactive && !rawMode && completionConfig != null && completionConfig.agent !== "unknown",
    onTextareaMutated: handleProgrammaticTextareaMutation,
  });

  const handleTextareaBeforeInput = (event: FormEvent<HTMLTextAreaElement>) => {
    onRawBeforeInput(event);
    if (rawMode) {
      syncPromptDraftFromTextarea(event.currentTarget);
    }
  };

  const handleTextareaInput = (event: FormEvent<HTMLTextAreaElement>) => {
    handlePromptInput({ event, rawMode, onRawInput, syncPromptHeight });
    syncPromptDraftFromTextarea(event.currentTarget);
    promptCompletion.evaluate(event.currentTarget);
  };

  const handleSendText = () => {
    const result = onSendText();
    void Promise.resolve(result).finally(() => {
      if (textInputRef.current) {
        syncPromptHeight(textInputRef.current);
      }
      syncPromptDraftFromRef();
    });
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (promptCompletion.handleKeyDown(event)) {
      return;
    }
    handlePromptKeyDown({
      event,
      rawMode,
      sendDisabled: !interactive || isSendingText,
      onRawKeyDown,
      onSend: handleSendText,
    });
    if (rawMode) {
      syncPromptDraftFromTextarea(event.currentTarget);
    }
  };

  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (rawMode) {
      return;
    }
    const file = extractAllowedImageFileFromClipboard(event.clipboardData);
    if (!file) {
      return;
    }
    event.preventDefault();
    const result = onPickImage(file);
    void Promise.resolve(result).finally(() => {
      if (textInputRef.current) {
        syncPromptHeight(textInputRef.current);
      }
      syncPromptDraftFromRef();
    });
  };

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
      syncPromptDraftFromRef();
    });
  };

  useEffect(() => {
    if (textInputRef.current) {
      syncPromptHeight(textInputRef.current);
    }
  }, [syncPromptHeight, textInputRef]);

  useEffect(() => {
    if (draftStorageKey == null || !textInputRef.current) {
      return;
    }
    textInputRef.current.value = readStoredPromptDraft(draftStorageKey);
    syncPromptHeight(textInputRef.current);
  }, [draftStorageKey, syncPromptHeight, textInputRef]);

  const handlePermissionShortcut = (value: PermissionShortcutValue) => {
    const result = onSendPermissionShortcut?.(value);
    void Promise.resolve(result);
  };

  const handleCompositionStart = (event: CompositionEvent<HTMLTextAreaElement>) => {
    promptCompletion.handleCompositionStart();
    onRawCompositionStart(event);
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    onRawCompositionEnd(event);
    promptCompletion.handleCompositionEnd(event.currentTarget);
  };

  const completionAgent =
    completionConfig?.agent === "codex" || completionConfig?.agent === "claude"
      ? completionConfig.agent
      : null;

  useRevealPromptCompletion({
    visible: promptCompletion.visible,
    loading: promptCompletion.loading,
    optionCount: promptCompletion.options.length,
    textInputRef,
    composerRef,
  });

  return (
    <div ref={composerRef} className="@container min-w-0 scroll-mb-3">
      <div
        className={cn("min-w-0 overflow-hidden rounded-2xl border transition", rawModeInputClass)}
      >
        {canShowPermissionShortcuts ? (
          <PermissionShortcutsRow interactive={interactive} onShortcut={handlePermissionShortcut} />
        ) : null}
        <div ref={inputWrapperRef} className="min-h-[56px] overflow-hidden sm:min-h-[64px]">
          <ZoomSafeTextarea
            placeholder={placeholder}
            ref={textInputRef}
            rows={2}
            defaultValue={initialPromptDraft}
            disabled={!interactive}
            onBeforeInput={handleTextareaBeforeInput}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onInput={handleTextareaInput}
            onKeyDown={handleTextareaKeyDown}
            onClick={(event) => promptCompletion.evaluate(event.currentTarget)}
            onKeyUp={(event) => promptCompletion.evaluate(event.currentTarget)}
            role="combobox"
            aria-label={placeholder}
            aria-autocomplete="list"
            aria-expanded={promptCompletion.visible}
            aria-controls={promptCompletion.visible ? PROMPT_COMPLETION_LIST_ID : undefined}
            aria-activedescendant={promptCompletion.activeOptionId}
            onPaste={handleTextareaPaste}
            className="text-latte-text min-h-[52px] w-full resize-none rounded-2xl bg-transparent px-2.5 py-1 font-mono text-base outline-hidden disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[60px] sm:px-3 sm:py-1.5"
          />
        </div>
        {promptCompletion.visible ? (
          <PromptCompletionList
            options={promptCompletion.options}
            activeIndex={promptCompletion.activeIndex}
            loading={promptCompletion.loading}
            error={promptCompletion.error}
            emptyMessage={promptCompletion.emptyMessage}
            onSelect={promptCompletion.select}
          />
        ) : null}
        <ComposerToolbar
          interactive={interactive}
          isSendingText={isSendingText}
          rawMode={rawMode}
          allowDangerKeys={allowDangerKeys}
          autoEnter={autoEnter}
          keysExpanded={keysExpanded}
          canUseKeyPanel={canUseKeyPanel}
          rawModeToggleClass={rawModeToggleClass}
          dangerToggleClass={dangerToggleClass}
          completionAgent={completionAgent}
          completionActiveTrigger={promptCompletion.token?.trigger ?? null}
          onPickImage={handlePickImage}
          onCompletionTrigger={promptCompletion.insertTrigger}
          onToggleKeysExpanded={() => setKeysExpanded((prev) => !prev)}
          onToggleAllowDangerKeys={onToggleAllowDangerKeys}
          onToggleRawMode={onToggleRawMode}
          onToggleAutoEnter={onToggleAutoEnter}
          onSendText={handleSendText}
        />
        {keyPanelState != null && keyPanelHandlers != null && keysExpanded ? (
          <ComposerKeyPanel
            interactive={interactive}
            state={keyPanelState}
            actions={keyPanelHandlers}
          />
        ) : null}
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
  );
};
