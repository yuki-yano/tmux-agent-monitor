import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";

import type { VirtualizedViewportHandle } from "@/features/shared-session-ui/components/AnsiVirtualizedViewport";
import type { ScreenMode } from "@/lib/screen-loading";

type UseScreenScrollParams = {
  paneId: string;
  mode: ScreenMode;
  screenLinesLength: number;
  isUserScrollingRef: MutableRefObject<boolean>;
  onFlushPending: () => void;
  onClearPending: () => void;
};

type ScreenScrollState = {
  isAtBottom: boolean;
  shouldFollowOutput: boolean;
};

type ScreenScrollAction =
  | { type: "measure-bottom"; value: boolean }
  | { type: "pause-following" }
  | { type: "resume-following" }
  | { type: "reset-context" };

const initialScreenScrollState: ScreenScrollState = {
  isAtBottom: true,
  shouldFollowOutput: true,
};

const reduceScreenScrollState = (
  state: ScreenScrollState,
  action: ScreenScrollAction,
): ScreenScrollState => {
  switch (action.type) {
    case "measure-bottom":
      return {
        isAtBottom: action.value,
        shouldFollowOutput: action.value ? true : state.shouldFollowOutput,
      };
    case "pause-following":
      return { ...state, shouldFollowOutput: false };
    case "resume-following":
      return { ...state, shouldFollowOutput: true };
    case "reset-context":
      return { isAtBottom: true, shouldFollowOutput: false };
  }
};

export const useScreenScroll = ({
  paneId,
  mode,
  screenLinesLength,
  isUserScrollingRef,
  onFlushPending,
  onClearPending,
}: UseScreenScrollParams) => {
  const [{ isAtBottom, shouldFollowOutput }, dispatchScrollState] = useReducer(
    reduceScreenScrollState,
    initialScreenScrollState,
  );

  const viewportRef = useRef<VirtualizedViewportHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const clearPending = useEffectEvent(onClearPending);
  // react-doctor-disable-next-line no-event-handler
  const prevModeRef = useRef<ScreenMode>(mode);
  const prevPaneIdRef = useRef<string>(paneId);
  const didInitializeContextRef = useRef(false);
  const snapToBottomRef = useRef(mode === "text");

  const stopFollowingOutput = useCallback(() => {
    dispatchScrollState({ type: "pause-following" });
  }, []);

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth" = "auto") => {
      if (screenLinesLength === 0) return false;
      const hasVirtualizedViewport = Boolean(viewportRef.current);
      const hasScroller = Boolean(scrollerRef.current);
      if (!hasVirtualizedViewport && !hasScroller) {
        return false;
      }
      dispatchScrollState({ type: "resume-following" });
      if (viewportRef.current) {
        viewportRef.current.scrollToEnd({ behavior });
      }
      if (!hasVirtualizedViewport) {
        window.requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          if (scroller != null) {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior });
          }
        });
      }
      return true;
    },
    [screenLinesLength],
  );

  const handleAtBottomChange = useCallback(
    (value: boolean) => {
      dispatchScrollState({ type: "measure-bottom", value });
      if (value && !isUserScrollingRef.current) {
        onFlushPending();
      }
    },
    [isUserScrollingRef, onFlushPending],
  );

  const handleUserScrollStateChange = useCallback(
    (value: boolean) => {
      isUserScrollingRef.current = value;
      if (value) {
        stopFollowingOutput();
        return;
      }
      onFlushPending();
    },
    [isUserScrollingRef, onFlushPending, stopFollowingOutput],
  );

  useLayoutEffect(() => {
    const isInitialContext = !didInitializeContextRef.current;
    const modeChanged = prevModeRef.current !== mode;
    const paneChanged = prevPaneIdRef.current !== paneId;
    if (!isInitialContext && !modeChanged && !paneChanged) {
      return;
    }

    isUserScrollingRef.current = false;
    dispatchScrollState({ type: "reset-context" });
    clearPending();
    snapToBottomRef.current = mode === "text";
    prevModeRef.current = mode;
    prevPaneIdRef.current = paneId;
    didInitializeContextRef.current = true;
  }, [isUserScrollingRef, mode, paneId]);

  useLayoutEffect(() => {
    if (!snapToBottomRef.current || mode !== "text" || screenLinesLength === 0) {
      return;
    }
    const didSnap = scrollToBottom("auto");
    if (didSnap) {
      snapToBottomRef.current = false;
    }
  }, [mode, screenLinesLength, scrollToBottom]);

  useEffect(() => {
    return () => {
      isUserScrollingRef.current = false;
      clearPending();
    };
  }, [isUserScrollingRef]);

  return {
    isAtBottom,
    shouldFollowOutput,
    scrollToBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    viewportRef,
    scrollerRef,
  };
};
