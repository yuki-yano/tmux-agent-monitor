import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { useTimeout } from "./use-timeout";

type DebouncedFunction<A extends unknown[]> = ((...args: A) => void) & {
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
): DebouncedFunction<A> => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const timer = useTimeout();

  const run = useCallback(
    (...args: A) => {
      timer.set(() => {
        callbackRef.current(...args);
      }, delayMs);
    },
    [timer, delayMs],
  );

  return useMemo(() => Object.assign(run, { cancel: timer.cancel }), [run, timer]);
};
