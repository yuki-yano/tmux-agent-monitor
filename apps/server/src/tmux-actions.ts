import type { AgentMonitorConfig, ApiError, RawItem } from "@vde-monitor/shared";
import { allowedKeys, compileDangerPatterns, isDangerousCommand } from "@vde-monitor/shared";
import type { TmuxAdapter } from "@vde-monitor/tmux";

import { markPaneFocus } from "./activity-suppressor.js";
import { setMapEntryWithLimit } from "./cache.js";
import { resolveBackendApp } from "./screen/macos-app.js";
import { focusTerminalApp, isAppRunning } from "./screen/macos-applescript.js";
import { focusTmuxPane } from "./screen/tmux-geometry.js";

const buildError = (code: ApiError["code"], message: string): ApiError => ({
  code,
  message,
});

type ActionResult = { ok: true; error?: undefined } | { ok: false; error: ApiError };

export const createTmuxActions = (adapter: TmuxAdapter, config: AgentMonitorConfig) => {
  const PENDING_COMMANDS_MAX_ENTRIES = 500;
  const dangerPatterns = compileDangerPatterns(config.dangerCommandPatterns);
  const dangerKeys = new Set(config.dangerKeys);
  const allowedKeySet = new Set(allowedKeys);
  const pendingCommands = new Map<string, string>();
  const enterKey = config.input.enterKey || "C-m";
  const enterDelayMs = config.input.enterDelayMs ?? 0;
  const bracketedPaste = (value: string) => `\u001b[200~${value}\u001b[201~`;

  const okResult = (): ActionResult => ({ ok: true });
  const invalidPayload = (message: string): ActionResult => ({
    ok: false,
    error: buildError("INVALID_PAYLOAD", message),
  });
  const internalError = (message: string): ActionResult => ({
    ok: false,
    error: buildError("INTERNAL", message),
  });
  const dangerousCommand = (): ActionResult => ({
    ok: false,
    error: buildError("DANGEROUS_COMMAND", "dangerous command blocked"),
  });
  const dangerousKey = (): ActionResult => ({
    ok: false,
    error: buildError("DANGEROUS_COMMAND", "dangerous key blocked"),
  });
  const normalizeText = (value: string) => value.replace(/\r\n/g, "\n");

  const ensureTextLength = (value: string): ActionResult | null => {
    if (value.length > config.input.maxTextLength) {
      return invalidPayload("text too long");
    }
    return null;
  };

  const hasInvalidKey = (keys: string[]) => keys.some((key) => !allowedKeySet.has(key as never));

  const hasDangerKey = (keys: string[]) => keys.some((key) => dangerKeys.has(key));

  const prepareSendText = (paneId: string, text: string) => {
    const normalized = normalizeText(text);
    const pending = pendingCommands.get(paneId) ?? "";
    return { normalized, combined: `${pending}${normalized}` };
  };

  const validateSendTextInput = (text: string): ActionResult | null => {
    if (!text || text.trim().length === 0) {
      return invalidPayload("text is required");
    }
    return ensureTextLength(text);
  };

  const validateCombinedText = (paneId: string, combined: string): ActionResult | null => {
    if (combined.length > config.input.maxTextLength) {
      pendingCommands.delete(paneId);
      return invalidPayload("text too long");
    }
    if (isDangerousCommand(combined, dangerPatterns)) {
      pendingCommands.delete(paneId);
      return dangerousCommand();
    }
    return null;
  };

  const validateSendKeysInput = (keys: string[]): ActionResult | null => {
    if (keys.length === 0 || hasInvalidKey(keys)) {
      return invalidPayload("invalid keys");
    }
    if (hasDangerKey(keys)) {
      return dangerousKey();
    }
    return null;
  };

  const validateRawItems = (items: RawItem[], unsafe: boolean): ActionResult | null => {
    if (!items || items.length === 0) {
      return invalidPayload("items are required");
    }
    const keys = items.filter((item) => item.kind === "key").map((item) => item.value);
    if (hasInvalidKey(keys)) {
      return invalidPayload("invalid keys");
    }
    if (!unsafe && hasDangerKey(keys)) {
      return dangerousKey();
    }
    return null;
  };

  const exitCopyModeIfNeeded = async (paneId: string) => {
    await adapter.run([
      "if-shell",
      "-t",
      paneId,
      '[ "#{pane_in_mode}" = "1" ]',
      `copy-mode -q -t ${paneId}`,
    ]);
  };

  const sendLiteralKeys = async (paneId: string, payload: string): Promise<ActionResult> => {
    const result = await adapter.run(["send-keys", "-l", "-t", paneId, payload]);
    if (result.exitCode !== 0) {
      return internalError(result.stderr || "send-keys failed");
    }
    return okResult();
  };

  const sendEnterKey = async (paneId: string): Promise<ActionResult> => {
    if (enterDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, enterDelayMs));
    }
    const result = await adapter.run(["send-keys", "-t", paneId, enterKey]);
    if (result.exitCode !== 0) {
      return internalError(result.stderr || "send-keys Enter failed");
    }
    return okResult();
  };

  const sendRawText = async (paneId: string, value: string) => {
    if (!value) {
      return okResult();
    }
    const lengthError = ensureTextLength(value);
    if (lengthError) {
      return lengthError;
    }
    const normalized = normalizeText(value);
    const payload = normalized.includes("\n") ? bracketedPaste(normalized) : normalized;
    return sendLiteralKeys(paneId, payload);
  };

  const sendRawItem = async (paneId: string, item: RawItem): Promise<ActionResult> => {
    if (item.kind === "text") {
      return sendRawText(paneId, item.value);
    }
    const result = await adapter.run(["send-keys", "-t", paneId, item.value]);
    if (result.exitCode !== 0) {
      return internalError(result.stderr || "send-keys failed");
    }
    return okResult();
  };

  const resolveTextPayload = (normalized: string) =>
    normalized.includes("\n") ? bracketedPaste(normalized) : normalized;

  const finalizePendingText = ({
    paneId,
    enter,
    normalized,
    combined,
  }: {
    paneId: string;
    enter: boolean;
    normalized: string;
    combined: string;
  }) => {
    if (enter || normalized.includes("\n")) {
      pendingCommands.delete(paneId);
      return okResult();
    }
    setMapEntryWithLimit(pendingCommands, paneId, combined, PENDING_COMMANDS_MAX_ENTRIES);
    return okResult();
  };

  const sendText = async (paneId: string, text: string, enter = true) => {
    const inputError = validateSendTextInput(text);
    if (inputError) {
      return inputError;
    }

    const prepared = prepareSendText(paneId, text);
    const combinedError = validateCombinedText(paneId, prepared.combined);
    if (combinedError) {
      return combinedError;
    }

    await exitCopyModeIfNeeded(paneId);
    const payload = resolveTextPayload(prepared.normalized);
    const sendResult = await sendLiteralKeys(paneId, payload);
    if (!sendResult.ok) {
      return sendResult;
    }

    if (enter) {
      const enterResult = await sendEnterKey(paneId);
      if (!enterResult.ok) {
        return enterResult;
      }
    }
    return finalizePendingText({
      paneId,
      enter,
      normalized: prepared.normalized,
      combined: prepared.combined,
    });
  };

  const sendKeys = async (paneId: string, keys: string[]) => {
    const validationError = validateSendKeysInput(keys);
    if (validationError) {
      return validationError;
    }
    for (const key of keys) {
      const result = await adapter.run(["send-keys", "-t", paneId, key]);
      if (result.exitCode !== 0) {
        return internalError(result.stderr || "send-keys failed");
      }
    }
    return okResult();
  };

  const sendRaw = async (paneId: string, items: RawItem[], unsafe = false) => {
    const validationError = validateRawItems(items, unsafe);
    if (validationError) {
      return validationError;
    }

    await exitCopyModeIfNeeded(paneId);
    for (const item of items) {
      const result = await sendRawItem(paneId, item);
      if (!result.ok) {
        return result;
      }
    }
    return okResult();
  };

  const focusPane = async (paneId: string): Promise<ActionResult> => {
    if (!paneId) {
      return invalidPayload("pane id is required");
    }
    if (process.platform !== "darwin") {
      return invalidPayload("focus is only supported on macOS");
    }
    const app = resolveBackendApp(config.screen.image.backend);
    if (!app) {
      return invalidPayload("invalid terminal backend");
    }

    try {
      const running = await isAppRunning(app.appName);
      if (!running) {
        return {
          ok: false,
          error: buildError("TMUX_UNAVAILABLE", "Terminal is not running"),
        };
      }

      await focusTerminalApp(app.appName);
      markPaneFocus(paneId);
      await focusTmuxPane(paneId, config.tmux).catch(() => null);
      return okResult();
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to focus pane";
      return internalError(message);
    }
  };

  return { sendText, sendKeys, sendRaw, focusPane };
};
