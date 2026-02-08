import { defaultConfig } from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  focusPaneMock,
  markPaneFocusMock,
  resolveBackendAppMock,
  isAppRunningMock,
  focusTerminalAppMock,
} = vi.hoisted(() => ({
  focusPaneMock: vi.fn(),
  markPaneFocusMock: vi.fn(),
  resolveBackendAppMock: vi.fn(() => ({ key: "wezterm", appName: "WezTerm" })),
  isAppRunningMock: vi.fn(async () => true),
  focusTerminalAppMock: vi.fn(async () => undefined),
}));

vi.mock("@vde-monitor/wezterm", () => ({
  createInspector: vi.fn(() => ({
    list: vi.fn(async () => []),
  })),
  createScreenCapture: vi.fn(() => ({
    captureText: vi.fn(async () => ({
      screen: "",
      truncated: null,
      alternateOn: false,
    })),
  })),
  createWeztermActions: vi.fn(() => ({
    sendText: vi.fn(async () => ({ ok: true })),
    sendKeys: vi.fn(async () => ({ ok: true })),
    sendRaw: vi.fn(async () => ({ ok: true })),
    focusPane: focusPaneMock,
  })),
  createWeztermAdapter: vi.fn(() => ({
    run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  })),
  normalizeWeztermTarget: vi.fn((value: string | null | undefined) => {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : "auto";
  }),
}));

vi.mock("../activity-suppressor", () => ({
  markPaneFocus: markPaneFocusMock,
}));

vi.mock("../screen/macos-app", () => ({
  resolveBackendApp: resolveBackendAppMock,
}));

vi.mock("../screen/macos-applescript", () => ({
  isAppRunning: isAppRunningMock,
  focusTerminalApp: focusTerminalAppMock,
}));

import { createWeztermRuntime } from "./runtime-wezterm";

describe("createWeztermRuntime focusPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks focus after successful pane activation", async () => {
    focusPaneMock.mockResolvedValue({ ok: true });

    const runtime = createWeztermRuntime({
      ...defaultConfig,
      token: "test-token",
    });
    const result = await runtime.actions.focusPane("6");

    expect(result).toEqual({ ok: true });
    expect(focusPaneMock).toHaveBeenCalledWith("6");
    expect(markPaneFocusMock).toHaveBeenCalledWith("6");
    if (process.platform === "darwin") {
      expect(resolveBackendAppMock).toHaveBeenCalledWith("wezterm");
      expect(isAppRunningMock).toHaveBeenCalledWith("WezTerm");
      expect(focusTerminalAppMock).toHaveBeenCalledWith("WezTerm");
    }
  });

  it("does not mark focus when pane activation fails", async () => {
    focusPaneMock.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_PANE", message: "missing pane" },
    });

    const runtime = createWeztermRuntime({
      ...defaultConfig,
      token: "test-token",
    });
    const result = await runtime.actions.focusPane("404");

    expect(result.ok).toBe(false);
    expect(focusPaneMock).toHaveBeenCalledWith("404");
    expect(markPaneFocusMock).not.toHaveBeenCalled();
    expect(resolveBackendAppMock).not.toHaveBeenCalled();
  });
});
