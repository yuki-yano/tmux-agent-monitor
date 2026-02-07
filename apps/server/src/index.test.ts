import { defaultConfig } from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tmuxRun = vi.fn();
const weztermRun = vi.fn();

vi.mock("@vde-monitor/tmux", () => ({
  createTmuxAdapter: vi.fn(() => ({
    run: tmuxRun,
  })),
}));

vi.mock("@vde-monitor/wezterm", () => ({
  createWeztermAdapter: vi.fn(() => ({
    run: weztermRun,
  })),
  normalizeWeztermTarget: vi.fn((value: string | null | undefined) => {
    if (value == null) {
      return "auto";
    }
    const trimmed = value.trim();
    return trimmed.length === 0 || trimmed === "auto" ? "auto" : trimmed;
  }),
}));

import { ensureBackendAvailable } from "./index.js";

describe("ensureBackendAvailable", () => {
  beforeEach(() => {
    tmuxRun.mockReset();
    weztermRun.mockReset();
  });

  it("checks tmux availability when backend is tmux", async () => {
    tmuxRun
      .mockResolvedValueOnce({ stdout: "tmux 3.5", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "main: 1 windows", stderr: "", exitCode: 0 });

    await ensureBackendAvailable({
      ...defaultConfig,
      token: "token",
      multiplexer: {
        ...defaultConfig.multiplexer,
        backend: "tmux",
      },
    });

    expect(tmuxRun).toHaveBeenNthCalledWith(1, ["-V"]);
    expect(tmuxRun).toHaveBeenNthCalledWith(2, ["list-sessions"]);
    expect(weztermRun).not.toHaveBeenCalled();
  });

  it("checks wezterm availability when backend is wezterm", async () => {
    weztermRun.mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 });

    await ensureBackendAvailable({
      ...defaultConfig,
      token: "token",
      multiplexer: {
        ...defaultConfig.multiplexer,
        backend: "wezterm",
      },
    });

    expect(weztermRun).toHaveBeenCalledWith(["list", "--format", "json"]);
    expect(tmuxRun).not.toHaveBeenCalled();
  });

  it("throws when wezterm availability check fails", async () => {
    weztermRun.mockResolvedValueOnce({
      stdout: "",
      stderr: "no running wezterm instance",
      exitCode: 1,
    });

    await expect(
      ensureBackendAvailable({
        ...defaultConfig,
        token: "token",
        multiplexer: {
          ...defaultConfig.multiplexer,
          backend: "wezterm",
        },
      }),
    ).rejects.toThrow("no running wezterm instance");
  });
});
