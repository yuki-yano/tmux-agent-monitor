import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { sendProxyKeyDown, toProxyKeyEvent } from "./proxy.js";
import {
  decodeNextPduFrame,
  encodeErrorResponseReason,
  encodeLeb128Unsigned,
  encodePduFrame,
} from "./proxy-codec.js";

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

describe("proxy", () => {
  it("maps allowed key to proxy event", () => {
    expect(toProxyKeyEvent("C-Right")).toEqual({
      key: { kind: "named", value: "RightArrow" },
      modifiers: 8,
    });
  });

  it("sends SendKeyDown via proxy and handles UnitResponse", async () => {
    const child = createFakeChild();
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

    const adapter = {
      run: vi.fn(),
      spawnProxy: () => child,
    };

    const result = await sendProxyKeyDown({
      adapter,
      paneId: "12",
      event: toProxyKeyEvent("Enter")!,
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(true);
    expect(child.kill).toHaveBeenCalled();
  });

  it("maps ErrorResponse from proxy to INVALID_PANE", async () => {
    const child = createFakeChild();
    child.stdin.on("data", (chunk: Buffer) => {
      const frame = decodeNextPduFrame(Buffer.from(chunk));
      if (!frame) {
        return;
      }
      (child.stdout as unknown as PassThrough).write(
        encodePduFrame({
          ident: 0,
          serial: frame.serial,
          data: encodeErrorResponseReason("pane 99 not found"),
        }),
      );
    });

    const adapter = {
      run: vi.fn(),
      spawnProxy: () => child,
    };

    const result = await sendProxyKeyDown({
      adapter,
      paneId: "99",
      event: toProxyKeyEvent("Enter")!,
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_PANE");
    }
  });

  it("maps spawn ENOENT to WEZTERM_UNAVAILABLE", async () => {
    const adapter = {
      run: vi.fn(),
      spawnProxy: () => {
        throw new Error("spawn wezterm ENOENT");
      },
    };

    const result = await sendProxyKeyDown({
      adapter,
      paneId: "1",
      event: toProxyKeyEvent("Enter")!,
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WEZTERM_UNAVAILABLE");
    }
  });

  it("returns INTERNAL on timeout", async () => {
    const child = createFakeChild();
    const adapter = {
      run: vi.fn(),
      spawnProxy: () => child,
    };

    const result = await sendProxyKeyDown({
      adapter,
      paneId: "1",
      event: toProxyKeyEvent("Enter")!,
      timeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("timed out");
    }
  });

  it("returns INTERNAL on malformed compressed frame", async () => {
    const child = createFakeChild();
    const adapter = {
      run: vi.fn(),
      spawnProxy: () => child,
    };

    child.stdin.on("data", () => {
      (child.stdout as unknown as PassThrough).write(encodeLeb128Unsigned(1n << 63n));
    });

    const result = await sendProxyKeyDown({
      adapter,
      paneId: "1",
      event: toProxyKeyEvent("Enter")!,
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("compressed pdu");
    }
  });
});
