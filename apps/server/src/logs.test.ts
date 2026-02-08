import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  truncate: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  open: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mocks.mkdir,
    stat: mocks.stat,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    truncate: mocks.truncate,
    readdir: mocks.readdir,
    unlink: mocks.unlink,
    open: mocks.open,
  },
  mkdir: mocks.mkdir,
  stat: mocks.stat,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  truncate: mocks.truncate,
  readdir: mocks.readdir,
  unlink: mocks.unlink,
  open: mocks.open,
}));

import { createJsonlTailer, createLogActivityPoller } from "./logs";

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createLogActivityPoller", () => {
  it("does not overlap polling while previous tick is still in progress", async () => {
    const firstStat = deferred<{ size: number }>();
    mocks.stat.mockImplementationOnce(() => firstStat.promise).mockResolvedValue({ size: 0 });

    const poller = createLogActivityPoller(1000);
    poller.register("%1", "/tmp/pane.log");
    poller.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.stat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.stat).toHaveBeenCalledTimes(1);

    firstStat.resolve({ size: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.stat).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("stops polling entries after unregister", async () => {
    mocks.stat.mockResolvedValue({ size: 0 });

    const poller = createLogActivityPoller(1000);
    poller.register("%1", "/tmp/pane-1.log");
    poller.register("%2", "/tmp/pane-2.log");
    poller.unregister("%1");
    poller.start();

    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.stat).toHaveBeenCalledTimes(1);
    expect(mocks.stat).toHaveBeenCalledWith("/tmp/pane-2.log");

    poller.stop();
  });
});

describe("createJsonlTailer", () => {
  it("does not overlap polling while previous tick is still in progress", async () => {
    const firstStat = deferred<{ size: number }>();
    mocks.stat.mockImplementationOnce(() => firstStat.promise).mockResolvedValue({ size: 0 });

    const tailer = createJsonlTailer(1000);
    tailer.start("/tmp/events.jsonl");

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.stat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.stat).toHaveBeenCalledTimes(1);

    firstStat.resolve({ size: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.stat).toHaveBeenCalledTimes(2);

    tailer.stop();
  });
});
