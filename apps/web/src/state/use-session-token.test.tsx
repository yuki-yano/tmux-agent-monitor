// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSessionToken } from "./use-session-token";

const resetLocation = (path = "/") => {
  window.history.replaceState({}, "", path);
};

afterEach(() => {
  localStorage.clear();
  resetLocation();
});

describe("useSessionToken", () => {
  it("reads token and api base url from URL hash and stores them", async () => {
    resetLocation(
      "/sessions?foo=bar#token=abc123&api=http%3A%2F%2Flocalhost%3A11081%2Fapi&tab=timeline",
    );

    const { result } = renderHook(() => useSessionToken());

    await waitFor(() => {
      expect(result.current.token).toBe("abc123");
      expect(result.current.apiBaseUrl).toBe("http://localhost:11081/api");
    });

    expect(localStorage.getItem("vde-monitor-token")).toBe("abc123");
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBe("http://localhost:11081/api");
    expect(window.location.search).toBe("?foo=bar");
    expect(window.location.hash).toBe("#tab=timeline");
  });

  it("uses stored values when URL hash has no token/api", () => {
    localStorage.setItem("vde-monitor-token", "stored-token");
    localStorage.setItem("vde-monitor-api-base-url", "http://localhost:11080/api");
    resetLocation("/sessions?foo=bar#tab=timeline");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.token).toBe("stored-token");
    expect(result.current.apiBaseUrl).toBe("http://localhost:11080/api");
    expect(window.location.search).toBe("?foo=bar");
    expect(window.location.hash).toBe("#tab=timeline");
  });

  it("ignores token passed in query parameters", () => {
    resetLocation("/sessions?token=abc123&foo=bar");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.token).toBeNull();
    expect(result.current.apiBaseUrl).toBeNull();
    expect(localStorage.getItem("vde-monitor-token")).toBeNull();
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBeNull();
    expect(window.location.search).toBe("?token=abc123&foo=bar");
    expect(window.location.hash).toBe("");
  });

  it("drops invalid api parameter from URL hash", async () => {
    resetLocation("/sessions#token=abc123&api=javascript:alert(1)&tab=timeline");

    const { result } = renderHook(() => useSessionToken());

    await waitFor(() => {
      expect(result.current.token).toBe("abc123");
    });

    expect(result.current.apiBaseUrl).toBeNull();
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBeNull();
    expect(window.location.hash).toBe("#tab=timeline");
  });

  it("drops cross-host api parameter from URL hash", async () => {
    resetLocation("/sessions#token=abc123&api=http%3A%2F%2Fevil.example%2Fapi&tab=timeline");

    const { result } = renderHook(() => useSessionToken());

    await waitFor(() => {
      expect(result.current.token).toBe("abc123");
    });

    expect(result.current.apiBaseUrl).toBeNull();
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBeNull();
    expect(window.location.hash).toBe("#tab=timeline");
  });

  it("clears stored api base url when token URL has no api parameter", async () => {
    localStorage.setItem("vde-monitor-api-base-url", "http://localhost:11081/api");
    resetLocation("/sessions#token=abc123");

    const { result } = renderHook(() => useSessionToken());

    await waitFor(() => {
      expect(result.current.token).toBe("abc123");
    });

    expect(result.current.apiBaseUrl).toBeNull();
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBeNull();
  });

  it("drops cross-host stored api base url", () => {
    localStorage.setItem("vde-monitor-token", "stored-token");
    localStorage.setItem("vde-monitor-api-base-url", "http://evil.example/api");
    resetLocation("/sessions");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.token).toBe("stored-token");
    expect(result.current.apiBaseUrl).toBeNull();
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBeNull();
  });
});
