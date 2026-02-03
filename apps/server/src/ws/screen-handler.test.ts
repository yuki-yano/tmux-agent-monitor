import { type AgentMonitorConfig, defaultConfig, type SessionDetail } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { createSessionMonitor } from "../monitor.js";
import { createScreenCache } from "./screen-cache.js";
import { handleScreenRequest } from "./screen-handler.js";

type Monitor = ReturnType<typeof createSessionMonitor>;

const baseConfig: AgentMonitorConfig = { ...defaultConfig, token: "test-token" };

const buildMessage = (overrides?: Partial<{ mode: "text" | "image"; lines: number }>) => ({
  type: "screen.request" as const,
  ts: "2025-01-01T00:00:00.000Z",
  data: {
    paneId: "%1",
    ...overrides,
  },
});

describe("handleScreenRequest", () => {
  it("returns rate limit error when limiter blocks", async () => {
    const send = vi.fn();
    const monitor = { getScreenCapture: () => ({ captureText: vi.fn() }) } as unknown as Monitor;
    const target = { paneId: "%1", paneTty: "tty1", alternateOn: false } as SessionDetail;

    await handleScreenRequest({
      config: baseConfig,
      monitor,
      message: buildMessage(),
      reqId: "req-1",
      target,
      screenLimiter: () => false,
      buildTextResponse: vi.fn(),
      send,
    });

    const payload = send.mock.calls[0]?.[0];
    expect(payload.type).toBe("screen.response");
    expect(payload.data.ok).toBe(false);
    expect(payload.data.error?.code).toBe("RATE_LIMIT");
  });

  it("falls back to text when image mode is disabled", async () => {
    const send = vi.fn();
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

    await handleScreenRequest({
      config: {
        ...baseConfig,
        screen: {
          ...baseConfig.screen,
          image: { ...baseConfig.screen.image, enabled: false },
        },
      },
      monitor,
      message: buildMessage({ mode: "image", lines: 5 }),
      reqId: "req-2",
      target,
      screenLimiter: () => true,
      buildTextResponse: screenCache.buildTextResponse,
      send,
    });

    expect(captureText).toHaveBeenCalled();
    const payload = send.mock.calls[0]?.[0];
    expect(payload.type).toBe("screen.response");
    expect(payload.data.ok).toBe(true);
    expect(payload.data.fallbackReason).toBe("image_disabled");
  });
});
