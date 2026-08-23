import { createInterface } from "node:readline";
import { asNumber, isRecord } from "../parse-utils";

import { UsageProviderError } from "../usage-shared/usage-error";
import { type CodexAppServerPort, defaultCodexAppServerPort } from "./codex-app-server-process";

type JsonRpcId = string | number;

type CodexRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

type CodexCreditsSnapshot = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

export type CodexRateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: CodexCreditsSnapshot | null;
  planType: string | null;
};

export type CodexRateLimitsResponse = {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
};

type JsonRpcResponse = {
  id?: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type FetchCodexRateLimitsOptions = {
  timeoutMs?: number;
  cwd?: string;
  port?: CodexAppServerPort;
};

const DEFAULT_TIMEOUT_MS = 5_000;

const asNullableString = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const parseWindow = (value: unknown): CodexRateLimitWindow | null => {
  if (!isRecord(value)) {
    return null;
  }
  const usedPercent = asNumber(value.usedPercent);
  if (usedPercent == null) {
    return null;
  }
  const windowDurationMins = asNumber(value.windowDurationMins);
  const resetsAt = asNumber(value.resetsAt);
  return {
    usedPercent,
    windowDurationMins: windowDurationMins == null ? null : Math.round(windowDurationMins),
    resetsAt: resetsAt == null ? null : Math.round(resetsAt),
  };
};

const parseCredits = (value: unknown): CodexCreditsSnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    hasCredits: value.hasCredits === true,
    unlimited: value.unlimited === true,
    balance: asNullableString(value.balance),
  };
};

const parseSnapshot = (value: unknown): CodexRateLimitSnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    limitId: asNullableString(value.limitId),
    limitName: asNullableString(value.limitName),
    primary: parseWindow(value.primary),
    secondary: parseWindow(value.secondary),
    credits: parseCredits(value.credits),
    planType: asNullableString(value.planType),
  };
};

const parseRateLimitsResult = (value: unknown): CodexRateLimitsResponse | null => {
  if (!isRecord(value)) {
    return null;
  }
  const rateLimits = parseSnapshot(value.rateLimits);
  if (!rateLimits) {
    return null;
  }

  const rawByLimitId = value.rateLimitsByLimitId;
  let rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null = null;
  if (isRecord(rawByLimitId)) {
    const entries = Object.entries(rawByLimitId)
      .map(([limitId, snapshot]) => {
        const parsed = parseSnapshot(snapshot);
        if (!parsed) {
          return null;
        }
        return [limitId, parsed] as const;
      })
      .filter((entry): entry is readonly [string, CodexRateLimitSnapshot] => entry != null);
    rateLimitsByLimitId = Object.fromEntries(entries);
  }

  return {
    rateLimits,
    rateLimitsByLimitId,
  };
};

const randomRequestId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const fetchCodexRateLimits = async ({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd = process.cwd(),
  port = defaultCodexAppServerPort,
}: FetchCodexRateLimitsOptions = {}): Promise<CodexRateLimitsResponse> =>
  new Promise((resolve, reject) => {
    const processHandle = port.spawnAppServer(cwd);
    const reader = createInterface({ input: processHandle.stdout });

    let settled = false;
    let stderr = "";
    const initRequestId = randomRequestId("init");
    const readRequestId = randomRequestId("rate-limits");

    // Stdin may emit EPIPE after child exit; keep it handled to avoid process crashes.
    processHandle.stdin.on("error", () => {});

    const cleanup = () => {
      reader.close();
      if (!processHandle.stdin.destroyed) {
        processHandle.stdin.end();
      }
      processHandle.removeAllListeners();
      processHandle.stdout.removeAllListeners();
      processHandle.stderr.removeAllListeners();
      processHandle.stdin.removeAllListeners();
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      processHandle.kill();
      reject(error);
    };

    const succeed = (response: CodexRateLimitsResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      processHandle.kill();
      resolve(response);
    };

    const writeMessage = (message: Record<string, unknown>) => {
      if (settled || processHandle.stdin.destroyed || !processHandle.stdin.writable) {
        return;
      }
      processHandle.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timeoutId = setTimeout(() => {
      fail(
        new UsageProviderError(
          "CODEX_APP_SERVER_UNAVAILABLE",
          "Codex app-server request timed out",
        ),
      );
    }, timeoutMs);

    processHandle.on("error", () => {
      fail(
        new UsageProviderError("CODEX_APP_SERVER_UNAVAILABLE", "Failed to launch codex app-server"),
      );
    });

    processHandle.on("exit", (code) => {
      if (settled) {
        return;
      }
      const suffix = stderr.trim().length > 0 ? `: ${stderr.trim()}` : "";
      fail(
        new UsageProviderError(
          "CODEX_APP_SERVER_UNAVAILABLE",
          `codex app-server exited unexpectedly (code=${code ?? "unknown"})${suffix}`,
        ),
      );
    });

    processHandle.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    reader.on("line", (line) => {
      if (settled) {
        return;
      }
      let parsedMessage: JsonRpcResponse;
      try {
        parsedMessage = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }

      if (parsedMessage.id === initRequestId) {
        if (parsedMessage.error) {
          fail(
            new UsageProviderError(
              "CODEX_APP_SERVER_UNAVAILABLE",
              "Failed to initialize codex app-server",
            ),
          );
          return;
        }
        writeMessage({
          jsonrpc: "2.0",
          method: "initialized",
        });
        writeMessage({
          jsonrpc: "2.0",
          id: readRequestId,
          method: "account/rateLimits/read",
          params: null,
        });
        return;
      }

      if (parsedMessage.id === readRequestId) {
        if (parsedMessage.error) {
          const errorMessage =
            parsedMessage.error.message?.trim() || "Failed to read codex rate limits";
          fail(new UsageProviderError("UPSTREAM_UNAVAILABLE", errorMessage));
          return;
        }
        const result = parseRateLimitsResult(parsedMessage.result);
        if (!result) {
          fail(
            new UsageProviderError(
              "UNSUPPORTED_RESPONSE",
              "Codex rate limits response format is unsupported",
            ),
          );
          return;
        }
        succeed(result);
      }
    });

    writeMessage({
      jsonrpc: "2.0",
      id: initRequestId,
      method: "initialize",
      params: {
        clientInfo: {
          name: "vde-monitor",
          version: "0.0.0",
        },
        capabilities: null,
      },
    });
  });
