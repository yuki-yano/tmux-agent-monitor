import { markPaneFocus } from "../activity-suppressor";
import { cropPaneBounds } from "./crop";
import { resolveBackendApp, type TerminalBackend } from "./macos-app";
import { focusTerminalApp, isAppRunning, runAppleScript } from "./macos-applescript";
import {
  type Bounds,
  type BoundsSet,
  buildTerminalBoundsScript,
  parseBoundsSet,
} from "./macos-bounds";
import { captureRegion } from "./macos-screencapture";
import { focusTmuxPane, getPaneGeometry, type TmuxOptions } from "./tmux-geometry";
import { isValidTty } from "./tty";
import { focusWeztermPane, getWeztermPaneGeometry, type WeztermOptions } from "./wezterm-geometry";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const debugWeztermCropEnabled = process.env.VDE_MONITOR_DEBUG_WEZTERM_CROP === "1";
const debugWeztermCrop = (payload: Record<string, unknown>) => {
  if (!debugWeztermCropEnabled) {
    return;
  }
  try {
    console.log(`[wezterm-crop] ${JSON.stringify(payload)}`);
  } catch {
    // ignore debug log failures
  }
};

export type CaptureOptions = {
  paneId?: string;
  tmux?: TmuxOptions;
  wezterm?: WeztermOptions;
  multiplexerBackend?: "tmux" | "wezterm";
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
  if (options.multiplexerBackend === "wezterm") {
    if (options.paneId) {
      markPaneFocus(options.paneId);
      await focusWeztermPane(options.paneId, options.wezterm);
      await wait(120);
    }
    await focusTerminalApp(appName);
    await wait(200);
    return;
  }

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
  if (options.multiplexerBackend === "wezterm") {
    return getWeztermPaneGeometry(options.paneId, options.wezterm);
  }
  return getPaneGeometry(options.paneId, options.tmux);
};

const isWeztermContentAlreadyFocusedPane = (
  options: CaptureOptions,
  contentBounds: Bounds,
  paneGeometry: Awaited<ReturnType<typeof resolvePaneGeometryForCapture>>,
) => {
  if (options.multiplexerBackend !== "wezterm" || !paneGeometry) {
    return false;
  }
  const panePixelWidth = paneGeometry.panePixelWidth;
  const panePixelHeight = paneGeometry.panePixelHeight;
  if (
    typeof panePixelWidth !== "number" ||
    typeof panePixelHeight !== "number" ||
    panePixelWidth <= 0 ||
    panePixelHeight <= 0
  ) {
    return false;
  }
  const tolerance = 16;
  return (
    Math.abs(contentBounds.width - panePixelWidth) <= tolerance &&
    Math.abs(contentBounds.height - panePixelHeight) <= tolerance
  );
};

const normalizeWeztermContentBounds = (
  options: CaptureOptions,
  contentBounds: Bounds,
  paneGeometry: Awaited<ReturnType<typeof resolvePaneGeometryForCapture>>,
): Bounds => {
  if (options.multiplexerBackend !== "wezterm" || !paneGeometry) {
    return contentBounds;
  }
  const panePixelWidth = paneGeometry.panePixelWidth;
  const panePixelHeight = paneGeometry.panePixelHeight;
  if (
    typeof panePixelWidth !== "number" ||
    typeof panePixelHeight !== "number" ||
    panePixelWidth <= 0 ||
    panePixelHeight <= 0 ||
    paneGeometry.width <= 0 ||
    paneGeometry.height <= 0 ||
    paneGeometry.windowWidth <= 0 ||
    paneGeometry.windowHeight <= 0
  ) {
    return contentBounds;
  }
  const cellWidth = panePixelWidth / paneGeometry.width;
  const cellHeight = panePixelHeight / paneGeometry.height;
  if (
    !Number.isFinite(cellWidth) ||
    !Number.isFinite(cellHeight) ||
    cellWidth <= 0 ||
    cellHeight <= 0
  ) {
    return contentBounds;
  }
  const expectedWindowWidth = Math.round(cellWidth * paneGeometry.windowWidth);
  const expectedWindowHeight = Math.round(cellHeight * paneGeometry.windowHeight);
  if (
    expectedWindowWidth <= 0 ||
    expectedWindowHeight <= 0 ||
    expectedWindowWidth > contentBounds.width ||
    expectedWindowHeight > contentBounds.height
  ) {
    return contentBounds;
  }
  const insetX = contentBounds.width - expectedWindowWidth;
  const insetY = contentBounds.height - expectedWindowHeight;
  const maxInset = 96;
  if (insetX < 0 || insetY < 0 || insetX > maxInset || insetY > maxInset) {
    return contentBounds;
  }
  if (insetX === 0 && insetY === 0) {
    return contentBounds;
  }
  return {
    x: contentBounds.x + Math.round(insetX / 2),
    y: contentBounds.y + Math.round(insetY / 2),
    width: expectedWindowWidth,
    height: expectedWindowHeight,
  };
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
      debugWeztermCrop({
        stage: "capture-start",
        paneId: options.paneId ?? null,
        backend: options.multiplexerBackend ?? null,
        contentBounds,
        windowBounds,
        paneGeometry,
      });
      if (isWeztermContentAlreadyFocusedPane(options, contentBounds, paneGeometry)) {
        const imageBase64 = await captureRegion(contentBounds);
        if (!imageBase64 && !allowWindowFallbackForCrop) {
          return null;
        }
        if (imageBase64) {
          return { imageBase64, cropped: true };
        }
      }
      const cropBaseBounds = normalizeWeztermContentBounds(options, contentBounds, paneGeometry);
      const croppedBounds = cropPaneBounds(cropBaseBounds, paneGeometry);
      debugWeztermCrop({
        stage: "crop-calc",
        paneId: options.paneId ?? null,
        backend: options.multiplexerBackend ?? null,
        cropBaseBounds,
        croppedBounds,
      });
      if (croppedBounds) {
        const imageBase64 = await captureRegion(croppedBounds);
        if (!imageBase64 && !allowWindowFallbackForCrop) {
          return null;
        }
        if (imageBase64) {
          return { imageBase64, cropped: true };
        }
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
    if (attempt > 0) {
      await focusCaptureTarget(app.appName, options);
    }
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
