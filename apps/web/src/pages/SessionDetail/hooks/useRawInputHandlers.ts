import type { AllowedKey, CommandResponse, RawItem } from "@vde-monitor/shared";
import {
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  INPUT_TYPE_DELETE_BACKWARD,
  INPUT_TYPE_INSERT_COMPOSITION,
  INPUT_TYPE_INSERT_FROM_PASTE,
  INPUT_TYPE_INSERT_LINE_BREAK,
  INPUT_TYPE_INSERT_PARAGRAPH,
  INPUT_TYPE_INSERT_REPLACEMENT,
  INPUT_TYPE_INSERT_TEXT,
  resolveRawBeforeInput,
} from "./raw-input-beforeinput";
import { resolveRawKeyInput } from "./raw-input-keymap";

const RAW_FLUSH_DELAY_MS = 16;

type UseRawInputHandlersParams = {
  paneId: string;
  rawMode: boolean;
  allowDangerKeys: boolean;
  ctrlHeld: boolean;
  shiftHeld: boolean;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<CommandResponse>;
  setScreenError: (error: string | null) => void;
};

type RawInputAction =
  | { kind: "ignore" }
  | { kind: "text"; value: string | null }
  | { kind: "key"; value: AllowedKey };

const rawTextInputTypes = new Set<string>([
  INPUT_TYPE_INSERT_TEXT,
  INPUT_TYPE_INSERT_REPLACEMENT,
  INPUT_TYPE_INSERT_FROM_PASTE,
]);

const rawInputTypeToKey: Record<string, AllowedKey> = {
  [INPUT_TYPE_INSERT_LINE_BREAK]: "Enter",
  [INPUT_TYPE_INSERT_PARAGRAPH]: "Enter",
  [INPUT_TYPE_DELETE_BACKWARD]: "BSpace",
};

const resolveRawInputAction = ({
  inputType,
  data,
  isComposing,
}: {
  inputType: string | null;
  data: string | null;
  isComposing: boolean;
}): RawInputAction => {
  if (!inputType) {
    return { kind: "ignore" };
  }
  if (inputType === INPUT_TYPE_INSERT_COMPOSITION) {
    return isComposing ? { kind: "ignore" } : { kind: "text", value: data };
  }
  if (rawTextInputTypes.has(inputType)) {
    return { kind: "text", value: data };
  }
  const key = rawInputTypeToKey[inputType];
  if (key) {
    return { kind: "key", value: key };
  }
  return { kind: "ignore" };
};

const shouldSkipRawInput = (rawMode: boolean) => !rawMode;

type RawInputPayload = {
  inputType: string | null;
  fallbackText: string | null;
};

const resolveRawInputPayload = (event: FormEvent<HTMLTextAreaElement>): RawInputPayload => {
  const inputEvent = event.nativeEvent as InputEvent | undefined;
  return {
    inputType: inputEvent?.inputType ?? null,
    fallbackText: inputEvent?.data ?? event.currentTarget.value,
  };
};

const shouldHandleFallbackText = (payload: RawInputPayload) =>
  !payload.inputType && Boolean(payload.fallbackText);

export const useRawInputHandlers = ({
  paneId,
  rawMode,
  allowDangerKeys,
  ctrlHeld,
  shiftHeld,
  sendRaw,
  setScreenError,
}: UseRawInputHandlersParams) => {
  const rawQueueRef = useRef<RawItem[]>([]);
  const rawFlushTimerRef = useRef<number | null>(null);
  const rawFlushChainRef = useRef(Promise.resolve());
  const isComposingRef = useRef(false);
  const suppressNextInputRef = useRef(false);
  const suppressNextBeforeInputRef = useRef(false);
  const allowDangerRef = useRef(false);

  useEffect(() => {
    allowDangerRef.current = allowDangerKeys;
  }, [allowDangerKeys]);

  useEffect(() => {
    if (!rawMode) {
      rawQueueRef.current = [];
      if (rawFlushTimerRef.current != null) {
        window.clearTimeout(rawFlushTimerRef.current);
        rawFlushTimerRef.current = null;
      }
    }
  }, [rawMode]);

  const resetRawInputValue = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) return;
    target.value = "";
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        target.value = "";
      });
      return;
    }
    window.setTimeout(() => {
      target.value = "";
    }, 0);
  }, []);

  const scheduleClearSuppressedInput = useCallback(() => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        suppressNextInputRef.current = false;
      });
      return;
    }
    window.setTimeout(() => {
      suppressNextInputRef.current = false;
    }, 0);
  }, []);

  const scheduleClearSuppressedBeforeInput = useCallback(() => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        suppressNextBeforeInputRef.current = false;
      });
      return;
    }
    window.setTimeout(() => {
      suppressNextBeforeInputRef.current = false;
    }, 0);
  }, []);

  const enqueueRawItems = useCallback(
    (items: RawItem[]) => {
      if (items.length === 0) return;
      rawQueueRef.current.push(...items);
      if (rawFlushTimerRef.current != null) return;
      rawFlushTimerRef.current = window.setTimeout(() => {
        rawFlushTimerRef.current = null;
        const batch = rawQueueRef.current.splice(0, rawQueueRef.current.length);
        if (batch.length === 0) return;
        const merged: RawItem[] = [];
        for (const item of batch) {
          const last = merged[merged.length - 1];
          if (item.kind === "text" && last?.kind === "text") {
            last.value += item.value;
          } else if (item.kind === "text" && item.value.length === 0) {
            continue;
          } else {
            merged.push({ ...item });
          }
        }
        rawFlushChainRef.current = rawFlushChainRef.current.then(async () => {
          try {
            const result = await sendRaw(paneId, merged, allowDangerRef.current);
            if (!result.ok) {
              setScreenError(result.error?.message ?? API_ERROR_MESSAGES.sendRaw);
            }
          } catch {
            setScreenError(API_ERROR_MESSAGES.sendRaw);
          }
        });
      }, RAW_FLUSH_DELAY_MS);
    },
    [paneId, sendRaw, setScreenError],
  );

  const enqueueRawText = useCallback(
    (value: string | null) => {
      if (!value) return;
      const text = value;
      if (ctrlHeld && text.length === 1 && /[a-z]/i.test(text)) {
        enqueueRawItems([{ kind: "key", value: `C-${text.toLowerCase()}` as AllowedKey }]);
        return;
      }
      enqueueRawItems([{ kind: "text", value: text }]);
    },
    [ctrlHeld, enqueueRawItems],
  );

  const enqueueRawKey = useCallback(
    (value: AllowedKey) => {
      enqueueRawItems([{ kind: "key", value }]);
    },
    [enqueueRawItems],
  );

  const handleRawInputType = useCallback(
    (inputType: string | null, data: string | null) => {
      const action = resolveRawInputAction({
        inputType,
        data,
        isComposing: isComposingRef.current,
      });
      switch (action.kind) {
        case "ignore":
          return;
        case "text":
          enqueueRawText(action.value);
          return;
        case "key":
          enqueueRawKey(action.value);
          return;
      }
    },
    [enqueueRawKey, enqueueRawText],
  );

  const handleRawBeforeInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const inputEvent = event.nativeEvent as InputEvent | undefined;
      const resolution = resolveRawBeforeInput({
        rawMode,
        suppressNextBeforeInput: suppressNextBeforeInputRef.current,
        isComposing: isComposingRef.current,
        inputType: inputEvent?.inputType ?? null,
        data: typeof inputEvent?.data === "string" ? inputEvent.data : null,
      });
      if (resolution.kind === "ignored") {
        return;
      }
      if (resolution.kind === "consumeSuppressFlag") {
        suppressNextBeforeInputRef.current = false;
        return;
      }
      suppressNextInputRef.current = true;
      handleRawInputType(resolution.inputType, resolution.data);
      event.preventDefault();
      resetRawInputValue(event.currentTarget);
      scheduleClearSuppressedInput();
    },
    [handleRawInputType, rawMode, resetRawInputValue, scheduleClearSuppressedInput],
  );

  const handleRawInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      if (shouldSkipRawInput(rawMode)) return;
      if (suppressNextInputRef.current) {
        suppressNextInputRef.current = false;
        resetRawInputValue(event.currentTarget);
        return;
      }
      const payload = resolveRawInputPayload(event);
      if (shouldHandleFallbackText(payload)) {
        enqueueRawText(payload.fallbackText);
        resetRawInputValue(event.currentTarget);
        return;
      }
      handleRawInputType(payload.inputType, payload.fallbackText);
      resetRawInputValue(event.currentTarget);
    },
    [enqueueRawText, handleRawInputType, rawMode, resetRawInputValue],
  );

  const handleRawKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!rawMode) return;
      if (event.nativeEvent.isComposing) return;
      const ctrlActive = ctrlHeld || event.ctrlKey;
      const shiftActive = shiftHeld || event.shiftKey;
      const resolved = resolveRawKeyInput({
        key: event.key,
        ctrlActive,
        shiftActive,
      });
      if (!resolved) {
        return;
      }

      event.preventDefault();
      if (resolved.suppressBeforeInput) {
        suppressNextBeforeInputRef.current = true;
        scheduleClearSuppressedBeforeInput();
      }
      enqueueRawKey(resolved.key);
      resetRawInputValue(event.currentTarget);
    },
    [
      ctrlHeld,
      enqueueRawKey,
      rawMode,
      resetRawInputValue,
      scheduleClearSuppressedBeforeInput,
      shiftHeld,
    ],
  );

  const handleRawCompositionStart = useCallback(() => {
    if (!rawMode) return;
    isComposingRef.current = true;
  }, [rawMode]);

  const handleRawCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      if (!rawMode) return;
      isComposingRef.current = false;
      enqueueRawText(event.data);
      resetRawInputValue(event.currentTarget);
    },
    [enqueueRawText, rawMode, resetRawInputValue],
  );

  return {
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
  };
};
