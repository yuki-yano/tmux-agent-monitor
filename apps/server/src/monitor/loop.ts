import { rotateLogIfNeeded } from "../logs.js";

type LoopDeps = {
  rotateLogIfNeeded?: typeof rotateLogIfNeeded;
};

type LoopArgs = {
  intervalMs: number;
  eventLogPath: string;
  maxEventLogBytes: number;
  retainRotations: number;
  updateFromPanes: () => Promise<void>;
};

export const createMonitorLoop = (
  { intervalMs, eventLogPath, maxEventLogBytes, retainRotations, updateFromPanes }: LoopArgs,
  deps: LoopDeps = {},
) => {
  const rotate = deps.rotateLogIfNeeded ?? rotateLogIfNeeded;
  let timer: NodeJS.Timeout | null = null;

  const tick = () => {
    updateFromPanes().catch(() => null);
    rotate(eventLogPath, maxEventLogBytes, retainRotations).catch(() => null);
  };

  const start = () => {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { start, stop };
};
