import os from "node:os";

import type { SessionStateValue } from "@vde-monitor/shared";

const fingerprintLineCount = 20;

export const normalizeFingerprint = (text: string, maxLines = fingerprintLineCount) => {
  const normalized = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trimEnd();
  if (maxLines <= 0) {
    return normalized;
  }
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) {
    return normalized;
  }
  return lines.slice(-maxLines).join("\n");
};

export const normalizeTitle = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildDefaultTitle = (
  currentPath: string | null,
  paneId: string,
  sessionName: string,
) => {
  if (!currentPath) {
    return `${sessionName}:${paneId}`;
  }
  const normalized = currentPath.replace(/\/+$/, "");
  const parts = normalized.split("/");
  const name = parts.pop() || "unknown";
  return `${name}:${paneId}`;
};

export const hostCandidates = (() => {
  const host = os.hostname();
  const short = host.split(".")[0] ?? host;
  return new Set([host, short, `${host}.local`, `${short}.local`]);
})();

export const deriveHookState = (hookEventName: string, notificationType?: string) => {
  if (hookEventName === "Notification" && notificationType === "permission_prompt") {
    return { state: "WAITING_PERMISSION" as SessionStateValue, reason: "hook:permission_prompt" };
  }
  if (hookEventName === "Stop") {
    return { state: "WAITING_INPUT" as SessionStateValue, reason: "hook:stop" };
  }
  if (
    hookEventName === "UserPromptSubmit" ||
    hookEventName === "PreToolUse" ||
    hookEventName === "PostToolUse"
  ) {
    return { state: "RUNNING" as SessionStateValue, reason: `hook:${hookEventName}` };
  }
  return null;
};

export const mapHookToPane = (
  panes: Array<{ paneId: string; paneTty: string | null; currentPath: string | null }>,
  hook: { tmux_pane?: string | null; tty?: string; cwd?: string },
) => {
  if (hook.tmux_pane) {
    return hook.tmux_pane;
  }
  if (hook.tty) {
    const matches = panes.filter((pane) => pane.paneTty === hook.tty);
    if (matches.length === 1) {
      return matches[0]?.paneId ?? null;
    }
    return null;
  }
  if (hook.cwd) {
    const matches = panes.filter((pane) => pane.currentPath === hook.cwd);
    if (matches.length === 1) {
      return matches[0]?.paneId ?? null;
    }
  }
  return null;
};
