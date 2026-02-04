import {
  type Dispatch,
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ScreenLoadingEvent, ScreenMode } from "@/lib/screen-loading";

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
  const [mode, setMode] = useState<ScreenMode>("text");
  const [modeLoaded, setModeLoaded] = useState(initialModeLoaded);
  const modeLoadedRef = useRef(modeLoaded);

  useEffect(() => {
    modeLoadedRef.current = modeLoaded;
  }, [modeLoaded]);

  useEffect(() => {
    setModeLoaded(initialModeLoaded);
  }, [paneId]);

  const markModeLoaded = useCallback((value: ScreenMode) => {
    setModeLoaded((prev) => {
      if (prev[value]) {
        return prev;
      }
      return { ...prev, [value]: true };
    });
  }, []);

  const resetModeLoaded = useCallback(() => {
    setModeLoaded(initialModeLoaded);
  }, []);

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
    [connected, dispatchScreenLoading, mode, modeSwitchRef, cursorRef, screenLinesRef],
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
