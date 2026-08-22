import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

type UseUserScrollStateParams = {
  enabled?: boolean;
  scrollerRef?: RefObject<HTMLDivElement | null>;
  onUserScrollStateChange?: (isScrolling: boolean) => void;
};

export const useUserScrollState = ({
  enabled = true,
  scrollerRef: scrollerRefProp,
  onUserScrollStateChange,
}: UseUserScrollStateParams) => {
  const internalScrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = scrollerRefProp ?? internalScrollerRef;
  const isUserScrollingRef = useRef(false);
  const scrollEndTimerRef = useRef<number | null>(null);
  const onUserScrollStateChangeRef = useRef(onUserScrollStateChange);

  useLayoutEffect(() => {
    onUserScrollStateChangeRef.current = onUserScrollStateChange;
  }, [onUserScrollStateChange]);

  const setUserScrolling = useCallback((value: boolean) => {
    if (isUserScrollingRef.current === value) {
      return;
    }
    isUserScrollingRef.current = value;
    onUserScrollStateChangeRef.current?.(value);
  }, []);

  const scheduleScrollEnd = useCallback(() => {
    if (scrollEndTimerRef.current != null) {
      window.clearTimeout(scrollEndTimerRef.current);
    }
    scrollEndTimerRef.current = window.setTimeout(() => {
      scrollEndTimerRef.current = null;
      setUserScrolling(false);
    }, 120);
  }, [setUserScrolling]);

  const startUserScroll = useCallback(() => {
    setUserScrolling(true);
    scheduleScrollEnd();
  }, [scheduleScrollEnd, setUserScrolling]);

  const handleScroll = useCallback(() => {
    if (isUserScrollingRef.current) {
      scheduleScrollEnd();
    }
  }, [scheduleScrollEnd]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) {
        startUserScroll();
      }
    },
    [startUserScroll],
  );

  useLayoutEffect(() => {
    if (!enabled) {
      setUserScrolling(false);
      return undefined;
    }
    const scroller = scrollerRef.current;
    if (!scroller) {
      return undefined;
    }
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    scroller.addEventListener("wheel", startUserScroll, { passive: true });
    scroller.addEventListener("touchmove", startUserScroll, { passive: true });
    scroller.addEventListener("pointerdown", startUserScroll, { passive: true });
    scroller.addEventListener("keydown", handleKeyDown);
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      scroller.removeEventListener("wheel", startUserScroll);
      scroller.removeEventListener("touchmove", startUserScroll);
      scroller.removeEventListener("pointerdown", startUserScroll);
      scroller.removeEventListener("keydown", handleKeyDown);
      if (scrollEndTimerRef.current != null) {
        window.clearTimeout(scrollEndTimerRef.current);
        scrollEndTimerRef.current = null;
      }
      setUserScrolling(false);
    };
  }, [enabled, handleKeyDown, handleScroll, scrollerRef, setUserScrolling, startUserScroll]);

  return { scrollerRef };
};
