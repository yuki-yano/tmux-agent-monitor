import { useAtom } from "jotai";
import { type Dispatch, type MutableRefObject, useCallback, useLayoutEffect, useRef } from "react";

import type { ScreenLoadingEvent, ScreenMode } from "@/lib/screen-loading";

import { screenModeAtom, screenModeLoadedAtom } from "../atoms/screenAtoms";

type UseScreenModeParams = {
  connected: boolean;
  paneId: string;
  dispatchScreenLoading: Dispatch<ScreenLoadingEvent>;
  modeSwitchRef: MutableRefObject<ScreenMode | null>;
  resetDeltaBase: () => void;
};

const initialModeLoaded = { text: false, image: false };

export const useScreenMode = ({
  connected,
  paneId,
  dispatchScreenLoading,
  modeSwitchRef,
  resetDeltaBase,
}: UseScreenModeParams) => {
  const [mode, setMode] = useAtom(screenModeAtom);
  const [modeLoaded, setModeLoaded] = useAtom(screenModeLoadedAtom);
  const modeLoadedRef = useRef(modeLoaded);

  const updateModeLoaded = useCallback(
    (next: typeof initialModeLoaded) => {
      modeLoadedRef.current = next;
      setModeLoaded(next);
    },
    [setModeLoaded],
  );

  // Keep pane mode state in sync before useScreenFetch starts its passive request.
  useLayoutEffect(() => {
    setMode("text");
    updateModeLoaded(initialModeLoaded);
  }, [paneId, setMode, updateModeLoaded]);

  const markModeLoaded = useCallback(
    (value: ScreenMode) => {
      setModeLoaded((previous) => {
        const next = previous[value] ? previous : { ...previous, [value]: true };
        modeLoadedRef.current = next;
        return next;
      });
    },
    [setModeLoaded],
  );

  const resetModeLoaded = useCallback(() => {
    updateModeLoaded(initialModeLoaded);
  }, [updateModeLoaded]);

  const handleModeChange = useCallback(
    (value: ScreenMode) => {
      if (value === mode) return;
      if (!connected) {
        modeSwitchRef.current = null;
        dispatchScreenLoading({ type: "reset" });
        setMode(value);
        return;
      }
      resetDeltaBase();
      modeSwitchRef.current = value;
      dispatchScreenLoading({ type: "start", mode: value });
      setMode(value);
    },
    [connected, dispatchScreenLoading, mode, modeSwitchRef, resetDeltaBase, setMode],
  );

  return {
    mode,
    modeLoaded,
    modeLoadedRef,
    handleModeChange,
    markModeLoaded,
    resetModeLoaded,
  };
};
