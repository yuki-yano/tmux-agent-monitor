import type { CaptureOptions } from "./capture-macos.js";
import { captureTerminalScreenMacos } from "./capture-macos.js";

export type { CaptureOptions } from "./capture-macos.js";

const isMacOSPlatform = (platform: NodeJS.Platform) => platform === "darwin";

export const captureTerminalScreen = async (
  tty: string | null | undefined,
  options: CaptureOptions = {},
  platform: NodeJS.Platform = process.platform,
) => {
  if (!isMacOSPlatform(platform)) {
    return null;
  }
  return captureTerminalScreenMacos(tty, options);
};
