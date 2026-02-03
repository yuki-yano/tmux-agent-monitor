import { type AgentMonitorConfig, defaultConfig } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import type { createSessionMonitor } from "../monitor.js";
import type { createTmuxActions } from "../tmux-actions.js";
import { handleCommandMessage } from "./command-handler.js";

type Monitor = ReturnType<typeof createSessionMonitor>;
type TmuxActions = ReturnType<typeof createTmuxActions>;

const baseConfig: AgentMonitorConfig = { ...defaultConfig, token: "test-token" };

const buildMessage = (overrides?: Partial<{ paneId: string; text: string }>) => ({
  type: "send.text" as const,
  ts: "2025-01-01T00:00:00.000Z",
  data: {
    paneId: "%1",
    text: "ls",
    ...overrides,
  },
});

describe("handleCommandMessage", () => {
  it("returns read-only error when config is read-only", async () => {
    const send = vi.fn();
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = { sendText: vi.fn(), sendKeys: vi.fn() } as unknown as TmuxActions;
    const sendLimiter = vi.fn(() => true);

    await handleCommandMessage({
      config: { ...baseConfig, readOnly: true },
      monitor,
      tmuxActions,
      message: buildMessage(),
      reqId: "req-1",
      sendLimiter,
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0];
    expect(payload.type).toBe("command.response");
    expect(payload.data.ok).toBe(false);
    expect(payload.data.error?.code).toBe("READ_ONLY");
  });

  it("records input on successful send", async () => {
    const send = vi.fn();
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = {
      sendText: vi.fn(async () => ({ ok: true })),
      sendKeys: vi.fn(),
    } as unknown as TmuxActions;
    const sendLimiter = vi.fn(() => true);

    await handleCommandMessage({
      config: { ...baseConfig, readOnly: false },
      monitor,
      tmuxActions,
      message: buildMessage({ text: "echo ok" }),
      reqId: "req-2",
      sendLimiter,
      send,
    });

    expect(tmuxActions.sendText).toHaveBeenCalledWith("%1", "echo ok", true);
    expect(monitor.recordInput).toHaveBeenCalledWith("%1");
    const payload = send.mock.calls[0]?.[0];
    expect(payload.type).toBe("command.response");
    expect(payload.data.ok).toBe(true);
  });
});
