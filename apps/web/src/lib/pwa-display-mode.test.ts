import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PWA_DISPLAY_MODE_QUERIES, isPwaDisplayMode, usePwaDisplayMode } from "./pwa-display-mode";

const originalMatchMedia = window.matchMedia;
const originalStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;

const mockMatchMedia = (matchedQueries: string[]) => {
  let currentMatches = new Set(matchedQueries);
  const listeners = new Set<EventListener>();
  const mock = vi.fn((query: string) => ({
    get matches() {
      return currentMatches.has(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: mock,
  });
  return {
    setMatchedQueries(nextMatchedQueries: string[]) {
      currentMatches = new Set(nextMatchedQueries);
      listeners.forEach((listener) => listener(new Event("change")));
    },
  };
};

describe("pwa-display-mode", () => {
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      writable: true,
      value: originalStandalone,
    });
  });

  it("returns true when standalone display mode is matched", () => {
    mockMatchMedia([PWA_DISPLAY_MODE_QUERIES[0]]);
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      writable: true,
      value: false,
    });

    expect(isPwaDisplayMode()).toBe(true);
  });

  it("returns true when iOS navigator.standalone is true", () => {
    mockMatchMedia([]);
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      writable: true,
      value: true,
    });

    expect(isPwaDisplayMode()).toBe(true);
  });

  it("returns false when both display mode and standalone are unavailable", () => {
    mockMatchMedia([]);
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      writable: true,
      value: false,
    });

    expect(isPwaDisplayMode()).toBe(false);
  });

  it("updates subscribers when the display mode changes", () => {
    const media = mockMatchMedia([]);
    const { result } = renderHook(() => usePwaDisplayMode());

    expect(result.current).toBe(false);

    act(() => {
      media.setMatchedQueries([PWA_DISPLAY_MODE_QUERIES[0]]);
    });

    expect(result.current).toBe(true);
  });
});
