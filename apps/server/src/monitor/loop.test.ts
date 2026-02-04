import { describe, expect, it, vi } from "vitest";

import { createMonitorLoop } from "./loop.js";

describe("createMonitorLoop", () => {
  it("invokes update and rotate on tick", async () => {
    vi.useFakeTimers();
    const updateFromPanes = vi.fn(async () => {});
    const rotateLogIfNeeded = vi.fn(async () => {});
    const loop = createMonitorLoop(
      {
        intervalMs: 1000,
        eventLogPath: "/tmp/events.log",
        maxEventLogBytes: 10,
        retainRotations: 1,
        updateFromPanes,
      },
      { rotateLogIfNeeded },
    );

    loop.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateFromPanes).toHaveBeenCalled();
    expect(rotateLogIfNeeded).toHaveBeenCalledWith("/tmp/events.log", 10, 1);
    loop.stop();
    vi.useRealTimers();
  });
});
