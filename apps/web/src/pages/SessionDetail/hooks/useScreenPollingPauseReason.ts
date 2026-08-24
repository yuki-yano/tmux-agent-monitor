import { useSyncExternalStore } from "react";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

type PollingPauseReason = "disconnected" | "unauthorized" | "offline" | "hidden" | null;

const resolvePollingPauseReason = ({
  connected,
  connectionIssue,
  browserPauseReason,
}: {
  connected: boolean;
  connectionIssue: string | null;
  browserPauseReason: Extract<PollingPauseReason, "offline" | "hidden" | null>;
}): PollingPauseReason => {
  if (!connected) {
    return "disconnected";
  }
  if (connectionIssue === API_ERROR_MESSAGES.unauthorized) {
    return "unauthorized";
  }
  return browserPauseReason;
};

const getBrowserPauseReasonSnapshot = (): Extract<
  PollingPauseReason,
  "offline" | "hidden" | null
> => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  if (typeof document !== "undefined" && document.hidden) {
    return "hidden";
  }
  return null;
};

const getServerBrowserPauseReasonSnapshot = () => null;

const subscribeToBrowserPauseReason = (update: () => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const targetDocument = typeof document !== "undefined" ? document : null;
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  targetDocument?.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
    targetDocument?.removeEventListener("visibilitychange", update);
    window.removeEventListener("focus", update);
  };
};

export const useScreenPollingPauseReason = ({
  connected,
  connectionIssue,
}: {
  connected: boolean;
  connectionIssue: string | null;
}) => {
  const browserPauseReason = useSyncExternalStore(
    subscribeToBrowserPauseReason,
    getBrowserPauseReasonSnapshot,
    getServerBrowserPauseReasonSnapshot,
  );
  return resolvePollingPauseReason({ connected, connectionIssue, browserPauseReason });
};
