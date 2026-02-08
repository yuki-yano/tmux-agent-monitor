import path from "node:path";

export const encodePaneId = (paneId: string): string => {
  return encodeURIComponent(paneId);
};

export const decodePaneId = (paneIdEncoded: string): string => {
  try {
    const decoded = decodeURIComponent(paneIdEncoded);
    for (let i = 0; i < decoded.length; i += 1) {
      const code = decoded.charCodeAt(i);
      if (code < 32 || code === 127) {
        return paneIdEncoded;
      }
    }
    return decoded;
  } catch {
    return paneIdEncoded;
  }
};

export const sanitizeServerKey = (value: string): string => {
  const withUnderscore = value.replace(/\//g, "_");
  return withUnderscore.replace(/[^a-zA-Z0-9_-]/g, "-");
};

export const resolveServerKey = (socketName: string | null, socketPath: string | null): string => {
  if (socketName && socketName.trim().length > 0) {
    return sanitizeServerKey(socketName);
  }
  if (socketPath && socketPath.trim().length > 0) {
    return sanitizeServerKey(socketPath);
  }
  return "default";
};

export const normalizeWeztermTarget = (value: string | null | undefined): string => {
  if (value == null) {
    return "auto";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "auto") {
    return "auto";
  }
  return trimmed;
};

export const resolveWeztermServerKey = (target: string | null | undefined): string =>
  sanitizeServerKey(`wezterm:${normalizeWeztermTarget(target)}`);

type MonitorServerKeyParams = {
  multiplexerBackend: "tmux" | "wezterm";
  tmuxSocketName: string | null;
  tmuxSocketPath: string | null;
  weztermTarget: string | null | undefined;
};

export const resolveMonitorServerKey = ({
  multiplexerBackend,
  tmuxSocketName,
  tmuxSocketPath,
  weztermTarget,
}: MonitorServerKeyParams): string => {
  if (multiplexerBackend === "wezterm") {
    return resolveWeztermServerKey(weztermTarget);
  }
  return resolveServerKey(tmuxSocketName, tmuxSocketPath);
};

export const resolveLogPaths = (baseDir: string, serverKey: string, paneId: string) => {
  const paneIdEncoded = encodePaneId(paneId);
  const panesDir = path.join(baseDir, "panes", serverKey);
  const eventsDir = path.join(baseDir, "events", serverKey);
  return {
    paneIdEncoded,
    panesDir,
    eventsDir,
    paneLogPath: path.join(panesDir, `${paneIdEncoded}.log`),
    eventLogPath: path.join(eventsDir, "claude.jsonl"),
  };
};
