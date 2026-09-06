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

import { ZoomSafeTextarea } from "@/components/ui";
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
import {
  type PromptCompletionConfig,
  usePromptCompletion,
} from "./prompt-completion/usePromptCompletion";
import { ComposerToolbar } from "./pane-text-composer/ComposerToolbar";
import { ComposerKeyPanel } from "./pane-text-composer/ComposerKeyPanel";
import {
  type PermissionShortcutValue,
  PermissionShortcutsRow,
} from "./pane-text-composer/PermissionShortcutsRow";
import { runPromptTextareaMutation } from "./pane-text-composer/prompt-textarea-mutation";
import { useRevealPromptCompletion } from "./pane-text-composer/use-reveal-prompt-completion";

const RAW_MODE_INPUT_CLASS_DANGER =
  "border-latte-red/70 bg-latte-red/10 focus-within:border-latte-red/80 focus-within:ring-2 focus-within:ring-latte-red/30";
const RAW_MODE_INPUT_CLASS_SAFE =
  "border-latte-peach/60 bg-latte-peach/10 focus-within:border-latte-peach/70 focus-within:ring-2 focus-within:ring-latte-peach/20";
const RAW_MODE_INPUT_CLASS_DEFAULT =
  "border-latte-surface2/80 bg-latte-base/70 focus-within:border-latte-lavender focus-within:ring-latte-lavender/30 focus-within:ring-2";
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

export type { PermissionShortcutValue } from "./pane-text-composer/PermissionShortcutsRow";

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

  const handleProgrammaticTextareaMutation = useCallback(
    (textarea: HTMLTextAreaElement) => {
      syncPromptHeight(textarea);
      syncPromptDraftFromTextarea(textarea);
    },
    [syncPromptDraftFromTextarea, syncPromptHeight],
  );

  const synchronizeTextarea = useCallback(() => {
    if (textInputRef.current) {
      handleProgrammaticTextareaMutation(textInputRef.current);
    }
  }, [handleProgrammaticTextareaMutation, textInputRef]);

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
    void runPromptTextareaMutation(onSendText, synchronizeTextarea);
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
    void runPromptTextareaMutation(() => onPickImage(file), synchronizeTextarea);
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
    void runPromptTextareaMutation(() => onPickImage(file), synchronizeTextarea, input);
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
            shiftHeld={keyPanelState.shiftHeld}
            ctrlHeld={keyPanelState.ctrlHeld}
            onToggleShift={keyPanelHandlers.onToggleShift}
            onToggleCtrl={keyPanelHandlers.onToggleCtrl}
            onSendKey={keyPanelHandlers.onSendKey}
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
