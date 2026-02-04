import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import type { ScreenMode } from "@/lib/screen-loading";

type UseScreenScrollParams = {
  mode: ScreenMode;
  screenLinesLength: number;
  isUserScrollingRef: MutableRefObject<boolean>;
  onFlushPending: () => void;
  onClearPending: () => void;
};

export const useScreenScroll = ({
  mode,
  screenLinesLength,
  isUserScrollingRef,
  onFlushPending,
  onClearPending,
}: UseScreenScrollParams) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [forceFollow, setForceFollow] = useState(false);

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const forceFollowTimerRef = useRef<number | null>(null);
  const prevModeRef = useRef<ScreenMode>(mode);
  const snapToBottomRef = useRef(false);

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth" = "auto") => {
      if (!virtuosoRef.current || screenLinesLength === 0) return;
      const index = screenLinesLength - 1;
      virtuosoRef.current.scrollToIndex({ index, align: "end", behavior });
      setForceFollow(true);
      if (forceFollowTimerRef.current !== null) {
        window.clearTimeout(forceFollowTimerRef.current);
      }
      forceFollowTimerRef.current = window.setTimeout(() => {
        setForceFollow(false);
        forceFollowTimerRef.current = null;
      }, 500);
      window.requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        if (scroller) {
          scroller.scrollTo({ top: scroller.scrollHeight, left: 0, behavior });
        }
      });
    },
    [screenLinesLength],
  );

  const handleAtBottomChange = useCallback(
    (value: boolean) => {
      setIsAtBottom(value);
      if (value) {
        setForceFollow(false);
        if (forceFollowTimerRef.current !== null) {
          window.clearTimeout(forceFollowTimerRef.current);
          forceFollowTimerRef.current = null;
        }
        onFlushPending();
      }
    },
    [onFlushPending],
  );

  const handleUserScrollStateChange = useCallback(
    (value: boolean) => {
      isUserScrollingRef.current = value;
      if (!value) {
        onFlushPending();
      }
    },
    [isUserScrollingRef, onFlushPending],
  );

  useEffect(() => {
    const prevMode = prevModeRef.current;
    if (prevMode === "image" && mode === "text") {
      snapToBottomRef.current = true;
    }
    prevModeRef.current = mode;
  }, [mode]);

  useLayoutEffect(() => {
    if (!snapToBottomRef.current || mode !== "text") {
      return;
    }
    scrollToBottom("auto");
    snapToBottomRef.current = false;
  }, [mode, screenLinesLength, scrollToBottom]);

  useEffect(() => {
    if (mode !== "text") {
      setIsAtBottom(true);
      setForceFollow(false);
      onClearPending();
    }
  }, [mode, onClearPending]);

  useEffect(() => {
    return () => {
      if (forceFollowTimerRef.current !== null) {
        window.clearTimeout(forceFollowTimerRef.current);
      }
    };
  }, []);

  return {
    isAtBottom,
    forceFollow,
    scrollToBottom,
    handleAtBottomChange,
    handleUserScrollStateChange,
    virtuosoRef,
    scrollerRef,
  };
};
