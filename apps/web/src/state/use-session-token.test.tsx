import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionToken } from "./use-session-token";

const resetLocation = (path = "/") => {
  window.history.replaceState({}, "", path);
};

afterEach(() => {
  localStorage.clear();
  resetLocation();
  vi.unstubAllGlobals();
});

describe("useSessionToken", () => {
  it("reads, stores, and strips a trusted api directive without persisting a token", async () => {
    resetLocation("/sessions?foo=bar&api=http%3A%2F%2Flocalhost%3A11081%2Fapi#tab=timeline");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.token).toBe("cookie-session");
    expect(result.current.apiBaseUrl).toBe("http://localhost:11081/api");
    await waitFor(() => {
      expect(window.location.search).toBe("?foo=bar");
    });
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBe("http://localhost:11081/api");
    expect(window.location.hash).toBe("#tab=timeline");
  });

  it("uses a trusted stored api base url", () => {
    localStorage.setItem("vde-monitor-api-base-url", "http://localhost:11080/api");
    resetLocation("/sessions?foo=bar#tab=timeline");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.token).toBe("cookie-session");
    expect(result.current.apiBaseUrl).toBe("http://localhost:11080/api");
  });

  it("drops an invalid api directive", async () => {
    localStorage.setItem("vde-monitor-api-base-url", "http://localhost:11080/api");
    resetLocation("/sessions?api=javascript%3Aalert%281%29&foo=bar");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.apiBaseUrl).toBeNull();
    await waitFor(() => {
      expect(window.location.search).toBe("?foo=bar");
    });
    expect(localStorage.getItem("vde-monitor-api-base-url")).toBeNull();
  });

  it("drops a cross-host api directive", async () => {
    resetLocation("/sessions?api=http%3A%2F%2Fevil.example%2Fapi");

    const { result } = renderHook(() => useSessionToken());

    expect(result.current.apiBaseUrl).toBeNull();
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });

  it("exchanges a manually entered token for the HttpOnly session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    resetLocation("/sessions?api=http%3A%2F%2Flocalhost%3A11081%2Fapi");
    const { result } = renderHook(() => useSessionToken());

    let authenticated = false;
    await act(async () => {
      authenticated = await result.current.setToken("  abc123  ");
    });

    expect(authenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11081/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    });
    expect(result.current.token).toBe("cookie-session");
  });

  it("clears the server session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSessionToken());

    let cleared = false;
    await act(async () => {
      cleared = await result.current.setToken(null);
    });

    expect(cleared).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
      method: "DELETE",
      credentials: "include",
      headers: undefined,
      body: undefined,
    });
    expect(result.current.token).toBeNull();
  });

  it("keeps the current session state when the exchange request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
    const { result } = renderHook(() => useSessionToken());

    let authenticated = true;
    await act(async () => {
      authenticated = await result.current.setToken("abc123");
    });

    expect(authenticated).toBe(false);
    expect(result.current.token).toBe("cookie-session");
  });
});
