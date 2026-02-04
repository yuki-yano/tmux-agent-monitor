import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { execa } from "execa";

const runCommand = (command: string, args: string[], timeout?: number) =>
  execa(command, args, timeout ? { timeout } : undefined);

export const captureRegion = async (bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => {
  const tempPath = `/tmp/vde-monitor-${randomUUID()}.png`;
  const region = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  try {
    await runCommand("screencapture", ["-R", region, "-x", tempPath], 10000);
    const data = await fs.readFile(tempPath);
    await fs.unlink(tempPath).catch(() => null);
    return data.toString("base64");
  } catch {
    await fs.unlink(tempPath).catch(() => null);
    return null;
  }
};
