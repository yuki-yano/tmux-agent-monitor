import type { ApiEnvelope } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "./api-messages";
import {
  expectField,
  extractErrorMessage,
  isAbortError,
  requestJson,
  resolveUnknownErrorMessage,
  toErrorWithFallback,
} from "./api-utils";

describe("api-utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unauthorized message for 401", () => {
    const res = { status: 401, ok: false } as Response;
    const message = extractErrorMessage(res, null, "fallback");
    expect(message).toBe(API_ERROR_MESSAGES.unauthorized);
  });

  it("returns file navigator messages for known API error codes", () => {
    const forbiddenRes = { status: 403, ok: false } as Response;
    const forbidden = extractErrorMessage(
      forbiddenRes,
      { error: { code: "FORBIDDEN_PATH", message: "path is forbidden" } },
      "fallback",
    );
    expect(forbidden).toBe(API_ERROR_MESSAGES.forbiddenPath);

    const permission = extractErrorMessage(
      forbiddenRes,
      { error: { code: "PERMISSION_DENIED", message: "permission denied" } },
      "fallback",
    );
    expect(permission).toBe(API_ERROR_MESSAGES.permissionDenied);
  });

  it("prefers API error message when present", () => {
    const res = { status: 500, ok: false } as Response;
    const data: ApiEnvelope<unknown> = {
      error: { code: "INTERNAL", message: "boom" },
    };
    const message = extractErrorMessage(res, data, "fallback");
    expect(message).toBe("boom");
  });

  it("includes status when requested", () => {
    const res = { status: 500, ok: false } as Response;
    const message = extractErrorMessage(res, null, API_ERROR_MESSAGES.requestFailed, {
      includeStatus: true,
    });
    expect(message).toBe(`${API_ERROR_MESSAGES.requestFailed} (500)`);
  });

  it("returns expected field or throws", () => {
    const res = { status: 200, ok: true } as Response;
    const data = { value: 42 } as ApiEnvelope<{ value: number }>;
    expect(expectField(res, data, "value", "fallback")).toBe(42);
    const missing = { value: null } as ApiEnvelope<{ value: number | null }>;
    expect(() => expectField(res, missing, "value", "fallback")).toThrow("fallback");
  });

  it("converts unknown object errors to Error with fallback message", () => {
    const err = toErrorWithFallback({ reason: "not-an-error" }, "fallback message");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("fallback message");
  });

  it("returns Error input as-is", () => {
    const original = new Error("boom");
    expect(toErrorWithFallback(original, "fallback message")).toBe(original);
  });

  it("prefers string and message-like unknown errors", () => {
    expect(resolveUnknownErrorMessage("boom", "fallback")).toBe("boom");
    expect(resolveUnknownErrorMessage({ message: "oops" }, "fallback")).toBe("oops");
    expect(resolveUnknownErrorMessage("", "fallback")).toBe("fallback");
  });

  it("recognizes browser and error-like abort errors", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("Aborted"))).toBe(false);
  });

  it("propagates aborts raised while parsing a response body", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    const response = new Response();
    vi.spyOn(response, "json").mockRejectedValue(abortError);

    await expect(requestJson(Promise.resolve(response))).rejects.toBe(abortError);
  });

  it("supports timeout with AbortController and returns timeout message", async () => {
    vi.useFakeTimers();
    const request = vi.fn((signal?: AbortSignal) => {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });

    const promise = requestJson(request, {
      timeoutMs: 1000,
      timeoutMessage: "custom timeout",
    });
    const assertion = expect(promise).rejects.toThrow("custom timeout");
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("times out even when request does not observe signal", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Promise<Response>(() => {}));

    const promise = requestJson(request, { timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toThrow(API_ERROR_MESSAGES.requestTimeout);
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  });
});
