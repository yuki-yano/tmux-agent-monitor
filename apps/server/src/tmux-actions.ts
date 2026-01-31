import {
  type AgentMonitorConfig,
  type ApiError,
  compileDangerPatterns,
  isDangerousCommand,
} from "@tmux-agent-monitor/shared";
import { allowedKeys } from "@tmux-agent-monitor/shared";
import type { TmuxAdapter } from "@tmux-agent-monitor/tmux";

const buildError = (code: ApiError["code"], message: string): ApiError => ({
  code,
  message,
});

export const createTmuxActions = (adapter: TmuxAdapter, config: AgentMonitorConfig) => {
  const dangerPatterns = compileDangerPatterns(config.dangerCommandPatterns);
  const enterKey = config.input.enterKey || "C-m";
  const enterDelayMs = config.input.enterDelayMs ?? 0;
  const bracketedPaste = (value: string) => `\u001b[200~${value}\u001b[201~`;

  const sendText = async (paneId: string, text: string, enter = true) => {
    if (!text || text.trim().length === 0) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "text is required") };
    }
    if (text.length > config.input.maxTextLength) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "text too long") };
    }
    if (isDangerousCommand(text, dangerPatterns)) {
      return { ok: false, error: buildError("DANGEROUS_COMMAND", "dangerous command blocked") };
    }

    await adapter.run([
      "if-shell",
      "-t",
      paneId,
      '[ "#{pane_in_mode}" = "1" ]',
      `copy-mode -q -t ${paneId}`,
    ]);

    const normalized = text.replace(/\r\n/g, "\n");
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
    }
    return { ok: true as const };
  };

  const sendKeys = async (paneId: string, keys: string[]) => {
    const allowed = new Set(allowedKeys);
    if (keys.length === 0 || keys.some((key) => !allowed.has(key as never))) {
      return { ok: false, error: buildError("INVALID_PAYLOAD", "invalid keys") };
    }
    for (const key of keys) {
      const result = await adapter.run(["send-keys", "-t", paneId, key]);
      if (result.exitCode !== 0) {
        return { ok: false, error: buildError("INTERNAL", result.stderr || "send-keys failed") };
      }
    }
    return { ok: true as const };
  };

  return { sendText, sendKeys };
};
