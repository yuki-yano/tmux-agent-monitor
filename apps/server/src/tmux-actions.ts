import type { AgentMonitorConfig, ApiError, RawItem } from "@vde-monitor/shared";
import { allowedKeys, compileDangerPatterns, isDangerousCommand } from "@vde-monitor/shared";
import type { TmuxAdapter } from "@vde-monitor/tmux";

const buildError = (code: ApiError["code"], message: string): ApiError => ({
  code,
  message,
});

export const createTmuxActions = (adapter: TmuxAdapter, config: AgentMonitorConfig) => {
  const dangerPatterns = compileDangerPatterns(config.dangerCommandPatterns);
  const dangerKeys = new Set(config.dangerKeys);
  const pendingCommands = new Map<string, string>();
  const enterKey = config.input.enterKey || "C-m";
  const enterDelayMs = config.input.enterDelayMs ?? 0;
  const bracketedPaste = (value: string) => `\u001b[200~${value}\u001b[201~`;

  const sendRawText = async (paneId: string, value: string) => {
    if (!value) return { ok: true as const };
    if (value.length > config.input.maxTextLength) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "text too long") };
    }
    const normalized = value.replace(/\r\n/g, "\n");
    const payload = normalized.includes("\n") ? bracketedPaste(normalized) : normalized;
    const result = await adapter.run(["send-keys", "-l", "-t", paneId, payload]);
    if (result.exitCode !== 0) {
      return { ok: false, error: buildError("INTERNAL", result.stderr || "send-keys failed") };
    }
    return { ok: true as const };
  };

  const sendText = async (paneId: string, text: string, enter = true) => {
    if (!text || text.trim().length === 0) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "text is required") };
    }
    if (text.length > config.input.maxTextLength) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "text too long") };
    }
    const normalized = text.replace(/\r\n/g, "\n");
    const pending = pendingCommands.get(paneId) ?? "";
    const combined = `${pending}${normalized}`;
    if (combined.length > config.input.maxTextLength) {
      pendingCommands.delete(paneId);
      return { ok: false, error: buildError("INVALID_PAYLOAD", "text too long") };
    }
    if (isDangerousCommand(combined, dangerPatterns)) {
      pendingCommands.delete(paneId);
      return { ok: false, error: buildError("DANGEROUS_COMMAND", "dangerous command blocked") };
    }

    await adapter.run([
      "if-shell",
      "-t",
      paneId,
      '[ "#{pane_in_mode}" = "1" ]',
      `copy-mode -q -t ${paneId}`,
    ]);

    if (normalized.includes("\n")) {
      const result = await adapter.run([
        "send-keys",
        "-l",
        "-t",
        paneId,
        bracketedPaste(normalized),
      ]);
      if (result.exitCode !== 0) {
        return { ok: false, error: buildError("INTERNAL", result.stderr || "send-keys failed") };
      }
      if (enter) {
        if (enterDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, enterDelayMs));
        }
        const enterResult = await adapter.run(["send-keys", "-t", paneId, enterKey]);
        if (enterResult.exitCode !== 0) {
          return {
            ok: false,
            error: buildError("INTERNAL", enterResult.stderr || "send-keys Enter failed"),
          };
        }
      }
      pendingCommands.delete(paneId);
      return { ok: true as const };
    }

    const result = await adapter.run(["send-keys", "-l", "-t", paneId, normalized]);
    if (result.exitCode !== 0) {
      return { ok: false, error: buildError("INTERNAL", result.stderr || "send-keys failed") };
    }
    if (enter) {
      if (enterDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, enterDelayMs));
      }
      const enterResult = await adapter.run(["send-keys", "-t", paneId, enterKey]);
      if (enterResult.exitCode !== 0) {
        return {
          ok: false,
          error: buildError("INTERNAL", enterResult.stderr || "send-keys Enter failed"),
        };
      }
      pendingCommands.delete(paneId);
      return { ok: true as const };
    }
    pendingCommands.set(paneId, combined);
    return { ok: true as const };
  };

  const sendKeys = async (paneId: string, keys: string[]) => {
    const allowed = new Set(allowedKeys);
    if (keys.length === 0 || keys.some((key) => !allowed.has(key as never))) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "invalid keys") };
    }
    if (keys.some((key) => dangerKeys.has(key))) {
      return { ok: false, error: buildError("DANGEROUS_COMMAND", "dangerous key blocked") };
    }
    for (const key of keys) {
      const result = await adapter.run(["send-keys", "-t", paneId, key]);
      if (result.exitCode !== 0) {
        return { ok: false, error: buildError("INTERNAL", result.stderr || "send-keys failed") };
      }
    }
    return { ok: true as const };
  };

  const sendRaw = async (paneId: string, items: RawItem[], unsafe = false) => {
    if (!items || items.length === 0) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "items are required") };
    }
    const allowed = new Set(allowedKeys);
    if (items.some((item) => item.kind === "key" && !allowed.has(item.value as never))) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "invalid keys") };
    }
    if (!unsafe && items.some((item) => item.kind === "key" && dangerKeys.has(item.value))) {
      return { ok: false, error: buildError("DANGEROUS_COMMAND", "dangerous key blocked") };
    }

    await adapter.run([
      "if-shell",
      "-t",
      paneId,
      '[ "#{pane_in_mode}" = "1" ]',
      `copy-mode -q -t ${paneId}`,
    ]);

    for (const item of items) {
      if (item.kind === "text") {
        const result = await sendRawText(paneId, item.value);
        if (!result.ok) return result;
        continue;
      }
      const result = await adapter.run(["send-keys", "-t", paneId, item.value]);
      if (result.exitCode !== 0) {
        return { ok: false, error: buildError("INTERNAL", result.stderr || "send-keys failed") };
      }
    }
    return { ok: true as const };
  };

  return { sendText, sendKeys, sendRaw };
};
