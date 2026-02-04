import { describe, expect, it } from "vitest";

import { isValidTty, normalizeTty } from "./tty.js";

describe("tty utils", () => {
  it("normalizes tty paths", () => {
    expect(normalizeTty("ttys001")).toBe("/dev/ttys001");
    expect(normalizeTty("/dev/ttys002")).toBe("/dev/ttys002");
  });

  it("validates tty paths", () => {
    expect(isValidTty("/dev/ttys001")).toBe(true);
    expect(isValidTty("ttys001")).toBe(true);
    expect(isValidTty("/dev/pts/1")).toBe(true);
    expect(isValidTty("invalid")).toBe(false);
  });
});
