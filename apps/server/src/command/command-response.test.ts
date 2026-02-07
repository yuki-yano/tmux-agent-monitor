import type { RawItem } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { createSessionMonitor } from "../monitor.js";
import type { MultiplexerInputActions } from "../multiplexer/types.js";
import { createCommandResponse } from "./command-response.js";

type Monitor = ReturnType<typeof createSessionMonitor>;

describe("createCommandResponse", () => {
  it("records input on successful send", async () => {
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const actions = {
      sendText: vi.fn(async () => ({ ok: true })),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(),
      focusPane: vi.fn(),
    } as unknown as MultiplexerInputActions;

    const response = await createCommandResponse({
      monitor,
      actions,
      payload: { type: "send.text", paneId: "%1", text: "echo ok", enter: true },
      limiterKey: "rest",
      sendLimiter: vi.fn(() => true),
      rawLimiter: vi.fn(() => true),
    });

    expect(actions.sendText).toHaveBeenCalledWith("%1", "echo ok", true);
    expect(monitor.recordInput).toHaveBeenCalledWith("%1");
    expect(response.ok).toBe(true);
  });

  it("uses raw limiter for send.raw payloads", async () => {
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const actions = {
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(async () => ({ ok: true })),
      focusPane: vi.fn(),
    } as unknown as MultiplexerInputActions;

    const response = await createCommandResponse({
      monitor,
      actions,
      payload: {
        type: "send.raw",
        paneId: "%1",
        items: [{ kind: "key", value: "Enter" }] as RawItem[],
      },
      limiterKey: "rest",
      sendLimiter: vi.fn(() => true),
      rawLimiter: vi.fn(() => false),
    });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("RATE_LIMIT");
  });
});
