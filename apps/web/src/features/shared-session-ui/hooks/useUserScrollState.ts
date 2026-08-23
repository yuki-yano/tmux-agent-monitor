import { type RefObject, useEffectEvent, useLayoutEffect, useRef } from "react";

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
  const notifyUserScrollStateChange = useEffectEvent((value: boolean) => {
    onUserScrollStateChange?.(value);
  });

  useLayoutEffect(() => {
    const setUserScrolling = (value: boolean) => {
      if (isUserScrollingRef.current === value) {
        return;
      }
      isUserScrollingRef.current = value;
      notifyUserScrollStateChange(value);
    };
    const scheduleScrollEnd = () => {
      if (scrollEndTimerRef.current != null) {
        window.clearTimeout(scrollEndTimerRef.current);
      }
      scrollEndTimerRef.current = window.setTimeout(() => {
        scrollEndTimerRef.current = null;
        setUserScrolling(false);
      }, 120);
    };
    const startUserScroll = () => {
      setUserScrolling(true);
      scheduleScrollEnd();
    };
    const handleScroll = () => {
      if (isUserScrollingRef.current) {
        scheduleScrollEnd();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) {
        startUserScroll();
      }
    };

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
  }, [enabled, scrollerRef]);

  return { scrollerRef };
};
