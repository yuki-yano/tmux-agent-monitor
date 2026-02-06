import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { mapAnchorIndex } from "./scroll-stability";

type Range = { startIndex: number; endIndex: number };

type UseStableVirtuosoScrollParams = {
  items: string[];
  isAtBottom: boolean;
  enabled?: boolean;
  isUserScrolling?: boolean;
  scrollerRef?: RefObject<HTMLDivElement | null>;
  onUserScrollStateChange?: (isScrolling: boolean) => void;
};

const getItemOffset = (scroller: HTMLDivElement, index: number) => {
  const item = scroller.querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (!item) return null;
  const scrollerRect = scroller.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  return itemRect.top - scrollerRect.top;
};

const clampIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
};

const getItem = (scroller: HTMLDivElement, index: number) =>
  scroller.querySelector<HTMLElement>(`[data-index="${index}"]`);

const getItemHeight = (item: HTMLElement | null) =>
  item ? item.getBoundingClientRect().height : null;

const resolveScrollDelta = ({
  nextOffset,
  prevOffset,
  prevAnchorHeight,
  nextHeight,
  nextIndex,
  anchorIndex,
}: {
  nextOffset: number | null;
  prevOffset: number | null;
  prevAnchorHeight: number | null;
  nextHeight: number | null;
  nextIndex: number;
  anchorIndex: number;
}) => {
  if (nextOffset !== null && prevOffset !== null) {
    return nextOffset - prevOffset;
  }
  const lineHeight = prevAnchorHeight ?? nextHeight;
  if (!lineHeight || nextIndex === anchorIndex) {
    return null;
  }
  return (nextIndex - anchorIndex) * lineHeight;
};

const shouldSuppressCorrection = ({
  isInternalUserScrolling,
  isExternalUserScrolling,
  recentlyScrolled,
  allowCorrectionOnce,
}: {
  isInternalUserScrolling: boolean;
  isExternalUserScrolling: boolean;
  recentlyScrolled: boolean;
  allowCorrectionOnce: boolean;
}) => {
  if (isInternalUserScrolling || isExternalUserScrolling) {
    return true;
  }
  return recentlyScrolled && !allowCorrectionOnce;
};

export const useStableVirtuosoScroll = ({
  items,
  isAtBottom,
  enabled = true,
  isUserScrolling,
  scrollerRef: scrollerRefProp,
  onUserScrollStateChange,
}: UseStableVirtuosoScrollParams) => {
  const internalScrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = scrollerRefProp ?? internalScrollerRef;
  const anchorIndexRef = useRef(0);
  const prevAnchorIndexRef = useRef(0);
  const prevAnchorOffsetRef = useRef<number | null>(null);
  const prevAnchorHeightRef = useRef<number | null>(null);
  const prevScrollTopRef = useRef<number | null>(null);
  const prevItemsRef = useRef(items);
  const isUserScrollingRef = useRef(false);
  const lastUserScrollAtRef = useRef(0);
  const scrollEndTimerRef = useRef<number | null>(null);
  const isAdjustingRef = useRef(false);
  const allowCorrectionOnceRef = useRef(false);
  const scrollSuppressMs = 300;
  const onUserScrollStateChangeRef = useRef(onUserScrollStateChange);

  useEffect(() => {
    onUserScrollStateChangeRef.current = onUserScrollStateChange;
  }, [onUserScrollStateChange]);

  const updateBaseline = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const clamped = clampIndex(index, items.length);
      const item = getItem(scroller, clamped);
      const offset = item ? getItemOffset(scroller, clamped) : null;
      const height = getItemHeight(item);
      prevAnchorOffsetRef.current = offset;
      prevAnchorHeightRef.current = height;
      prevAnchorIndexRef.current = clamped;
      prevScrollTopRef.current = scroller.scrollTop;
    },
    [items.length, scrollerRef],
  );

  const handleRangeChanged = useCallback(
    (range: Range) => {
      anchorIndexRef.current = range.startIndex;
      const recentlyScrolled = performance.now() - lastUserScrollAtRef.current < scrollSuppressMs;
      if (isUserScrollingRef.current || isUserScrolling || recentlyScrolled) {
        updateBaseline(range.startIndex);
      }
    },
    [isUserScrolling, updateBaseline],
  );

  const setUserScrolling = useCallback(
    (value: boolean) => {
      if (isUserScrollingRef.current === value) return;
      isUserScrollingRef.current = value;
      if (!value) {
        updateBaseline(anchorIndexRef.current);
        allowCorrectionOnceRef.current = true;
      }
      onUserScrollStateChangeRef.current?.(value);
    },
    [updateBaseline],
  );

  const scheduleScrollEnd = useCallback(() => {
    if (scrollEndTimerRef.current !== null) {
      window.clearTimeout(scrollEndTimerRef.current);
    }
    scrollEndTimerRef.current = window.setTimeout(() => {
      setUserScrolling(false);
      scrollEndTimerRef.current = null;
    }, 120);
  }, [setUserScrolling]);

  const startUserScroll = useCallback(() => {
    if (isAdjustingRef.current) return;
    setUserScrolling(true);
    lastUserScrollAtRef.current = performance.now();
    updateBaseline(anchorIndexRef.current);
    scheduleScrollEnd();
  }, [scheduleScrollEnd, setUserScrolling, updateBaseline]);
  const handleScrollEvent = useCallback(
    (event: Event) => {
      if (event.type === "scroll" && !event.isTrusted) {
        if (!isAdjustingRef.current) {
          lastUserScrollAtRef.current = performance.now();
          allowCorrectionOnceRef.current = false;
        }
        updateBaseline(anchorIndexRef.current);
        return;
      }
      startUserScroll();
    },
    [startUserScroll, updateBaseline],
  );

  const withAdjustingScroll = useCallback((scroller: HTMLDivElement, nextScrollTop: number) => {
    isAdjustingRef.current = true;
    scroller.scrollTop = nextScrollTop;
    window.requestAnimationFrame(() => {
      isAdjustingRef.current = false;
    });
  }, []);

  const applyAnchorCorrection = useCallback(
    (scroller: HTMLDivElement, prevItems: string[]) => {
      const anchorIndex = clampIndex(prevAnchorIndexRef.current, prevItems.length);
      const nextIndex = mapAnchorIndex(prevItems, items, anchorIndex);
      const nextItem = getItem(scroller, nextIndex);
      const nextOffset = nextItem ? getItemOffset(scroller, nextIndex) : null;
      const nextHeight = getItemHeight(nextItem);
      const delta = resolveScrollDelta({
        nextOffset,
        prevOffset: prevAnchorOffsetRef.current,
        prevAnchorHeight: prevAnchorHeightRef.current,
        nextHeight,
        nextIndex,
        anchorIndex,
      });

      if (delta !== null && Math.abs(delta) >= 0.5) {
        withAdjustingScroll(scroller, scroller.scrollTop + delta);
        return;
      }
      if (prevScrollTopRef.current !== null) {
        withAdjustingScroll(scroller, prevScrollTopRef.current);
      }
    },
    [items, withAdjustingScroll],
  );

  const isScrollCorrectionSuppressed = useCallback(() => {
    const recentlyScrolled = performance.now() - lastUserScrollAtRef.current < scrollSuppressMs;
    return shouldSuppressCorrection({
      isInternalUserScrolling: isUserScrollingRef.current,
      isExternalUserScrolling: Boolean(isUserScrolling),
      recentlyScrolled,
      allowCorrectionOnce: allowCorrectionOnceRef.current,
    });
  }, [isUserScrolling]);

  const resetStabilityState = useCallback(() => {
    prevAnchorOffsetRef.current = null;
    prevAnchorHeightRef.current = null;
    prevScrollTopRef.current = null;
    prevAnchorIndexRef.current = 0;
    allowCorrectionOnceRef.current = false;
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    scroller.addEventListener("scroll", handleScrollEvent, { passive: true });
    scroller.addEventListener("wheel", handleScrollEvent, { passive: true });
    scroller.addEventListener("touchmove", handleScrollEvent, { passive: true });
    scroller.addEventListener("pointerdown", handleScrollEvent, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScrollEvent);
      scroller.removeEventListener("wheel", handleScrollEvent);
      scroller.removeEventListener("touchmove", handleScrollEvent);
      scroller.removeEventListener("pointerdown", handleScrollEvent);
    };
  }, [enabled, handleScrollEvent, scrollerRef]);

  useEffect(() => {
    return () => {
      if (scrollEndTimerRef.current !== null) {
        window.clearTimeout(scrollEndTimerRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!enabled) {
      prevItemsRef.current = items;
      resetStabilityState();
      return;
    }

    const scroller = scrollerRef.current;
    const prevItems = prevItemsRef.current;
    const itemsChanged = prevItems !== items;
    const canCorrect = itemsChanged && scroller && !isAtBottom && !isScrollCorrectionSuppressed();
    if (canCorrect) {
      applyAnchorCorrection(scroller, prevItems);
    }

    if (itemsChanged) {
      allowCorrectionOnceRef.current = false;
    }

    if (scroller) {
      const currentIndex = clampIndex(anchorIndexRef.current, items.length);
      updateBaseline(currentIndex);
    }

    prevItemsRef.current = items;
  }, [
    items,
    isAtBottom,
    enabled,
    scrollerRef,
    updateBaseline,
    applyAnchorCorrection,
    isScrollCorrectionSuppressed,
    resetStabilityState,
  ]);

  return {
    scrollerRef,
    handleRangeChanged,
  };
};

export const __testables = {
  shouldSuppressCorrection,
};
