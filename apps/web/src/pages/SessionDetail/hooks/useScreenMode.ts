import { useAtom } from "jotai";
import {
  type Dispatch,
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import type { ScreenLoadingEvent, ScreenMode } from "@/lib/screen-loading";

import { screenModeAtom, screenModeLoadedAtom } from "../atoms/screenAtoms";

type UseScreenModeParams = {
  connected: boolean;
  paneId: string;
  dispatchScreenLoading: Dispatch<ScreenLoadingEvent>;
  modeSwitchRef: MutableRefObject<ScreenMode | null>;
  cursorRef: MutableRefObject<string | null>;
  screenLinesRef: MutableRefObject<string[]>;
};

const initialModeLoaded = { text: false, image: false };

export const useScreenMode = ({
  connected,
  paneId,
  dispatchScreenLoading,
  modeSwitchRef,
  cursorRef,
  screenLinesRef,
}: UseScreenModeParams) => {
  const [mode, setMode] = useAtom(screenModeAtom);
  const [modeLoaded, setModeLoaded] = useAtom(screenModeLoadedAtom);
  const modeLoadedRef = useRef(modeLoaded);

  useEffect(() => {
    modeLoadedRef.current = modeLoaded;
  }, [modeLoaded]);

  // Keep pane mode state in sync before useScreenFetch starts its passive request.
  useLayoutEffect(() => {
    modeLoadedRef.current = initialModeLoaded;
    setMode("text");
    setModeLoaded(initialModeLoaded);
  }, [paneId, setMode, setModeLoaded]);

  const markModeLoaded = useCallback(
    (value: ScreenMode) => {
      setModeLoaded((prev) => {
        if (prev[value]) {
          return prev;
        }
        return { ...prev, [value]: true };
      });
    },
    [setModeLoaded],
  );

  const resetModeLoaded = useCallback(() => {
    setModeLoaded(initialModeLoaded);
  }, [setModeLoaded]);

  const handleModeChange = useCallback(
    (value: ScreenMode) => {
      if (value === mode) return;
      if (!connected) {
        modeSwitchRef.current = null;
        dispatchScreenLoading({ type: "reset" });
        setMode(value);
        return;
      }
      cursorRef.current = null;
      screenLinesRef.current = [];
      modeSwitchRef.current = value;
      dispatchScreenLoading({ type: "start", mode: value });
      setMode(value);
    },
    [connected, dispatchScreenLoading, mode, modeSwitchRef, cursorRef, screenLinesRef, setMode],
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
