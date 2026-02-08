import { useEffect } from "react";

type UseVisibilityPollingParams = {
  enabled: boolean;
  intervalMs: number;
  onTick: () => void;
  onResume?: () => void;
  shouldPoll?: () => boolean;
};

export const useVisibilityPolling = ({
  enabled,
  intervalMs,
  onTick,
  onResume,
  shouldPoll,
}: UseVisibilityPollingParams) => {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    let intervalId: number | null = null;
    const canPoll = () => {
      if (document.hidden) return false;
      if (navigator.onLine === false) return false;
      if (shouldPoll && !shouldPoll()) return false;
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
        onTick();
      }, intervalMs);
    };
    const handleResume = () => {
      if (!canPoll()) {
        stop();
        return;
      }
      if (onResume) {
        onResume();
      }
      start();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted && document.visibilityState !== "visible") {
        return;
      }
      handleResume();
    };

    if (canPoll()) {
      start();
    }

    window.addEventListener("visibilitychange", handleResume);
    window.addEventListener("online", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("offline", stop);

    return () => {
      stop();
      window.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("online", handleResume);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("offline", stop);
    };
  }, [enabled, intervalMs, onResume, onTick, shouldPoll]);
};
