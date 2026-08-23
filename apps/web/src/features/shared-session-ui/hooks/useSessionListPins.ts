import { useCallback, useRef, useState } from "react";

import {
  createRepoPinKey,
  readStoredSessionListPins,
  storeSessionListPins,
  touchSessionListPin,
} from "@/features/shared-session-ui/model/session-list-pins";

type UseSessionListPinsArgs = {
  onTouchPane?: (paneId: string) => Promise<void> | void;
};

export const useSessionListPins = ({ onTouchPane }: UseSessionListPinsArgs) => {
  const [pins, setPins] = useState(() => readStoredSessionListPins());
  const pinsRef = useRef(pins);
  const repoPinValues = pins.repos;

  const getRepoSortAnchorAt = useCallback(
    (repoRoot: string | null) => repoPinValues[createRepoPinKey(repoRoot)] ?? null,
    [repoPinValues],
  );

  const touchRepoPin = useCallback((repoRoot: string | null) => {
    const nextPins = touchSessionListPin(pinsRef.current, "repos", createRepoPinKey(repoRoot));
    pinsRef.current = nextPins;
    setPins(nextPins);
    storeSessionListPins(nextPins);
  }, []);

  const touchPanePin = useCallback(
    (paneId: string) => {
      if (!onTouchPane) {
        return;
      }
      try {
        const result = onTouchPane(paneId);
        void Promise.resolve(result).catch(() => null);
      } catch {
        // Best-effort UI action: ignore unexpected callback failures.
      }
    },
    [onTouchPane],
  );

  return {
    pins,
    getRepoSortAnchorAt,
    touchRepoPin,
    touchPanePin,
  };
};
