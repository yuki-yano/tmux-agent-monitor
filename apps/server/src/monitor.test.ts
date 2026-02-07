import { describe, expect, it, vi } from "vitest";

import { mapWithConcurrencyLimit } from "./monitor.js";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const createDeferred = (): Deferred => {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("mapWithConcurrencyLimit", () => {
  it("processes items in parallel up to limit while preserving result order", async () => {
    const starts: number[] = [];
    const gates = [createDeferred(), createDeferred(), createDeferred()];

    const resultPromise = mapWithConcurrencyLimit([1, 2, 3], 2, async (item) => {
      starts.push(item);
      await gates[item - 1]?.promise;
      return item * 10;
    });

    await vi.waitFor(() => {
      expect(starts).toEqual([1, 2]);
    });

    gates[0]?.resolve();
    await vi.waitFor(() => {
      expect(starts).toEqual([1, 2, 3]);
    });

    gates[1]?.resolve();
    gates[2]?.resolve();
    const result = await resultPromise;
    expect(result).toEqual([10, 20, 30]);
  });

  it("treats non-positive limit as 1", async () => {
    const result = await mapWithConcurrencyLimit([1, 2, 3], 0, async (item) => item + 1);
    expect(result).toEqual([2, 3, 4]);
  });
});
