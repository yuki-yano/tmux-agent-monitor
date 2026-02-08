import { type AgentMonitorConfig, defaultConfig, type SessionDetail } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { createSessionMonitor } from "../monitor";
import { captureTerminalScreen } from "../screen-service";
import { createScreenCache } from "./screen-cache";
import { createScreenResponse } from "./screen-response";

type Monitor = ReturnType<typeof createSessionMonitor>;

const baseConfig: AgentMonitorConfig = { ...defaultConfig, token: "test-token" };

vi.mock("../screen-service", () => ({
  captureTerminalScreen: vi.fn(),
}));

describe("createScreenResponse", () => {
  it("enables joinLines for claude sessions even when config is disabled", async () => {
    const captureText = vi.fn(async () => ({
      screen: "hello",
      alternateOn: false,
      truncated: null,
    }));
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = {
      paneId: "%1",
      paneTty: "tty1",
      alternateOn: false,
      agent: "claude",
    } as SessionDetail;
    const screenCache = createScreenCache();

    const response = await createScreenResponse({
      config: {
        ...baseConfig,
        screen: {
          ...baseConfig.screen,
          joinLines: false,
        },
      },
      monitor,
      target,
      mode: "text",
      lines: 5,
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: screenCache.buildTextResponse,
    });

    expect(response.ok).toBe(true);
    expect(captureText).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: "%1",
        lines: 5,
        joinLines: true,
      }),
    );
  });

  it("forces altScreen on for editor sessions", async () => {
    const captureText = vi.fn(async () => ({
      screen: "hello",
      alternateOn: false,
      truncated: null,
    }));
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = {
      paneId: "%1",
      paneTty: "tty1",
      alternateOn: false,
      agent: "unknown",
      currentCommand: "nvim",
      startCommand: "zsh",
    } as SessionDetail;
    const screenCache = createScreenCache();

    const response = await createScreenResponse({
      config: {
        ...baseConfig,
        screen: {
          ...baseConfig.screen,
          altScreen: "off",
        },
      },
      monitor,
      target,
      mode: "text",
      lines: 5,
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: screenCache.buildTextResponse,
    });

    expect(response.ok).toBe(true);
    expect(captureText).toHaveBeenCalledWith(
      expect.objectContaining({
        altScreen: "on",
        currentCommand: "nvim",
      }),
    );
  });

  it("keeps altScreen auto for non-editor sessions", async () => {
    const captureText = vi.fn(async () => ({
      screen: "hello",
      alternateOn: false,
      truncated: null,
    }));
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = {
      paneId: "%1",
      paneTty: "tty1",
      alternateOn: false,
      agent: "unknown",
      currentCommand: "zsh",
      startCommand: "zsh",
    } as SessionDetail;
    const screenCache = createScreenCache();

    const response = await createScreenResponse({
      config: {
        ...baseConfig,
        screen: {
          ...baseConfig.screen,
          altScreen: "auto",
        },
      },
      monitor,
      target,
      mode: "text",
      lines: 5,
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: screenCache.buildTextResponse,
    });

    expect(response.ok).toBe(true);
    expect(captureText).toHaveBeenCalledWith(
      expect.objectContaining({
        altScreen: "auto",
        currentCommand: "zsh",
      }),
    );
  });

  it("returns rate limit error when limiter blocks", async () => {
    const monitor = { getScreenCapture: () => ({ captureText: vi.fn() }) } as unknown as Monitor;
    const target = { paneId: "%1", paneTty: "tty1", alternateOn: false } as SessionDetail;

    const response = await createScreenResponse({
      config: baseConfig,
      monitor,
      target,
      mode: "text",
      screenLimiter: () => false,
      limiterKey: "rest",
      buildTextResponse: vi.fn(),
    });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("RATE_LIMIT");
  });

  it("falls back to text when image mode is disabled", async () => {
    const captureText = vi.fn(async () => ({
      screen: "hello",
      alternateOn: false,
      truncated: null,
    }));
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = { paneId: "%1", paneTty: "tty1", alternateOn: false } as SessionDetail;
    const screenCache = createScreenCache();

    const response = await createScreenResponse({
      config: {
        ...baseConfig,
        screen: {
          ...baseConfig.screen,
          image: { ...baseConfig.screen.image, enabled: false },
        },
      },
      monitor,
      target,
      mode: "image",
      lines: 5,
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: screenCache.buildTextResponse,
    });

    expect(captureText).toHaveBeenCalled();
    expect(response.ok).toBe(true);
    expect(response.fallbackReason).toBe("image_disabled");
  });

  it("captures image when multiplexer backend is wezterm", async () => {
    vi.mocked(captureTerminalScreen).mockClear();
    vi.mocked(captureTerminalScreen).mockResolvedValueOnce({
      imageBase64: "wezterm-image",
      cropped: true,
    });
    const captureText = vi.fn(async () => ({
      screen: "hello",
      alternateOn: false,
      truncated: null,
    }));
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = { paneId: "%1", paneTty: "tty1", alternateOn: false } as SessionDetail;
    const screenCache = createScreenCache();

    const response = await createScreenResponse({
      config: {
        ...baseConfig,
        multiplexer: {
          ...baseConfig.multiplexer,
          backend: "wezterm",
        },
      },
      monitor,
      target,
      mode: "image",
      lines: 5,
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: screenCache.buildTextResponse,
    });

    expect(captureTerminalScreen).toHaveBeenCalledWith("tty1", {
      paneId: "%1",
      multiplexerBackend: "wezterm",
      tmux: baseConfig.tmux,
      wezterm: baseConfig.multiplexer.wezterm,
      cropPane: baseConfig.screen.image.cropPane,
      backend: baseConfig.screen.image.backend,
    });
    expect(captureText).not.toHaveBeenCalled();
    expect(response.ok).toBe(true);
    expect(response.mode).toBe("image");
  });

  it("falls back to text when image capture fails", async () => {
    const captureText = vi.fn(async () => ({
      screen: "hello",
      alternateOn: false,
      truncated: null,
    }));
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = { paneId: "%1", paneTty: "tty1", alternateOn: false } as SessionDetail;
    const screenCache = createScreenCache();
    vi.mocked(captureTerminalScreen).mockResolvedValueOnce(null);

    const response = await createScreenResponse({
      config: {
        ...baseConfig,
        screen: { ...baseConfig.screen, image: { ...baseConfig.screen.image, enabled: true } },
      },
      monitor,
      target,
      mode: "image",
      lines: 5,
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: screenCache.buildTextResponse,
    });

    expect(response.ok).toBe(true);
    expect(response.fallbackReason).toBe("image_failed");
    expect(response.mode).toBe("text");
  });

  it("returns internal error when captureText throws", async () => {
    const captureText = vi.fn(async () => {
      throw new Error("fail");
    });
    const monitor = {
      getScreenCapture: () => ({ captureText }),
    } as unknown as Monitor;
    const target = { paneId: "%1", paneTty: "tty1", alternateOn: false } as SessionDetail;

    const response = await createScreenResponse({
      config: baseConfig,
      monitor,
      target,
      mode: "text",
      screenLimiter: () => true,
      limiterKey: "rest",
      buildTextResponse: vi.fn(),
    });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("INTERNAL");
  });
});
