import { type AgentMonitorConfig, defaultConfig, type RawItem } from "@vde-monitor/shared";
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

const buildRawMessage = () => ({
  type: "send.raw" as const,
  ts: "2025-01-01T00:00:00.000Z",
  data: {
    paneId: "%1",
    items: [{ kind: "key", value: "Enter" }] as RawItem[],
  },
});

describe("handleCommandMessage", () => {
  it("returns read-only error when config is read-only", async () => {
    const send = vi.fn();
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = {
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(),
    } as unknown as TmuxActions;
    const sendLimiter = vi.fn(() => true);
    const rawLimiter = vi.fn(() => true);

    await handleCommandMessage({
      config: { ...baseConfig, readOnly: true },
      monitor,
      tmuxActions,
      message: buildMessage(),
      reqId: "req-1",
      sendLimiter,
      rawLimiter,
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
      sendRaw: vi.fn(),
    } as unknown as TmuxActions;
    const sendLimiter = vi.fn(() => true);
    const rawLimiter = vi.fn(() => true);

    await handleCommandMessage({
      config: { ...baseConfig, readOnly: false },
      monitor,
      tmuxActions,
      message: buildMessage({ text: "echo ok" }),
      reqId: "req-2",
      sendLimiter,
      rawLimiter,
      send,
    });

    expect(tmuxActions.sendText).toHaveBeenCalledWith("%1", "echo ok", true);
    expect(monitor.recordInput).toHaveBeenCalledWith("%1");
    const payload = send.mock.calls[0]?.[0];
    expect(payload.type).toBe("command.response");
    expect(payload.data.ok).toBe(true);
  });

  it("routes raw commands through sendRaw", async () => {
    const send = vi.fn();
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = {
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(async () => ({ ok: true })),
    } as unknown as TmuxActions;
    const sendLimiter = vi.fn(() => true);
    const rawLimiter = vi.fn(() => true);

    await handleCommandMessage({
      config: { ...baseConfig, readOnly: false },
      monitor,
      tmuxActions,
      message: buildRawMessage(),
      reqId: "req-3",
      sendLimiter,
      rawLimiter,
      send,
    });

    expect(tmuxActions.sendRaw).toHaveBeenCalledWith(
      "%1",
      [{ kind: "key", value: "Enter" }],
      false,
    );
    expect(monitor.recordInput).toHaveBeenCalledWith("%1");
    const payload = send.mock.calls[0]?.[0];
    expect(payload.type).toBe("command.response");
    expect(payload.data.ok).toBe(true);
  });

  it("uses raw limiter for send.raw messages", async () => {
    const send = vi.fn();
    const monitor = { recordInput: vi.fn() } as unknown as Monitor;
    const tmuxActions = {
      sendText: vi.fn(),
      sendKeys: vi.fn(),
      sendRaw: vi.fn(async () => ({ ok: true })),
    } as unknown as TmuxActions;
    const sendLimiter = vi.fn(() => true);
    const rawLimiter = vi.fn(() => false);

    await handleCommandMessage({
      config: { ...baseConfig, readOnly: false },
      monitor,
      tmuxActions,
      message: buildRawMessage(),
      reqId: "req-4",
      sendLimiter,
      rawLimiter,
      send,
    });

    expect(rawLimiter).toHaveBeenCalledWith("ws");
    expect(sendLimiter).not.toHaveBeenCalled();
    const payload = send.mock.calls[0]?.[0];
    expect(payload.data.ok).toBe(false);
    expect(payload.data.error?.code).toBe("RATE_LIMIT");
  });
});
