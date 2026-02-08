import fs from "node:fs/promises";
import path from "node:path";

export const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
};

export const rotateLogIfNeeded = async (
  filePath: string,
  maxBytes: number,
  retainRotations: number,
) => {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size <= maxBytes) {
    return;
  }

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const rotatedPath = path.join(dir, `${base}.${Date.now()}`);
  const data = await fs.readFile(filePath);
  await fs.writeFile(rotatedPath, data);
  await fs.truncate(filePath, 0);

  const files = await fs.readdir(dir);
  const rotations = files
    .filter((name) => name.startsWith(`${base}.`))
    .map((name) => ({ name, fullPath: path.join(dir, name) }));
  if (rotations.length > retainRotations) {
    const sorted = rotations.sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = sorted.slice(0, rotations.length - retainRotations);
    await Promise.all(toDelete.map((entry) => fs.unlink(entry.fullPath).catch(() => null)));
  }
};

export const createLogActivityPoller = (pollIntervalMs: number) => {
  const entries = new Map<string, { paneId: string; size: number }>();
  const listeners = new Set<(paneId: string, at: string) => void>();
  let timer: NodeJS.Timeout | null = null;
  let pollRunning = false;

  const register = (paneId: string, filePath: string) => {
    Array.from(entries.entries()).forEach(([entryPath, entry]) => {
      if (entryPath !== filePath && entry.paneId === paneId) {
        entries.delete(entryPath);
      }
    });
    const existing = entries.get(filePath);
    if (existing) {
      existing.paneId = paneId;
      return;
    }
    entries.set(filePath, { paneId, size: 0 });
  };

  const unregister = (paneId: string) => {
    Array.from(entries.entries()).forEach(([filePath, entry]) => {
      if (entry.paneId === paneId) {
        entries.delete(filePath);
      }
    });
  };

  const onActivity = (listener: (paneId: string, at: string) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const start = () => {
    if (timer) {
      return;
    }
    const poll = async () => {
      if (pollRunning) {
        return;
      }
      pollRunning = true;
      try {
        await Promise.all(
          Array.from(entries.entries()).map(async ([filePath, entry]) => {
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat) {
              return;
            }
            if (stat.size < entry.size) {
              entry.size = stat.size;
              return;
            }
            if (stat.size > entry.size) {
              entry.size = stat.size;
              const at = new Date().toISOString();
              listeners.forEach((listener) => listener(entry.paneId, at));
            }
          }),
        );
      } finally {
        pollRunning = false;
      }
    };
    timer = setInterval(() => {
      void poll().catch(() => null);
    }, pollIntervalMs);
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { register, unregister, onActivity, start, stop };
};

export const createJsonlTailer = (pollIntervalMs: number) => {
  let offset = 0;
  let buffer = "";
  let timer: NodeJS.Timeout | null = null;
  let pollRunning = false;
  const listeners = new Set<(line: string) => void>();

  const onLine = (listener: (line: string) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const start = (filePath: string) => {
    if (timer) {
      return;
    }
    const poll = async () => {
      if (pollRunning) {
        return;
      }
      pollRunning = true;
      try {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat) {
          return;
        }
        if (stat.size < offset) {
          offset = 0;
          buffer = "";
        }
        if (stat.size === offset) {
          return;
        }
        const fd = await fs.open(filePath, "r");
        const length = stat.size - offset;
        const chunk = Buffer.alloc(length);
        await fd.read(chunk, 0, length, offset);
        await fd.close();
        offset = stat.size;
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach((line) => {
          if (line.trim().length === 0) {
            return;
          }
          listeners.forEach((listener) => listener(line));
        });
      } finally {
        pollRunning = false;
      }
    };
    timer = setInterval(() => {
      void poll().catch(() => null);
    }, pollIntervalMs);
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { onLine, start, stop };
};
