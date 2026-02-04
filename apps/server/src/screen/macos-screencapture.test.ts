import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = vi.fn(async () => Buffer.from("image"));
  const unlink = vi.fn(async () => {});
  return {
    ...actual,
    readFile,
    unlink,
    default: {
      ...actual,
      readFile,
      unlink,
    },
  };
});

import { captureRegion } from "./macos-screencapture.js";

describe("macos-screencapture", () => {
  it("captures region and returns base64", async () => {
    const result = await captureRegion({ x: 0, y: 0, width: 1, height: 1 });
    expect(result).toBe(Buffer.from("image").toString("base64"));
  });
});
