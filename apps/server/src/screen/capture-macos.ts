import { markPaneFocus } from "../activity-suppressor.js";
import { cropPaneBounds } from "./crop.js";
import { resolveBackendApp, type TerminalBackend } from "./macos-app.js";
import { focusTerminalApp, isAppRunning, runAppleScript } from "./macos-applescript.js";
import {
  type Bounds,
  type BoundsSet,
  buildTerminalBoundsScript,
  parseBoundsSet,
} from "./macos-bounds.js";
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
  return boundsRaw ? parseBoundsSet(boundsRaw) : { content: null, window: null };
};

const resolvePaneGeometryForCapture = async (options: CaptureOptions) => {
  if (options.cropPane === false || !options.paneId) {
    return null;
  }
  return getPaneGeometry(options.paneId, options.tmux);
};

const captureWithBounds = async (
  boundsSet: BoundsSet,
  options: CaptureOptions,
  allowWindowFallbackForCrop: boolean,
) => {
  const paneGeometry = await resolvePaneGeometryForCapture(options);
  const contentBounds = boundsSet.content;
  const windowBounds = boundsSet.window;

  if (paneGeometry) {
    if (contentBounds) {
      const croppedBounds = cropPaneBounds(contentBounds, paneGeometry);
      if (croppedBounds) {
        const imageBase64 = await captureRegion(croppedBounds);
        if (!imageBase64) {
          return null;
        }
        return { imageBase64, cropped: true };
      }
    } else if (!allowWindowFallbackForCrop) {
      return null;
    }
  }

  const targetBounds: Bounds | null = contentBounds ?? windowBounds;
  if (!targetBounds) {
    return null;
  }
  const imageBase64 = await captureRegion(targetBounds);
  if (!imageBase64) {
    return null;
  }
  return { imageBase64, cropped: false };
};

const captureAttempt = async (
  appName: string,
  options: CaptureOptions,
  allowWindowFallbackForCrop: boolean,
) => captureWithBounds(await readTerminalBounds(appName), options, allowWindowFallbackForCrop);

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
    const allowWindowFallbackForCrop = attempt === maxAttempts - 1;
    const captureResult = await captureAttempt(app.appName, options, allowWindowFallbackForCrop);
    if (captureResult) {
      return captureResult;
    }
    if (attempt < maxAttempts - 1) {
      await wait(200);
    }
  }
  return null;
};
