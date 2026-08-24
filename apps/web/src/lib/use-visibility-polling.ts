import { useEffect, useEffectEvent } from "react";

type UseVisibilityPollingParams = {
  enabled: boolean;
  intervalMs: number;
  onStart?: () => void;
  onTick: () => void;
  onResume?: () => void;
  shouldPoll?: () => boolean;
};

export const useVisibilityPolling = ({
  enabled,
  intervalMs,
  onStart,
  onTick,
  onResume,
  shouldPoll,
}: UseVisibilityPollingParams) => {
  const handleStart = useEffectEvent(() => {
    onStart?.();
  });
  const handleTick = useEffectEvent(onTick);
  const handleResumeCallback = useEffectEvent(() => {
    onResume?.();
  });
  const checkShouldPoll = useEffectEvent(() => shouldPoll?.() ?? true);

  // Keep the historical contract: changing the poll predicate restarts the interval.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    let intervalId: number | null = null;
    const canPoll = () => {
      if (document.hidden) return false;
      if (navigator.onLine === false) return false;
      if (!checkShouldPoll()) return false;
      return true;
    };
    const stop = () => {
      if (intervalId == null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };
    const start = () => {
      if (intervalId != null) return;
      intervalId = window.setInterval(() => {
        if (!canPoll()) {
          stop();
          return;
        }
        handleTick();
      }, intervalMs);
    };
    const handleResume = () => {
      if (!canPoll()) {
        stop();
        return;
      }
      handleResumeCallback();
      start();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted && document.visibilityState !== "visible") {
        return;
      }
      handleResume();
    };

    if (canPoll()) {
      handleStart();
      start();
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("online", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("offline", stop);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("online", handleResume);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("offline", stop);
    };
  }, [enabled, intervalMs, shouldPoll]);
};
