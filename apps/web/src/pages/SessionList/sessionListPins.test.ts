// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { SessionListPins } from "./sessionListPins";
import {
  createRepoPinKey,
  createSessionWindowPinKey,
  createSessionWindowSessionPinKey,
  readStoredSessionListPins,
  storeSessionListPins,
  toggleSessionListPin,
} from "./sessionListPins";

const STORAGE_KEY = "vde-monitor-session-list-pins";

describe("sessionListPins", () => {
  it("returns defaults when storage is empty or invalid", () => {
    window.localStorage.removeItem(STORAGE_KEY);
    expect(readStoredSessionListPins()).toEqual({
      repos: [],
      sessions: [],
      windows: [],
      panes: [],
    } satisfies SessionListPins);

    window.localStorage.setItem(STORAGE_KEY, "invalid-json");
    expect(readStoredSessionListPins()).toEqual({
      repos: [],
      sessions: [],
      windows: [],
      panes: [],
    } satisfies SessionListPins);
  });

  it("stores and restores pin values", () => {
    const pins: SessionListPins = {
      repos: ["repo:/Users/test/repo"],
      sessions: ["session:alpha"],
      windows: ["window:alpha:1"],
      panes: ["%1"],
    };
    storeSessionListPins(pins);

    expect(readStoredSessionListPins()).toEqual(pins);
  });

  it("toggles pin values idempotently", () => {
    const next = toggleSessionListPin(
      {
        repos: [],
        sessions: [],
        windows: [],
        panes: [],
      },
      "sessions",
      "session:alpha",
    );
    expect(next.sessions).toEqual(["session:alpha"]);

    const reverted = toggleSessionListPin(next, "sessions", "session:alpha");
    expect(reverted.sessions).toEqual([]);
  });

  it("creates stable keys for session and window units", () => {
    expect(createRepoPinKey("/Users/test/repo")).toBe("repo:/Users/test/repo");
    expect(createRepoPinKey(null)).toBe("repo:__NO_REPO__");
    expect(createSessionWindowSessionPinKey("alpha")).toBe("session:alpha");
    expect(createSessionWindowPinKey("alpha", 1)).toBe("window:alpha:1");
  });
});
