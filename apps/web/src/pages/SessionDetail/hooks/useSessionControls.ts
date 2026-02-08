import {
  type AllowedKey,
  type CommandResponse,
  defaultDangerKeys,
  type ImageAttachment,
  type RawItem,
} from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import type { ScreenMode } from "@/lib/screen-loading";

import {
  controlsAllowDangerKeysAtom,
  controlsAutoEnterAtom,
  controlsCtrlHeldAtom,
  controlsOpenAtom,
  controlsRawModeAtom,
  controlsShiftHeldAtom,
} from "../atoms/controlAtoms";
import { isDangerousText } from "../sessionDetailUtils";
import { mapKeyWithModifiers } from "./sessionControlKeys";
import { useRawInputHandlers } from "./useRawInputHandlers";

type UseSessionControlsParams = {
  paneId: string;
  mode: ScreenMode;
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: AllowedKey[]) => Promise<CommandResponse>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  uploadImageAttachment?: (paneId: string, file: File) => Promise<ImageAttachment>;
  setScreenError: (error: string | null) => void;
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
};

const resolveCommandErrorMessage = (response: CommandResponse, fallback: string) =>
  response.error?.message ?? fallback;

const handleCommandFailure = (
  response: CommandResponse,
  fallback: string,
  setScreenError: (error: string | null) => void,
) => {
  if (response.ok) {
    return false;
  }
  setScreenError(resolveCommandErrorMessage(response, fallback));
  return true;
};

const confirmDangerousKeySend = (mappedKey: string) => {
  if (!defaultDangerKeys.includes(mappedKey as AllowedKey)) {
    return true;
  }
  return window.confirm("Dangerous key detected. Send anyway?");
};

const readPromptValue = (textInputRef: { current: HTMLTextAreaElement | null }) =>
  textInputRef.current?.value ?? "";

const clearPromptValue = (textInputRef: { current: HTMLTextAreaElement | null }) => {
  if (textInputRef.current) {
    textInputRef.current.value = "";
  }
};

const confirmDangerousTextSend = (value: string) => {
  if (!isDangerousText(value)) {
    return true;
  }
  return window.confirm("Dangerous command detected. Send anyway?");
};

const shouldSkipTextSend = ({ rawMode, value }: { rawMode: boolean; value: string }) =>
  rawMode || !value.trim();

export const insertIntoTextarea = (textarea: HTMLTextAreaElement, insertText: string) => {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const current = textarea.value;
  const next = `${current.slice(0, start)}${insertText}${current.slice(end)}`;
  textarea.value = next;
  const nextCaret = start + insertText.length;
  textarea.selectionStart = nextCaret;
  textarea.selectionEnd = nextCaret;
};

const isWhitespace = (char: string) => /\s/u.test(char);

export const buildImagePathInsertText = (
  textarea: HTMLTextAreaElement,
  imagePath: string,
): string => {
  const start = textarea.selectionStart ?? textarea.value.length;
  const previousChar = start > 0 ? (textarea.value[start - 1] ?? "") : "";
  const prefix = start > 0 && !isWhitespace(previousChar) ? "\n" : "";
  return `${prefix}${imagePath}\n`;
};

export const useSessionControls = ({
  paneId,
  mode,
  sendText,
  sendKeys,
  sendRaw,
  uploadImageAttachment,
  setScreenError,
  scrollToBottom,
}: UseSessionControlsParams) => {
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const prevAutoEnterRef = useRef<boolean | null>(null);
  const [autoEnter, setAutoEnter] = useAtom(controlsAutoEnterAtom);
  const [shiftHeld, setShiftHeld] = useAtom(controlsShiftHeldAtom);
  const [ctrlHeld, setCtrlHeld] = useAtom(controlsCtrlHeldAtom);
  const [controlsOpen, setControlsOpen] = useAtom(controlsOpenAtom);
  const [rawMode, setRawMode] = useAtom(controlsRawModeAtom);
  const [allowDangerKeys, setAllowDangerKeys] = useAtom(controlsAllowDangerKeysAtom);

  useEffect(() => {
    prevAutoEnterRef.current = null;
    setAutoEnter(true);
    setShiftHeld(false);
    setCtrlHeld(false);
    setControlsOpen(false);
    setRawMode(false);
    setAllowDangerKeys(false);
  }, [
    paneId,
    setAllowDangerKeys,
    setAutoEnter,
    setControlsOpen,
    setCtrlHeld,
    setRawMode,
    setShiftHeld,
  ]);

  useEffect(() => {
    if (!rawMode && prevAutoEnterRef.current != null) {
      setAutoEnter(prevAutoEnterRef.current);
      prevAutoEnterRef.current = null;
    }
  }, [rawMode, setAutoEnter]);

  const handleSendKey = useCallback(
    async (key: string) => {
      const mapped = mapKeyWithModifiers(key, ctrlHeld, shiftHeld);
      if (rawMode) {
        const result = await sendRaw(
          paneId,
          [{ kind: "key", value: mapped as AllowedKey }],
          allowDangerKeys,
        );
        handleCommandFailure(result, API_ERROR_MESSAGES.sendRaw, setScreenError);
        return;
      }
      if (!confirmDangerousKeySend(mapped)) return;
      const result = await sendKeys(paneId, [mapped as AllowedKey]);
      handleCommandFailure(result, API_ERROR_MESSAGES.sendKeys, setScreenError);
    },
    [allowDangerKeys, ctrlHeld, paneId, rawMode, sendKeys, sendRaw, setScreenError, shiftHeld],
  );

  const handleSendText = useCallback(async () => {
    const currentValue = readPromptValue(textInputRef);
    if (shouldSkipTextSend({ rawMode, value: currentValue })) return;
    if (!confirmDangerousTextSend(currentValue)) return;
    const result = await sendText(paneId, currentValue, autoEnter);
    if (handleCommandFailure(result, API_ERROR_MESSAGES.sendText, setScreenError)) {
      return;
    }
    clearPromptValue(textInputRef);
    if (mode === "text") {
      scrollToBottom("auto");
    }
  }, [autoEnter, mode, paneId, rawMode, scrollToBottom, sendText, setScreenError]);

  const handleUploadImage = useCallback(
    async (file: File) => {
      const textarea = textInputRef.current;
      if (!textarea) {
        return;
      }
      if (!uploadImageAttachment) {
        setScreenError(API_ERROR_MESSAGES.uploadImage);
        return;
      }
      try {
        const attachment = await uploadImageAttachment(paneId, file);
        insertIntoTextarea(textarea, buildImagePathInsertText(textarea, attachment.path));
        setScreenError(null);
      } catch (error) {
        setScreenError(error instanceof Error ? error.message : API_ERROR_MESSAGES.uploadImage);
      }
    },
    [paneId, setScreenError, uploadImageAttachment],
  );

  const toggleAutoEnter = useCallback(() => {
    setAutoEnter((prev) => !prev);
  }, [setAutoEnter]);

  const toggleControls = useCallback(() => {
    setControlsOpen((prev) => !prev);
  }, [setControlsOpen]);

  const toggleShift = useCallback(() => {
    setShiftHeld((prev) => !prev);
  }, [setShiftHeld]);

  const toggleCtrl = useCallback(() => {
    setCtrlHeld((prev) => !prev);
  }, [setCtrlHeld]);

  const toggleRawMode = useCallback(() => {
    setRawMode((prev) => {
      const next = !prev;
      if (next) {
        prevAutoEnterRef.current = autoEnter;
        setAutoEnter(false);
      } else {
        setAllowDangerKeys(false);
      }
      return next;
    });
  }, [autoEnter, setAllowDangerKeys, setAutoEnter, setRawMode]);

  const toggleAllowDangerKeys = useCallback(() => {
    setAllowDangerKeys((prev) => !prev);
  }, [setAllowDangerKeys]);

  const {
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
  } = useRawInputHandlers({
    paneId,
    rawMode,
    allowDangerKeys,
    ctrlHeld,
    shiftHeld,
    sendRaw,
    setScreenError,
  });

  return {
    textInputRef,
    autoEnter,
    shiftHeld,
    ctrlHeld,
    controlsOpen,
    rawMode,
    allowDangerKeys,
    handleSendKey,
    handleSendText,
    handleUploadImage,
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
    toggleAutoEnter,
    toggleControls,
    toggleShift,
    toggleCtrl,
    toggleRawMode,
    toggleAllowDangerKeys,
  };
};
