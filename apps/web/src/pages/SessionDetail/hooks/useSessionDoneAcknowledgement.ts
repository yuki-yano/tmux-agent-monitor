import type { SessionDetail } from "@vde-monitor/shared";
import { useEffect } from "react";

const ACKNOWLEDGEMENT_RETRY_DELAYS_MS = [250, 750] as const;

type AcknowledgeSessionView = (paneId: string, epoch: string, throughSeq: number) => Promise<void>;

const acknowledgementRequests = new WeakMap<AcknowledgeSessionView, Map<string, Promise<void>>>();

const requestAcknowledgement = (
  acknowledgeSessionView: AcknowledgeSessionView,
  paneId: string,
  epoch: string,
  completedSeq: number,
) => {
  let requests = acknowledgementRequests.get(acknowledgeSessionView);
  if (!requests) {
    requests = new Map();
    acknowledgementRequests.set(acknowledgeSessionView, requests);
  }
  const key = `${paneId}\0${epoch}\0${completedSeq}`;
  const inFlight = requests.get(key);
  if (inFlight) {
    return inFlight;
  }
  const request = acknowledgeSessionView(paneId, epoch, completedSeq).finally(() => {
    if (requests.get(key) === request) {
      requests.delete(key);
    }
  });
  requests.set(key, request);
  return request;
};

export const useSessionDoneAcknowledgement = ({
  paneId,
  session,
  acknowledgeSessionView,
}: {
  paneId: string;
  session: SessionDetail | null;
  acknowledgeSessionView: AcknowledgeSessionView;
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
      void requestAcknowledgement(acknowledgeSessionView, paneId, epoch, completedSeq)
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
