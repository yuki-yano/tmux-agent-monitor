import { type AgentMonitorConfig, defaultConfig, type SessionDetail } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { createSessionMonitor } from "../monitor.js";
import { captureTerminalScreen } from "../screen-service.js";
import { createScreenCache } from "./screen-cache.js";
import { createScreenResponse } from "./screen-response.js";

type Monitor = ReturnType<typeof createSessionMonitor>;

const baseConfig: AgentMonitorConfig = { ...defaultConfig, token: "test-token" };

vi.mock("../screen-service.js", () => ({
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

  it("falls back to text when multiplexer backend is wezterm", async () => {
    vi.mocked(captureTerminalScreen).mockClear();
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

    expect(captureTerminalScreen).not.toHaveBeenCalled();
    expect(captureText).toHaveBeenCalled();
    expect(response.ok).toBe(true);
    expect(response.mode).toBe("text");
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
