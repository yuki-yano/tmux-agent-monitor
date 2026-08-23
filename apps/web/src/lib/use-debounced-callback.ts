import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { useTimeout } from "./use-timeout";

type DebouncedCallback<A extends unknown[]> = {
  run: (...args: A) => void;
  cancel: () => void;
};

/**
 * Debounces `callback`: each call re-arms the delay with the latest
 * arguments, so only the last call within `delayMs` actually runs.
 * `.cancel()` discards a pending call; unmount clears it automatically.
 */
export const useDebouncedCallback = <A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
): DebouncedCallback<A> => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const { set: setTimeout, cancel } = useTimeout();

  const run = useCallback(
    (...args: A) => {
      setTimeout(() => {
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs, setTimeout],
  );

  return useMemo(() => ({ run, cancel }), [cancel, run]);
};
