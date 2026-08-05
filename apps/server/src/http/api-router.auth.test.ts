import { beforeEach, describe, expect, it, vi } from "vitest";

import { authHeaders, createTestContext } from "./api-router.test-helpers";

describe("createApiRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without auth", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token with the same length as the real one", async () => {
    const { api } = createTestContext();
    const wrongToken = authHeaders.Authorization.replace("Bearer ", "")
      .split("")
      .reverse()
      .join("");
    const res = await api.request("/sessions", {
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("throttles repeated auth failures with 429", async () => {
    const { api } = createTestContext();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await api.request("/sessions", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    }

    const throttled = await api.request("/sessions", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(throttled.status).toBe(429);
    const data = await throttled.json();
    expect(data.error.code).toBe("RATE_LIMIT");

    // A valid token is never locked out by failed attempts from others.
    const valid = await api.request("/sessions", { headers: authHeaders });
    expect(valid.status).toBe(200);
  });

  it("rejects requests with disallowed origin", async () => {
    const { api } = createTestContext({ allowedOrigins: ["https://allowed.example"] });
    const req = new Request("http://localhost/sessions", {
      headers: { ...authHeaders, Origin: "https://bad.example" },
    });
    const res = await api.fetch(req);
    expect(res.status).toBe(403);
  });

  it("allows unauthenticated preflight requests", async () => {
    const { api } = createTestContext();
    const res = await api.request("/sessions", { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  it("returns config validation cause when request handler throws invalid config error", async () => {
    const { api } = createTestContext();
    const cause =
      "invalid config: /tmp/.config/vde/monitor/config.yml activity.pollIntervalMs Invalid input: expected number, received string";
    api.get("/__test/config-validation-error", () => {
      throw new Error(cause);
    });

    const res = await api.request("/__test/config-validation-error", {
      headers: authHeaders,
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error.code).toBe("INTERNAL");
    expect(data.error.message).toBe("configuration validation failed");
    expect(data.errorCause).toBe(cause);
  });

  it("returns plain 500 response when request handler throws non-config error", async () => {
    const { api } = createTestContext();
    api.get("/__test/unhandled-error", () => {
      throw new Error("boom");
    });

    const res = await api.request("/__test/unhandled-error", {
      headers: authHeaders,
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");
  });
});
