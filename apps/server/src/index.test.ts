import { configDefaults } from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { tmuxRun, weztermRun, herdrRequest, herdrClose } = vi.hoisted(() => ({
  tmuxRun: vi.fn(),
  weztermRun: vi.fn(),
  herdrRequest: vi.fn(),
  herdrClose: vi.fn(),
}));

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

vi.mock("@vde-monitor/herdr", () => ({
  HerdrClient: vi.fn(
    class HerdrClient {
      request = herdrRequest;
      close = herdrClose;
    },
  ),
  resolveSocketPath: vi.fn(() => "/tmp/herdr.sock"),
}));

import {
  buildAccessUrl,
  buildTailscaleHttpsAccessUrl,
  ensureBackendAvailable,
} from "./app/serve/serve-command";

describe("ensureBackendAvailable", () => {
  beforeEach(() => {
    tmuxRun.mockReset();
    weztermRun.mockReset();
    herdrRequest.mockReset();
    herdrClose.mockReset();
    herdrClose.mockResolvedValue(undefined);
  });

  it("checks tmux availability when backend is tmux", async () => {
    tmuxRun
      .mockResolvedValueOnce({ stdout: "tmux 3.5", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "main: 1 windows", stderr: "", exitCode: 0 });

    await ensureBackendAvailable({
      ...configDefaults,
      token: "token",
      multiplexer: {
        ...configDefaults.multiplexer,
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
      ...configDefaults,
      token: "token",
      multiplexer: {
        ...configDefaults.multiplexer,
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
        ...configDefaults,
        token: "token",
        multiplexer: {
          ...configDefaults.multiplexer,
          backend: "wezterm",
        },
      }),
    ).rejects.toThrow("no running wezterm instance");
  });

  it("checks herdr availability when backend is herdr", async () => {
    herdrRequest.mockResolvedValueOnce({ type: "pong" });

    await ensureBackendAvailable({
      ...configDefaults,
      token: "token",
      multiplexer: {
        ...configDefaults.multiplexer,
        backend: "herdr",
      },
    });

    expect(herdrRequest).toHaveBeenCalledWith("ping", {});
    expect(herdrClose).toHaveBeenCalled();
    expect(tmuxRun).not.toHaveBeenCalled();
    expect(weztermRun).not.toHaveBeenCalled();
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

describe("buildTailscaleHttpsAccessUrl", () => {
  it("builds a ts.net HTTPS URL with token hash", () => {
    const url = buildTailscaleHttpsAccessUrl({
      dnsName: "macbook.example.ts.net",
      token: "abc123",
    });
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hash);

    expect(parsed.origin).toBe("https://macbook.example.ts.net");
    expect(hashParams.get("token")).toBe("abc123");
    expect(hashParams.has("api")).toBe(false);
  });
});
