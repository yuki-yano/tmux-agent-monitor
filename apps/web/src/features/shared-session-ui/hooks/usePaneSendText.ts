import type { CommandResponse } from "@vde-monitor/shared";
import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveResultErrorMessage } from "@/lib/api-utils";
import type { ScreenMode } from "@/lib/screen-loading";

const buildSendTextRequestId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type FailedSendTextAttempt = {
  paneId: string;
  text: string;
  enter: boolean;
  requestId: string;
};

type UsePaneSendTextArgs = {
  paneId: string;
  mode: ScreenMode;
  sendText: (
    paneId: string,
    text: string,
    enter?: boolean,
    requestId?: string,
  ) => Promise<CommandResponse>;
  setScreenError: (error: string | null) => void;
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
};

type SendPaneTextOptions = {
  text: string;
  enter: boolean;
  skip?: boolean;
  confirm?: () => boolean;
  onSuccess?: () => void;
};

type PaneSendTextState = {
  paneId: string;
  isSending: boolean;
  error: string | null;
  inFlightRequestId: string | null;
};

type PaneSendTextAction =
  | { type: "start"; paneId: string; requestId: string }
  | { type: "fail"; paneId: string; error: string }
  | { type: "success"; paneId: string }
  | { type: "finish"; paneId: string };

const buildPaneSendTextState = (paneId: string): PaneSendTextState => ({
  paneId,
  isSending: false,
  error: null,
  inFlightRequestId: null,
});

const paneSendTextReducer = (
  state: PaneSendTextState,
  action: PaneSendTextAction,
): PaneSendTextState => {
  if (state.paneId !== action.paneId) {
    state = buildPaneSendTextState(action.paneId);
  }
  switch (action.type) {
    case "start":
      return {
        paneId: action.paneId,
        isSending: true,
        error: null,
        inFlightRequestId: action.requestId,
      };
    case "fail":
      return { ...state, error: action.error };
    case "success":
      return { ...state, error: null };
    case "finish":
      return { ...state, isSending: false, inFlightRequestId: null };
  }
};

export const usePaneSendText = ({
  paneId,
  mode,
  sendText,
  setScreenError,
  scrollToBottom,
}: UsePaneSendTextArgs) => {
  const sendTextInFlightRef = useRef(false);
  const lastFailedSendTextRef = useRef<FailedSendTextAttempt | null>(null);
  const activePaneRef = useRef({ paneId, generation: 0 });
  const [state, dispatch] = useReducer(paneSendTextReducer, paneId, buildPaneSendTextState);
  useLayoutEffect(() => {
    if (activePaneRef.current.paneId !== paneId) {
      activePaneRef.current = {
        paneId,
        generation: activePaneRef.current.generation + 1,
      };
      sendTextInFlightRef.current = false;
      lastFailedSendTextRef.current = null;
    }

    const activePane = activePaneRef.current;
    return () => {
      if (activePaneRef.current !== activePane) {
        return;
      }
      activePaneRef.current = {
        paneId,
        generation: activePane.generation + 1,
      };
      sendTextInFlightRef.current = false;
      lastFailedSendTextRef.current = null;
    };
  }, [paneId]);
  const visibleState = state.paneId === paneId ? state : buildPaneSendTextState(paneId);

  const send = useCallback(
    async ({ text, enter, skip = false, confirm, onSuccess }: SendPaneTextOptions) => {
      if (sendTextInFlightRef.current || skip || !text.trim()) {
        return false;
      }
      if (confirm && !confirm()) {
        return false;
      }

      const failedAttempt = lastFailedSendTextRef.current;
      const requestId =
        failedAttempt &&
        failedAttempt.paneId === paneId &&
        failedAttempt.text === text &&
        failedAttempt.enter === enter
          ? failedAttempt.requestId
          : buildSendTextRequestId();

      sendTextInFlightRef.current = true;
      const sendContext = activePaneRef.current;
      const isCurrentPaneGeneration = () => activePaneRef.current === sendContext;
      dispatch({ type: "start", paneId, requestId });
      try {
        const result = await sendText(paneId, text, enter, requestId);
        if (!isCurrentPaneGeneration()) {
          return false;
        }
        if (!result.ok) {
          const message = resolveResultErrorMessage(result, API_ERROR_MESSAGES.sendText);
          dispatch({ type: "fail", paneId, error: message });
          setScreenError(message);
          lastFailedSendTextRef.current = {
            paneId,
            text,
            enter,
            requestId,
          };
          return false;
        }
        dispatch({ type: "success", paneId });
        lastFailedSendTextRef.current = null;
        onSuccess?.();
        if (mode === "text") {
          scrollToBottom("auto");
        }
        return true;
      } finally {
        if (isCurrentPaneGeneration()) {
          sendTextInFlightRef.current = false;
          dispatch({ type: "finish", paneId });
        }
      }
    },
    [mode, paneId, scrollToBottom, sendText, setScreenError],
  );

  return {
    send,
    isSending: visibleState.isSending,
    error: visibleState.error,
    inFlightRequestId: visibleState.inFlightRequestId,
  };
};
