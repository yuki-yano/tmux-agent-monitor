import { describe, expect, it } from "vitest";

import { buildEnvelope } from "./envelope.js";

describe("buildEnvelope", () => {
  it("builds envelope with timestamp and payload", () => {
    const result = buildEnvelope("demo.event", { ok: true }, "req-1");

    expect(result).toEqual({
      type: "demo.event",
      ts: expect.any(String),
      reqId: "req-1",
      data: { ok: true },
    });
  });
});
