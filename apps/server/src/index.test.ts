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

import { buildAccessUrl, ensureBackendAvailable } from "./index";

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

describe("buildAccessUrl", () => {
  it("omits api hash param when ui/api host:port are the same", () => {
    const url = buildAccessUrl({
      displayHost: "localhost",
      displayPort: 11080,
      token: "abc123",
    });
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hash);

    expect(parsed.origin).toBe("http://localhost:11080");
    expect(hashParams.get("token")).toBe("abc123");
    expect(hashParams.has("api")).toBe(false);
  });

  it("embeds token and api endpoint in hash params when api is different origin", () => {
    const url = buildAccessUrl({
      displayHost: "100.102.60.85",
      displayPort: 24181,
      token: "abc123",
      apiBaseUrl: "http://100.102.60.85:11081/api",
    });
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hash);

    expect(parsed.origin).toBe("http://100.102.60.85:24181");
    expect(hashParams.get("token")).toBe("abc123");
    expect(hashParams.get("api")).toBe("http://100.102.60.85:11081/api");
  });
});
