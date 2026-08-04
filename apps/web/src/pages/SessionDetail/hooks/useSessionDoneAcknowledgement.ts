import type { SessionDetail } from "@vde-monitor/shared";
import { useEffect } from "react";

const ACKNOWLEDGEMENT_RETRY_DELAYS_MS = [250, 750] as const;

export const useSessionDoneAcknowledgement = ({
  paneId,
  session,
  acknowledgeSessionView,
}: {
  paneId: string;
  session: SessionDetail | null;
  acknowledgeSessionView: (paneId: string, epoch: string, throughSeq: number) => Promise<void>;
}) => {
  const completion = session?.paneId === paneId ? (session.completion ?? null) : null;
  const epoch = completion?.epoch ?? null;
  const completedSeq = completion?.completedSeq ?? 0;
  const acknowledgedSeq = completion?.acknowledgedSeq ?? 0;

  // clearRetry releases the timer and the returned cleanup also removes the visibility listener.
  // react-doctor-disable-next-line effect-needs-cleanup
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let retryIndex = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer != null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const acknowledgeIfVisible = () => {
      if (
        cancelled ||
        inFlight ||
        document.visibilityState !== "visible" ||
        epoch == null ||
        completedSeq <= acknowledgedSeq
      ) {
        return;
      }
      inFlight = true;
      void acknowledgeSessionView(paneId, epoch, completedSeq)
        .catch(() => {
          if (cancelled || document.visibilityState !== "visible") {
            return;
          }
          const retryDelayMs = ACKNOWLEDGEMENT_RETRY_DELAYS_MS[retryIndex];
          retryIndex += 1;
          if (retryDelayMs == null) {
            return;
          }
          retryTimer = setTimeout(() => {
            retryTimer = null;
            acknowledgeIfVisible();
          }, retryDelayMs);
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const handleVisibilityChange = () => {
      clearRetry();
      if (document.visibilityState === "visible") {
        retryIndex = 0;
        acknowledgeIfVisible();
      }
    };

    acknowledgeIfVisible();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      clearRetry();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [acknowledgeSessionView, acknowledgedSeq, completedSeq, epoch, paneId]);
};
