import type { RawItem } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { createSessionMonitor } from "../monitor.js";
import type { createTmuxActions } from "../tmux-actions.js";
import { createCommandResponse } from "./command-response.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type TmuxActions = ReturnType<typeof createTmuxActions>;

describe("createCommandResponse", () => {
  it("records input on successful send", async () => {
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = {
      sendText: vi.fn(async () => ({ ok: true })),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(),
    } as unknown as TmuxActions;

    const response = await createCommandResponse({
      monitor,
      tmuxActions,
      payload: { type: "send.text", paneId: "%1", text: "echo ok", enter: true },
      limiterKey: "rest",
      sendLimiter: vi.fn(() => true),
      rawLimiter: vi.fn(() => true),
    });

    expect(tmuxActions.sendText).toHaveBeenCalledWith("%1", "echo ok", true);
    expect(monitor.recordInput).toHaveBeenCalledWith("%1");
    expect(response.ok).toBe(true);
  });

  it("uses raw limiter for send.raw payloads", async () => {
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = {
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(async () => ({ ok: true })),
    } as unknown as TmuxActions;

    const response = await createCommandResponse({
      monitor,
      tmuxActions,
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
