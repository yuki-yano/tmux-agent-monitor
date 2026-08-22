import { describe, expect, it } from "vitest";

import { createVirtualLineItemsState, reconcileVirtualLineItems } from "./virtual-line-items";

const ids = (state: ReturnType<typeof createVirtualLineItemsState>) =>
  state.items.map((item) => item.id);

describe("reconcileVirtualLineItems", () => {
  it("keeps existing ids when lines are appended", () => {
    const previous = createVirtualLineItemsState(["a", "b"]);
    const next = reconcileVirtualLineItems(previous, ["a", "b", "c"]);

    expect(ids(next).slice(0, 2)).toEqual(ids(previous));
    expect(ids(next)[2]).not.toBe(ids(previous)[1]);
  });

  it("keeps overlapping ids when a capped buffer rolls forward", () => {
    const previous = createVirtualLineItemsState(["a", "b", "c", "d"]);
    const next = reconcileVirtualLineItems(previous, ["b", "c", "d", "e"]);

    expect(ids(next).slice(0, 3)).toEqual(ids(previous).slice(1));
    expect(ids(next)[3]).not.toBe(ids(previous)[0]);
  });

  it("keeps existing ids when lines are prepended", () => {
    const previous = createVirtualLineItemsState(["c", "d"]);
    const next = reconcileVirtualLineItems(previous, ["a", "b", "c", "d"]);

    expect(ids(next).slice(2)).toEqual(ids(previous));
  });

  it("keeps the row id for an in-place update", () => {
    const previous = createVirtualLineItemsState(["a", "working", "c"]);
    const next = reconcileVirtualLineItems(previous, ["a", "done", "c"]);

    expect(ids(next)).toEqual(ids(previous));
    expect(next.items[1]?.html).toBe("done");
  });

  it("matches duplicate lines in their existing order", () => {
    const previous = createVirtualLineItemsState(["same", "same", "tail"]);
    const next = reconcileVirtualLineItems(previous, ["same", "tail", "new"]);

    expect(ids(next).slice(0, 2)).toEqual([ids(previous)[0], ids(previous)[2]]);
  });

  it("keeps positional ids for a full same-size redraw", () => {
    const previous = createVirtualLineItemsState(["a", "b", "c"]);
    const next = reconcileVirtualLineItems(previous, ["x", "y", "z"]);

    expect(ids(next)).toEqual(ids(previous));
  });

  it("keeps positional ids when linkification changes several html lines", () => {
    const previous = createVirtualLineItemsState(["head", "", "src/file.ts:10", "tail"]);
    const next = reconcileVirtualLineItems(previous, [
      "head",
      "",
      '<a href="/src/file.ts#L10">src/file.ts:10</a>',
      "<span>tail</span>",
    ]);

    expect(ids(next)).toEqual(ids(previous));
  });
});
