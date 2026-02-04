import path from "node:path";

export type AgentType = "codex" | "claude" | "unknown";

const agentHintPattern = /codex|claude/i;
const editorCommandNames = new Set(["vim", "nvim", "vi", "gvim", "nvim-qt", "neovim"]);
const shellCommandNames = new Set(["bash", "zsh", "fish"]);

export const buildAgent = (hint: string): AgentType => {
  const normalized = hint.toLowerCase();
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  return "unknown";
};

export const mergeHints = (...parts: Array<string | null | undefined>) =>
  parts.filter((part) => Boolean(part && part.trim().length > 0)).join(" ");

export const isEditorCommand = (command: string | null | undefined) => {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const binary = trimmed.split(/\s+/)[0] ?? "";
  if (!binary) return false;
  return editorCommandNames.has(path.basename(binary));
};

export const editorCommandHasAgentArg = (command: string | null | undefined) => {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  const binary = tokens.shift() ?? "";
  if (!editorCommandNames.has(path.basename(binary))) {
    return false;
  }
  const rest = tokens.join(" ");
  return rest.length > 0 && agentHintPattern.test(rest);
};

export const isShellCommand = (command: string | null | undefined) => {
  if (!command) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  const token = trimmed.split(/\s+/)[0] ?? "";
  if (!token) return false;
  const binary = path.basename(token).replace(/^-+/, "");
  return shellCommandNames.has(binary);
};

export const hasAgentHint = (value: string | null | undefined) =>
  Boolean(value && agentHintPattern.test(value));

export const normalizeTty = (tty: string) => tty.replace(/^\/dev\//, "");
