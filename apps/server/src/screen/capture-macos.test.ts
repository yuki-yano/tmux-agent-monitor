import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../activity-suppressor.js", () => ({
  markPaneFocus: vi.fn(),
}));

vi.mock("./crop.js", () => ({
  cropPaneBounds: vi.fn(),
}));

vi.mock("./macos-app.js", () => ({
  resolveBackendApp: vi.fn(),
}));

vi.mock("./macos-applescript.js", () => ({
  focusTerminalApp: vi.fn(),
  isAppRunning: vi.fn(),
  runAppleScript: vi.fn(),
}));

vi.mock("./macos-bounds.js", () => ({
  buildTerminalBoundsScript: vi.fn(),
  parseBoundsSet: vi.fn(),
}));

vi.mock("./macos-screencapture.js", () => ({
  captureRegion: vi.fn(),
}));

vi.mock("./tmux-geometry.js", () => ({
  focusTmuxPane: vi.fn(),
  getPaneGeometry: vi.fn(),
}));

vi.mock("./tty.js", () => ({
  isValidTty: vi.fn(),
}));

import { markPaneFocus } from "../activity-suppressor.js";
import { captureTerminalScreenMacos } from "./capture-macos.js";
import { cropPaneBounds } from "./crop.js";
import { resolveBackendApp } from "./macos-app.js";
import { focusTerminalApp, isAppRunning, runAppleScript } from "./macos-applescript.js";
import { buildTerminalBoundsScript, parseBoundsSet } from "./macos-bounds.js";
import { captureRegion } from "./macos-screencapture.js";
import { focusTmuxPane, getPaneGeometry } from "./tmux-geometry.js";
import { isValidTty } from "./tty.js";

const baseBounds = { x: 0, y: 0, width: 200, height: 100 };
const croppedBounds = { x: 12, y: 8, width: 100, height: 50 };
const paneGeometry = {
  left: 10,
  top: 6,
  width: 80,
  height: 40,
  windowWidth: 160,
  windowHeight: 80,
};

const settleCapture = async <T>(promise: Promise<T>) => {
  await vi.runAllTimersAsync();
  return promise;
};

describe("captureTerminalScreenMacos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(isValidTty).mockReturnValue(true);
    vi.mocked(resolveBackendApp).mockReturnValue({
      key: "terminal",
      appName: "Terminal",
    });
    vi.mocked(isAppRunning).mockResolvedValue(true);
    vi.mocked(focusTerminalApp).mockResolvedValue(undefined);
    vi.mocked(focusTmuxPane).mockResolvedValue(undefined);
    vi.mocked(buildTerminalBoundsScript).mockReturnValue("SCRIPT");
    vi.mocked(runAppleScript).mockResolvedValue("raw");
    vi.mocked(parseBoundsSet).mockReturnValue({
      content: baseBounds,
      window: null,
    });
    vi.mocked(getPaneGeometry).mockResolvedValue(paneGeometry);
    vi.mocked(cropPaneBounds).mockReturnValue(croppedBounds);
    vi.mocked(captureRegion).mockResolvedValue("image-data");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when tty is invalid", async () => {
    vi.mocked(isValidTty).mockReturnValue(false);

    const result = await captureTerminalScreenMacos("not-a-tty");

    expect(result).toBeNull();
    expect(resolveBackendApp).not.toHaveBeenCalled();
  });

  it("captures a cropped image when paneId is provided", async () => {
    const capturePromise = captureTerminalScreenMacos("/dev/ttys001", {
      paneId: "%1",
      tmux: { socketName: "sock" },
    });

    const result = await settleCapture(capturePromise);

    expect(result).toEqual({ imageBase64: "image-data", cropped: true });
    expect(markPaneFocus).toHaveBeenCalledWith("%1");
    expect(focusTmuxPane).toHaveBeenCalledWith("%1", { socketName: "sock" });
    expect(runAppleScript).toHaveBeenCalledWith("SCRIPT");
    expect(getPaneGeometry).toHaveBeenCalledWith("%1", { socketName: "sock" });
    expect(captureRegion).toHaveBeenCalledWith(croppedBounds);
  });

  it("falls back to uncropped window capture when content bounds are unavailable", async () => {
    vi.mocked(parseBoundsSet).mockReturnValue({
      content: null,
      window: baseBounds,
    });

    const capturePromise = captureTerminalScreenMacos("/dev/ttys001", {
      paneId: "%1",
    });
    const result = await settleCapture(capturePromise);

    expect(result).toEqual({ imageBase64: "image-data", cropped: false });
    expect(runAppleScript).toHaveBeenCalledTimes(3);
    expect(cropPaneBounds).not.toHaveBeenCalled();
    expect(captureRegion).toHaveBeenCalledTimes(1);
    expect(captureRegion).toHaveBeenCalledWith(baseBounds);
  });

  it("retries capture until image is available", async () => {
    vi.mocked(captureRegion).mockResolvedValueOnce(null).mockResolvedValueOnce("image-after-retry");

    const capturePromise = captureTerminalScreenMacos("/dev/ttys001");
    const result = await settleCapture(capturePromise);

    expect(result).toEqual({ imageBase64: "image-after-retry", cropped: false });
    expect(captureRegion).toHaveBeenCalledTimes(2);
    expect(getPaneGeometry).not.toHaveBeenCalled();
  });
});
