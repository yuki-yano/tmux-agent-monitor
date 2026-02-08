import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { defaultConfig, type RawItem } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWeztermActions } from "./actions";
import { decodeNextPduFrame, encodeErrorResponseReason, encodePduFrame } from "./proxy-codec";

type FakeChild = ChildProcessWithoutNullStreams & EventEmitter;

const createFakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: vi.fn(() => {
      (child as unknown as { killed: boolean }).killed = true;
      return true;
    }),
  });
  return child;
};

describe("createWeztermActions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends text and enter", async () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const actions = createWeztermActions(
      {
        run,
      },
      {
        ...defaultConfig,
        token: "token",
      },
    );

    const result = await actions.sendText("1", "echo hi", true);

    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, ["send-text", "--pane-id", "1", "echo hi"]);
    expect(run).toHaveBeenNthCalledWith(2, ["send-text", "--pane-id", "1", "--no-paste", "\r"]);
  });

  it("waits enterDelayMs before sending enter", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const actions = createWeztermActions(
      {
        run,
      },
      {
        ...defaultConfig,
        token: "token",
        input: {
          ...defaultConfig.input,
          enterDelayMs: 120,
        },
      },
    );

    const promise = actions.sendText("1", "echo hi", true);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, ["send-text", "--pane-id", "1", "echo hi"]);
    expect(run).toHaveBeenNthCalledWith(2, ["send-text", "--pane-id", "1", "--no-paste", "\r"]);
  });

  it("blocks dangerous commands across split sendText", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const actions = createWeztermActions(adapter, {
      ...defaultConfig,
      token: "token",
    });

    const first = await actions.sendText("1", "rm ", false);
    const second = await actions.sendText("1", "-rf /tmp", true);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("DANGEROUS_COMMAND");
  });

  it("returns WEZTERM_UNAVAILABLE when wezterm is not running", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        stdout: "",
        stderr: "no running wezterm instance",
        exitCode: 1,
      })),
    };
    const actions = createWeztermActions(adapter, {
      ...defaultConfig,
      token: "token",
    });

    const result = await actions.sendText("1", "ls", false);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("WEZTERM_UNAVAILABLE");
  });

  it("sends keys through wezterm proxy", async () => {
    const child = createFakeChild();
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    child.stdin.on("data", (chunk: Buffer) => {
      const frame = decodeNextPduFrame(Buffer.from(chunk));
      if (!frame) {
        return;
      }
      expect(frame.ident).toBe(11);
      (child.stdout as unknown as PassThrough).write(
        encodePduFrame({
          ident: 10,
          serial: frame.serial,
          data: Buffer.alloc(0),
        }),
      );
    });

    const actions = createWeztermActions(
      {
        run,
        spawnProxy: () => child,
      },
      {
        ...defaultConfig,
        token: "token",
      },
    );

    const result = await actions.sendKeys("12", ["Enter"]);

    expect(result.ok).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns proxy error without fallback to send-text", async () => {
    const child = createFakeChild();
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    child.stdin.on("data", (chunk: Buffer) => {
      const frame = decodeNextPduFrame(Buffer.from(chunk));
      if (!frame) {
        return;
      }
      (child.stdout as unknown as PassThrough).write(
        encodePduFrame({
          ident: 0,
          serial: frame.serial,
          data: encodeErrorResponseReason("pane 404 not found"),
        }),
      );
    });

    const actions = createWeztermActions(
      {
        run,
        spawnProxy: () => child,
      },
      {
        ...defaultConfig,
        token: "token",
      },
    );

    const result = await actions.sendKeys("404", ["Enter"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_PANE");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("returns INTERNAL when proxy times out", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const actions = createWeztermActions(
      {
        run,
        spawnProxy: () => child,
      },
      {
        ...defaultConfig,
        token: "token",
      },
    );

    const resultPromise = actions.sendKeys("12", ["Enter"]);
    await vi.advanceTimersByTimeAsync(1600);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("timed out");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("returns INTERNAL when proxy is unavailable", async () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const actions = createWeztermActions(
      {
        run,
      },
      {
        ...defaultConfig,
        token: "token",
      },
    );

    const result = await actions.sendKeys("12", ["Enter"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("proxy is not available");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("sends raw text and keys in order", async () => {
    const child = createFakeChild();
    const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    child.stdin.on("data", (chunk: Buffer) => {
      const frame = decodeNextPduFrame(Buffer.from(chunk));
      if (!frame) {
        return;
      }
      (child.stdout as unknown as PassThrough).write(
        encodePduFrame({
          ident: 10,
          serial: frame.serial,
          data: Buffer.alloc(0),
        }),
      );
    });

    const actions = createWeztermActions(
      {
        run,
        spawnProxy: () => child,
      },
      {
        ...defaultConfig,
        token: "token",
      },
    );
    const items: RawItem[] = [
      { kind: "text", value: "ls" },
      { kind: "key", value: "Enter" },
    ];

    const result = await actions.sendRaw("1", items, false);

    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(["send-text", "--pane-id", "1", "ls"]);
  });

  it("focuses pane via activate-pane", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const actions = createWeztermActions(adapter, {
      ...defaultConfig,
      token: "token",
    });

    const result = await actions.focusPane("1");

    expect(result.ok).toBe(true);
    expect(adapter.run).toHaveBeenCalledWith(["activate-pane", "--pane-id", "1"]);
  });

  it("returns INVALID_PANE when focus target does not exist", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        stdout: "",
        stderr: "pane 9 not found",
        exitCode: 1,
      })),
    };
    const actions = createWeztermActions(adapter, {
      ...defaultConfig,
      token: "token",
    });

    const result = await actions.focusPane("9");

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PANE");
  });
});
