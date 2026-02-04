import { markPaneFocus } from "../activity-suppressor.js";
import { cropPaneBounds } from "./crop.js";
import { resolveBackendApp, type TerminalBackend } from "./macos-app.js";
import { focusTerminalApp, isAppRunning, runAppleScript } from "./macos-applescript.js";
import { buildTerminalBoundsScript, parseBoundsSet } from "./macos-bounds.js";
import { captureRegion } from "./macos-screencapture.js";
import { focusTmuxPane, getPaneGeometry, type TmuxOptions } from "./tmux-geometry.js";
import { isValidTty } from "./tty.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type CaptureOptions = {
  paneId?: string;
  tmux?: TmuxOptions;
  cropPane?: boolean;
  backend?: TerminalBackend;
};

export const captureTerminalScreenMacos = async (
  tty: string | null | undefined,
  options: CaptureOptions = {},
) => {
  if (tty && !isValidTty(tty)) {
    return null;
  }
  const backend = options.backend ?? "terminal";
  const app = resolveBackendApp(backend);
  if (!app) {
    return null;
  }
  if (!(await isAppRunning(app.appName))) {
    return null;
  }
  await focusTerminalApp(app.appName);
  await wait(200);
  if (options.paneId) {
    markPaneFocus(options.paneId);
    await focusTmuxPane(options.paneId, options.tmux);
    await wait(200);
  }

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const boundsRaw = await runAppleScript(buildTerminalBoundsScript(app.appName));
    const boundsSet = boundsRaw ? parseBoundsSet(boundsRaw) : { content: null, window: null };
    const bounds = boundsSet.content ?? boundsSet.window;
    const paneGeometry =
      options.cropPane !== false && options.paneId
        ? await getPaneGeometry(options.paneId, options.tmux)
        : null;
    if (bounds) {
      const croppedBounds = paneGeometry ? cropPaneBounds(bounds, paneGeometry) : null;
      const targetBounds = croppedBounds ?? bounds;
      const imageBase64 = await captureRegion(targetBounds);
      if (imageBase64) {
        return { imageBase64, cropped: Boolean(croppedBounds) };
      }
    }
    if (attempt < maxAttempts - 1) {
      await wait(200);
    }
  }
  return null;
};
