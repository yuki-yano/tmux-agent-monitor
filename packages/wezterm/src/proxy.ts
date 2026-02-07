import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { AllowedKey, ApiErrorCode } from "@vde-monitor/shared";

import type { WeztermAdapter } from "./adapter.js";
import {
  decodeErrorResponseReason,
  decodeNextPduFrame,
  encodePduFrame,
  encodeSendKeyDownPayload,
  type ProxyKeyEvent,
} from "./proxy-codec.js";

const SHIFT = 1 << 1;
const CTRL = 1 << 3;

const PDU_IDENT_ERROR_RESPONSE = 0;
const PDU_IDENT_UNIT_RESPONSE = 10;
const PDU_IDENT_SEND_KEY_DOWN = 11;

const isUnavailableError = (message: string) =>
  /no running wezterm|failed to connect|cannot connect|unable to connect|ENOENT|spawn .* ENOENT/i.test(
    message,
  );

const isPaneNotFoundError = (message: string) =>
  /pane .*not found|no such pane|invalid pane/i.test(message);

const resolveProxyErrorCode = (message: string): ApiErrorCode => {
  if (isUnavailableError(message)) {
    return "WEZTERM_UNAVAILABLE";
  }
  if (isPaneNotFoundError(message)) {
    return "INVALID_PANE";
  }
  return "INTERNAL";
};

export type ProxySendResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

export const toProxyKeyEvent = (key: AllowedKey): ProxyKeyEvent | null => {
  switch (key) {
    case "Enter":
      return { key: { kind: "named", value: "Enter" }, modifiers: 0 };
    case "Escape":
      return { key: { kind: "named", value: "Escape" }, modifiers: 0 };
    case "Tab":
      return { key: { kind: "named", value: "Tab" }, modifiers: 0 };
    case "BTab":
      return { key: { kind: "named", value: "Tab" }, modifiers: SHIFT };
    case "C-Tab":
      return { key: { kind: "named", value: "Tab" }, modifiers: CTRL };
    case "C-BTab":
      return { key: { kind: "named", value: "Tab" }, modifiers: CTRL | SHIFT };
    case "Space":
      return { key: { kind: "char", value: " " }, modifiers: 0 };
    case "BSpace":
      return { key: { kind: "named", value: "Backspace" }, modifiers: 0 };
    case "Up":
      return { key: { kind: "named", value: "UpArrow" }, modifiers: 0 };
    case "Down":
      return { key: { kind: "named", value: "DownArrow" }, modifiers: 0 };
    case "Right":
      return { key: { kind: "named", value: "RightArrow" }, modifiers: 0 };
    case "Left":
      return { key: { kind: "named", value: "LeftArrow" }, modifiers: 0 };
    case "C-Up":
      return { key: { kind: "named", value: "UpArrow" }, modifiers: CTRL };
    case "C-Down":
      return { key: { kind: "named", value: "DownArrow" }, modifiers: CTRL };
    case "C-Right":
      return { key: { kind: "named", value: "RightArrow" }, modifiers: CTRL };
    case "C-Left":
      return { key: { kind: "named", value: "LeftArrow" }, modifiers: CTRL };
    case "C-Enter":
      return { key: { kind: "named", value: "Enter" }, modifiers: CTRL };
    case "C-Escape":
      return { key: { kind: "named", value: "Escape" }, modifiers: CTRL };
    case "Home":
      return { key: { kind: "named", value: "Home" }, modifiers: 0 };
    case "End":
      return { key: { kind: "named", value: "End" }, modifiers: 0 };
    case "PageUp":
      return { key: { kind: "named", value: "PageUp" }, modifiers: 0 };
    case "PageDown":
      return { key: { kind: "named", value: "PageDown" }, modifiers: 0 };
    case "C-\\":
      return { key: { kind: "char", value: "\\" }, modifiers: CTRL };
    case "F1":
    case "F2":
    case "F3":
    case "F4":
    case "F5":
    case "F6":
    case "F7":
    case "F8":
    case "F9":
    case "F10":
    case "F11":
    case "F12":
      return {
        key: { kind: "function", value: Number.parseInt(key.slice(1), 10) },
        modifiers: 0,
      };
    default:
      break;
  }

  if (/^C-[a-z]$/.test(key)) {
    return {
      key: { kind: "char", value: key.slice(2) },
      modifiers: CTRL,
    };
  }
  return null;
};

export const sendProxyKeyDown = async ({
  adapter,
  paneId,
  event,
  timeoutMs,
}: {
  adapter: WeztermAdapter;
  paneId: string;
  event: ProxyKeyEvent;
  timeoutMs: number;
}): Promise<ProxySendResult> => {
  if (!adapter.spawnProxy) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "wezterm proxy is not available",
      },
    };
  }

  const parsedPaneId = Number.parseInt(paneId, 10);
  if (!Number.isInteger(parsedPaneId) || parsedPaneId < 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_PANE",
        message: `invalid pane id: ${paneId}`,
      },
    };
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = adapter.spawnProxy();
  } catch (error) {
    const message = error instanceof Error ? error.message : "wezterm proxy failed to start";
    return {
      ok: false,
      error: {
        code: resolveProxyErrorCode(message),
        message,
      },
    };
  }
  let settled = false;
  let stdoutBuffer = Buffer.alloc(0);
  let stderrText = "";
  let timer: NodeJS.Timeout | null = null;

  return await new Promise<ProxySendResult>((resolve) => {
    const finish = (result: ProxySendResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
      resolve(result);
    };

    const serial = 1;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      while (stdoutBuffer.length > 0) {
        let frame = null;
        try {
          frame = decodeNextPduFrame(stdoutBuffer);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "failed to decode proxy response";
          finish({
            ok: false,
            error: {
              code: "INTERNAL",
              message,
            },
          });
          return;
        }
        if (!frame) {
          return;
        }
        stdoutBuffer = stdoutBuffer.subarray(frame.bytesConsumed);
        if (frame.serial !== serial) {
          continue;
        }
        if (frame.ident === PDU_IDENT_UNIT_RESPONSE) {
          finish({ ok: true });
          return;
        }
        if (frame.ident === PDU_IDENT_ERROR_RESPONSE) {
          const reason = decodeErrorResponseReason(frame.data) ?? "wezterm proxy error";
          finish({
            ok: false,
            error: {
              code: resolveProxyErrorCode(reason),
              message: reason,
            },
          });
          return;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      const message = error.message || "wezterm proxy failed";
      finish({
        ok: false,
        error: {
          code: resolveProxyErrorCode(message),
          message,
        },
      });
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      const message =
        stderrText.trim() ||
        `wezterm proxy exited before response (code=${String(code)} signal=${String(signal)})`;
      finish({
        ok: false,
        error: {
          code: resolveProxyErrorCode(message),
          message,
        },
      });
    });

    timer = setTimeout(() => {
      finish({
        ok: false,
        error: {
          code: "INTERNAL",
          message: `wezterm proxy timed out after ${timeoutMs}ms`,
        },
      });
    }, timeoutMs);

    const payload = encodeSendKeyDownPayload({
      paneId: parsedPaneId,
      event,
      inputSerialMs: Date.now(),
    });
    const frame = encodePduFrame({
      ident: PDU_IDENT_SEND_KEY_DOWN,
      serial,
      data: payload,
    });
    child.stdin.write(frame, (error) => {
      if (!error) {
        return;
      }
      finish({
        ok: false,
        error: {
          code: "INTERNAL",
          message: error.message || "failed to write proxy request",
        },
      });
    });
  });
};
