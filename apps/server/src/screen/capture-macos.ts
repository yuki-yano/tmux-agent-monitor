import { markPaneFocus } from "../activity-suppressor.js";
import { cropPaneBounds } from "./crop.js";
import { resolveBackendApp, type TerminalBackend } from "./macos-app.js";
import { focusTerminalApp, isAppRunning, runAppleScript } from "./macos-applescript.js";
import { type Bounds, buildTerminalBoundsScript, parseBoundsSet } from "./macos-bounds.js";
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

const resolveCaptureApp = async (tty: string | null | undefined, options: CaptureOptions) => {
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
  return app;
};

const focusCaptureTarget = async (appName: string, options: CaptureOptions) => {
  await focusTerminalApp(appName);
  await wait(200);
  if (!options.paneId) {
    return;
  }
  markPaneFocus(options.paneId);
  await focusTmuxPane(options.paneId, options.tmux);
  await wait(200);
};

const readTerminalBounds = async (appName: string) => {
  const boundsRaw = await runAppleScript(buildTerminalBoundsScript(appName));
  const boundsSet = boundsRaw ? parseBoundsSet(boundsRaw) : { content: null, window: null };
  return boundsSet.content ?? boundsSet.window;
};

const resolvePaneGeometryForCapture = async (options: CaptureOptions) => {
  if (options.cropPane === false || !options.paneId) {
    return null;
  }
  return getPaneGeometry(options.paneId, options.tmux);
};

const captureWithBounds = async (bounds: Bounds, options: CaptureOptions) => {
  const paneGeometry = await resolvePaneGeometryForCapture(options);
  const croppedBounds = paneGeometry ? cropPaneBounds(bounds, paneGeometry) : null;
  const targetBounds = croppedBounds ?? bounds;
  const imageBase64 = await captureRegion(targetBounds);
  if (!imageBase64) {
    return null;
  }
  return { imageBase64, cropped: Boolean(croppedBounds) };
};

const captureAttempt = async (appName: string, options: CaptureOptions) => {
  const bounds = await readTerminalBounds(appName);
  if (!bounds) {
    return null;
  }
  return captureWithBounds(bounds, options);
};

export const captureTerminalScreenMacos = async (
  tty: string | null | undefined,
  options: CaptureOptions = {},
) => {
  const app = await resolveCaptureApp(tty, options);
  if (!app) {
    return null;
  }
  await focusCaptureTarget(app.appName, options);

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const captureResult = await captureAttempt(app.appName, options);
    if (captureResult) {
      return captureResult;
    }
    if (attempt < maxAttempts - 1) {
      await wait(200);
    }
  }
  return null;
};
