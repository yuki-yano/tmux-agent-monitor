import type { AgentMonitorConfig, AllowedKey, ApiError, RawItem } from "@vde-monitor/shared";
import { allowedKeys, compileDangerPatterns, isDangerousCommand } from "@vde-monitor/shared";

import type { WeztermAdapter } from "./adapter";
import { sendProxyKeyDown, toProxyKeyEvent } from "./proxy";

type ActionResult = { ok: true; error?: undefined } | { ok: false; error: ApiError };
const PROXY_TIMEOUT_MS = 1500;

const buildError = (code: ApiError["code"], message: string): ApiError => ({
  code,
  message,
});

const normalizeText = (value: string) => value.replace(/\r\n/g, "\n");

const isUnavailableError = (message: string) =>
  /no running wezterm|failed to connect|cannot connect|unable to connect/i.test(message);

const isPaneNotFoundError = (message: string) =>
  /pane .*not found|no such pane|invalid pane/i.test(message);

const resolveCliError = (stderr: string, fallbackMessage: string): ApiError => {
  const message = stderr || fallbackMessage;
  if (isUnavailableError(message)) {
    return buildError("WEZTERM_UNAVAILABLE", message);
  }
  if (isPaneNotFoundError(message)) {
    return buildError("INVALID_PANE", message);
  }
  return buildError("INTERNAL", message);
};

const sendTextToPane = async (
  adapter: WeztermAdapter,
  paneId: string,
  text: string,
  noPaste = false,
): Promise<ActionResult> => {
  const args = ["send-text", "--pane-id", paneId];
  if (noPaste) {
    args.push("--no-paste");
  }
  args.push(text);
  const result = await adapter.run(args);
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: resolveCliError(result.stderr, "wezterm send-text failed"),
    };
  }
  return { ok: true };
};

export const createWeztermActions = (adapter: WeztermAdapter, config: AgentMonitorConfig) => {
  const pendingCommands = new Map<string, string>();
  const maxPendingEntries = 500;
  const dangerPatterns = compileDangerPatterns(config.dangerCommandPatterns);
  const dangerKeys = new Set(config.dangerKeys);
  const allowedKeySet = new Set(allowedKeys);
  const enterDelayMs = config.input.enterDelayMs ?? 0;

  const okResult = (): ActionResult => ({ ok: true });
  const invalidPayload = (message: string): ActionResult => ({
    ok: false,
    error: buildError("INVALID_PAYLOAD", message),
  });
  const dangerousCommand = (): ActionResult => ({
    ok: false,
    error: buildError("DANGEROUS_COMMAND", "dangerous command blocked"),
  });
  const dangerousKey = (): ActionResult => ({
    ok: false,
    error: buildError("DANGEROUS_COMMAND", "dangerous key blocked"),
  });

  const sendKey = async (paneId: string, key: AllowedKey): Promise<ActionResult> => {
    const proxyEvent = toProxyKeyEvent(key);
    if (!proxyEvent) {
      return invalidPayload(`unsupported key: ${key}`);
    }
    const proxyResult = await sendProxyKeyDown({
      adapter,
      paneId,
      event: proxyEvent,
      timeoutMs: PROXY_TIMEOUT_MS,
    });
    if (!proxyResult.ok) {
      return {
        ok: false,
        error: buildError(proxyResult.error.code, proxyResult.error.message),
      };
    }
    return okResult();
  };

  const setPending = (paneId: string, value: string) => {
    if (pendingCommands.size >= maxPendingEntries && !pendingCommands.has(paneId)) {
      const oldest = pendingCommands.keys().next().value;
      if (oldest) {
        pendingCommands.delete(oldest);
      }
    }
    pendingCommands.set(paneId, value);
  };

  const ensureTextLength = (value: string): ActionResult | null => {
    if (value.length > config.input.maxTextLength) {
      return invalidPayload("text too long");
    }
    return null;
  };

  const waitForEnterDelay = async () => {
    if (enterDelayMs <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, enterDelayMs));
  };

  const sendText = async (paneId: string, text: string, enter = true): Promise<ActionResult> => {
    if (!text || text.trim().length === 0) {
      return invalidPayload("text is required");
    }
    const lengthError = ensureTextLength(text);
    if (lengthError) {
      return lengthError;
    }

    const normalized = normalizeText(text);
    const pending = pendingCommands.get(paneId) ?? "";
    const combined = `${pending}${normalized}`;

    if (combined.length > config.input.maxTextLength) {
      pendingCommands.delete(paneId);
      return invalidPayload("text too long");
    }
    if (isDangerousCommand(combined, dangerPatterns)) {
      pendingCommands.delete(paneId);
      return dangerousCommand();
    }

    const sendResult = await sendTextToPane(adapter, paneId, normalized);
    if (!sendResult.ok) {
      return sendResult;
    }

    if (enter) {
      await waitForEnterDelay();
      const sendEnterResult = await sendTextToPane(adapter, paneId, "\r", true);
      if (!sendEnterResult.ok) {
        return sendEnterResult;
      }
    }

    if (enter || normalized.includes("\n")) {
      pendingCommands.delete(paneId);
    } else {
      setPending(paneId, combined);
    }
    return okResult();
  };

  const sendKeys = async (paneId: string, keys: AllowedKey[]): Promise<ActionResult> => {
    if (keys.length === 0) {
      return invalidPayload("invalid keys");
    }
    if (keys.some((key) => !allowedKeySet.has(key))) {
      return invalidPayload("invalid keys");
    }
    if (keys.some((key) => dangerKeys.has(key))) {
      return dangerousKey();
    }

    for (const key of keys) {
      const sendResult = await sendKey(paneId, key);
      if (!sendResult.ok) {
        return sendResult;
      }
    }
    return okResult();
  };

  const sendRaw = async (
    paneId: string,
    items: RawItem[],
    unsafe = false,
  ): Promise<ActionResult> => {
    if (!items || items.length === 0) {
      return invalidPayload("items are required");
    }
    const keys = items.filter((item) => item.kind === "key").map((item) => item.value);
    if (keys.some((key) => !allowedKeySet.has(key))) {
      return invalidPayload("invalid keys");
    }
    if (!unsafe && keys.some((key) => dangerKeys.has(key))) {
      return dangerousKey();
    }

    for (const item of items) {
      if (item.kind === "text") {
        const lengthError = ensureTextLength(item.value);
        if (lengthError) {
          return lengthError;
        }
        const sendResult = await sendTextToPane(adapter, paneId, normalizeText(item.value));
        if (!sendResult.ok) {
          return sendResult;
        }
        continue;
      }
      const sendResult = await sendKey(paneId, item.value);
      if (!sendResult.ok) {
        return sendResult;
      }
    }
    return okResult();
  };

  const focusPane = async (paneId: string): Promise<ActionResult> => {
    if (!paneId) {
      return invalidPayload("pane id is required");
    }
    const result = await adapter.run(["activate-pane", "--pane-id", paneId]);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: resolveCliError(result.stderr, "wezterm activate-pane failed"),
      };
    }
    return okResult();
  };

  return {
    sendText,
    sendKeys,
    sendRaw,
    focusPane,
  };
};
