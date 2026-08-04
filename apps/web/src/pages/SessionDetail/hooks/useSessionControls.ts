import {
  type AllowedKey,
  type CommandResponse,
  type ImageAttachment,
  type RawItem,
} from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildImagePathInsertText,
  insertIntoTextarea,
} from "@/features/shared-session-ui/lib/textarea-insert";

import { usePaneSendText } from "@/features/shared-session-ui/hooks/usePaneSendText";
import { confirmDangerousText } from "@/features/shared-session-ui/model/danger-confirm";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveResultErrorMessage, resolveUnknownErrorMessage } from "@/lib/api-utils";
import type { ScreenMode } from "@/lib/screen-loading";

import {
  controlsAllowDangerKeysAtom,
  controlsAutoEnterAtom,
  controlsCtrlHeldAtom,
  controlsRawModeAtom,
  controlsShiftHeldAtom,
} from "../atoms/controlAtoms";
import { useTerminalControls } from "@/features/shared-session-ui/hooks/useTerminalControls";
import { useRawInputHandlers } from "@/features/shared-session-ui/hooks/useRawInputHandlers";

type UseSessionControlsParams = {
  paneId: string;
  mode: ScreenMode;
  sendText: (
    paneId: string,
    text: string,
    enter?: boolean,
    requestId?: string,
  ) => Promise<CommandResponse>;
  sendKeys: (paneId: string, keys: AllowedKey[]) => Promise<CommandResponse>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  killPane?: (paneId: string) => Promise<CommandResponse>;
  killWindow?: (paneId: string) => Promise<CommandResponse>;
  uploadImageAttachment?: (paneId: string, file: File) => Promise<ImageAttachment>;
  setScreenError: (error: string | null) => void;
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
};

const handleCommandFailure = (
  response: CommandResponse,
  fallback: string,
  setScreenError: (error: string | null) => void,
) => {
  if (response.ok) {
    return false;
  }
  setScreenError(resolveResultErrorMessage(response, fallback));
  return true;
};

const readPromptValue = (textInputRef: { current: HTMLTextAreaElement | null }) =>
  textInputRef.current?.value ?? "";

const clearPromptValue = (textInputRef: { current: HTMLTextAreaElement | null }) => {
  if (textInputRef.current) {
    textInputRef.current.value = "";
  }
};

export const useSessionControls = ({
  paneId,
  mode,
  sendText,
  sendKeys,
  sendRaw,
  killPane,
  killWindow,
  uploadImageAttachment,
  setScreenError,
  scrollToBottom,
}: UseSessionControlsParams) => {
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [autoEnter, setAutoEnter] = useAtom(controlsAutoEnterAtom);
  const [shiftHeld, setShiftHeld] = useAtom(controlsShiftHeldAtom);
  const [ctrlHeld, setCtrlHeld] = useAtom(controlsCtrlHeldAtom);
  const [rawMode, setRawMode] = useAtom(controlsRawModeAtom);
  const [allowDangerKeys, setAllowDangerKeys] = useAtom(controlsAllowDangerKeysAtom);
  const paneScope = useMemo(() => ({ paneId }), [paneId]);
  // Send-scoped error state: key send / permission shortcut / text send /
  // raw-mode direct typing / image upload failures all land here instead of
  // the shared screenError (screenErrorAtom, defined in ../atoms/screenAtoms.ts
  // and driven by useSessionScreen/useScreenFetch), so a successful retry
  // clears them without disturbing an unrelated connection/screen-fetch error
  // that screenError may be showing at the same time. Kill pane/window are
  // deliberately excluded — those are one-off operations, not part of the
  // send flow, so screenError remains their error channel.
  const [sendErrorState, setSendErrorState] = useState<{
    paneScope: { paneId: string };
    error: string | null;
  }>(() => ({ paneScope, error: null }));
  const sendError = sendErrorState.paneScope === paneScope ? sendErrorState.error : null;
  const setSendError = useCallback(
    (error: string | null) => {
      setSendErrorState({ paneScope, error });
    },
    [paneScope],
  );

  useEffect(() => {
    setAutoEnter(true);
    setShiftHeld(false);
    setCtrlHeld(false);
    setRawMode(false);
    setAllowDangerKeys(false);
  }, [paneId, setAllowDangerKeys, setAutoEnter, setCtrlHeld, setRawMode, setShiftHeld]);

  const { send: sendPaneText, isSending: isSendingText } = usePaneSendText({
    paneId,
    mode,
    sendText,
    setScreenError: setSendError,
    scrollToBottom,
  });

  // Key sends and permission shortcuts report failures into the dedicated
  // sendError state above (via useTerminalControls's default
  // clear-on-success behavior) rather than the shared screenError, so a
  // successful retry clears them the same way ChatGridTile's composer error
  // does. There is no session-touch callback here (that concept only exists
  // for the ChatGrid tile list).
  const { handleSendKey, handleSendPermissionShortcut, toggleRawMode } = useTerminalControls({
    paneId,
    ctrlHeld,
    shiftHeld,
    rawMode,
    allowDangerKeys,
    autoEnter,
    sendKeys,
    sendRaw,
    setAutoEnter,
    setRawMode,
    setAllowDangerKeys,
    setSendError,
  });

  const handleKillPane = useCallback(async () => {
    if (!killPane) {
      setScreenError(API_ERROR_MESSAGES.killPane);
      return;
    }
    const result = await killPane(paneId);
    handleCommandFailure(result, API_ERROR_MESSAGES.killPane, setScreenError);
  }, [killPane, paneId, setScreenError]);

  const handleKillWindow = useCallback(async () => {
    if (!killWindow) {
      setScreenError(API_ERROR_MESSAGES.killWindow);
      return;
    }
    const result = await killWindow(paneId);
    handleCommandFailure(result, API_ERROR_MESSAGES.killWindow, setScreenError);
  }, [killWindow, paneId, setScreenError]);

  const handleSendText = useCallback(async () => {
    const currentValue = readPromptValue(textInputRef);
    await sendPaneText({
      text: currentValue,
      enter: autoEnter,
      skip: rawMode,
      confirm: () => confirmDangerousText(currentValue),
      onSuccess: () => {
        clearPromptValue(textInputRef);
        // usePaneSendText only clears its own internal error state on
        // success, not the setScreenError callback it was given (that
        // callback is fire-on-failure only) — so the send-error state has to
        // be cleared here explicitly to satisfy the same
        // clear-on-successful-send contract as key/permission sends.
        setSendError(null);
      },
    });
  }, [autoEnter, rawMode, sendPaneText, setSendError]);

  // Image upload is part of the composer's send flow (like ChatGridTile's
  // handlePickImage, which reports into composerError), so failures land on
  // the dedicated send-error state and get cleared on success too.
  const handleUploadImage = useCallback(
    async (file: File) => {
      const textarea = textInputRef.current;
      if (!textarea) {
        return;
      }
      if (!uploadImageAttachment) {
        setSendError(API_ERROR_MESSAGES.uploadImage);
        return;
      }
      try {
        const attachment = await uploadImageAttachment(paneId, file);
        insertIntoTextarea(textarea, buildImagePathInsertText(textarea, attachment.path));
        setSendError(null);
      } catch (error) {
        setSendError(resolveUnknownErrorMessage(error, API_ERROR_MESSAGES.uploadImage));
      }
    },
    [paneId, setSendError, uploadImageAttachment],
  );

  const toggleAutoEnter = useCallback(() => {
    setAutoEnter((prev) => !prev);
  }, [setAutoEnter]);

  const toggleShift = useCallback(() => {
    setShiftHeld((prev) => !prev);
  }, [setShiftHeld]);

  const toggleCtrl = useCallback(() => {
    setCtrlHeld((prev) => !prev);
  }, [setCtrlHeld]);

  const toggleAllowDangerKeys = useCallback(() => {
    setAllowDangerKeys((prev) => !prev);
  }, [setAllowDangerKeys]);

  // Raw-mode direct typing is another send path (like handleSendKey in raw
  // mode), so its failures report into the dedicated send-error state too —
  // otherwise a failed raw keystroke would leave a stale message that a later
  // successful button send wouldn't clear, the same asymmetry ChatGridTile
  // avoids by wiring composerError into useRawInputHandlers.
  // Limitation: useRawInputHandlers only calls this setter on failure, never
  // on success, so a successful raw keystroke does not itself clear a
  // previously-set sendError — it stays until some other successful send
  // (button key, permission shortcut, text, or upload) clears it.
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
    setScreenError: setSendError,
  });

  return {
    textInputRef,
    autoEnter,
    shiftHeld,
    ctrlHeld,
    rawMode,
    allowDangerKeys,
    isSendingText,
    sendError,
    handleSendKey,
    handleSendPermissionShortcut,
    handleKillPane,
    handleKillWindow,
    handleSendText,
    handleUploadImage,
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
    toggleAutoEnter,
    toggleShift,
    toggleCtrl,
    toggleRawMode,
    toggleAllowDangerKeys,
  };
};
