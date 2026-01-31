import path from "node:path";

export const encodePaneId = (paneId: string): string => {
  return encodeURIComponent(paneId);
};

export const decodePaneId = (paneIdEncoded: string): string => {
  try {
    const decoded = decodeURIComponent(paneIdEncoded);
    if (/[\x00-\x1F\x7F]/.test(decoded)) {
      return paneIdEncoded;
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
