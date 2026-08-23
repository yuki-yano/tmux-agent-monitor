import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  DEFAULT_PULL_GESTURE_CONFIG,
  type PullGestureConfig,
  createPullGestureTracker,
} from "./pull-gesture";

type PullToRefreshContainerProps = {
  onRefresh: () => Promise<void> | void;
  refreshingContent: ReactNode;
  config?: PullGestureConfig;
  children: ReactNode;
};

const RELEASE_TRANSITION = "transform 0.2s cubic-bezier(0, 0, 0.31, 1)";

const hasScrolledAncestor = (element: Element | null, boundary: Element) => {
  let current = element;
  while (current != null && current !== boundary) {
    if (current.scrollTop > 0) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

export const PullToRefreshContainer = ({
  onRefresh,
  refreshingContent,
  config = DEFAULT_PULL_GESTURE_CONFIG,
  children,
}: PullToRefreshContainerProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const handleRefresh = useEffectEvent(onRefresh);

  useEffect(() => {
    document.documentElement.classList.add("pull-to-refresh-enabled");
    return () => {
      document.documentElement.classList.remove("pull-to-refresh-enabled");
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (content == null) {
      return;
    }
    const tracker = createPullGestureTracker(config);
    let pulling = false;

    const setTranslate = (px: number, animate: boolean) => {
      content.style.transition = animate ? RELEASE_TRANSITION : "none";
      content.style.transform = px > 0 ? `translate3d(0, ${px}px, 0)` : "";
    };

    const releasePull = () => {
      if (pulling) {
        pulling = false;
        setTranslate(0, true);
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) {
        tracker.cancel();
        releasePull();
        return;
      }
      const touch = event.touches[0];
      if (touch == null) {
        tracker.cancel();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const canPull = window.scrollY <= 0 && !hasScrolledAncestor(target, content);
      tracker.start(touch.clientX, touch.clientY, canPull);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracker.cancel();
        releasePull();
        return;
      }
      const touch = event.touches[0];
      if (touch == null) {
        tracker.cancel();
        releasePull();
        return;
      }
      const result = tracker.move(touch.clientX, touch.clientY);
      if (result.phase === "pulling") {
        if (result.preventDefault && event.cancelable) {
          event.preventDefault();
        }
        pulling = true;
        setTranslate(result.pullDistancePx, false);
        return;
      }
      releasePull();
    };

    const handleTouchEnd = () => {
      const { shouldRefresh } = tracker.end();
      releasePull();
      if (!shouldRefresh) {
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      const finishRefreshing = () => {
        refreshingRef.current = false;
        setRefreshing(false);
      };
      try {
        void Promise.resolve(handleRefresh())
          .catch(() => undefined)
          .finally(finishRefreshing);
      } catch {
        finishRefreshing();
      }
    };

    const handleTouchCancel = () => {
      tracker.cancel();
      releasePull();
    };

    content.addEventListener("touchstart", handleTouchStart, { passive: true });
    content.addEventListener("touchmove", handleTouchMove, { passive: false });
    content.addEventListener("touchend", handleTouchEnd, { passive: true });
    content.addEventListener("touchcancel", handleTouchCancel, { passive: true });
    return () => {
      content.removeEventListener("touchstart", handleTouchStart);
      content.removeEventListener("touchmove", handleTouchMove);
      content.removeEventListener("touchend", handleTouchEnd);
      content.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [config]);

  return (
    <>
      {refreshing ? refreshingContent : null}
      <div ref={contentRef}>{children}</div>
    </>
  );
};
