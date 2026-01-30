import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const isMacOS = () => process.platform === "darwin";

const TTY_PATH_PATTERN = /^\/dev\/(ttys?\d+|pts\/\d+)$/;

const isValidTty = (tty: string) => TTY_PATH_PATTERN.test(tty);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseBounds = (input: string) => {
  const parts = input
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => !Number.isNaN(value));
  if (parts.length !== 4) {
    return null;
  }
  const [x, y, width, height] = parts;
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return null;
  }
  return { x, y, width, height };
};

const runAppleScript = async (script: string) => {
  try {
    const result = await execFileAsync("osascript", ["-e", script], { encoding: "utf8" });
    return (result.stdout ?? "").trim();
  } catch {
    return "";
  }
};

const buildTerminalBoundsScript = (appName: string) => `
tell application "System Events"
  if not (exists process "${appName}") then return ""
  tell process "${appName}"
    try
      set pos to position of front window
      set sz to size of front window
      set contentPos to pos
      set contentSize to sz
      try
        set scrollArea to first UI element of front window whose role is "AXScrollArea"
        set contentPos to position of scrollArea
        set contentSize to size of scrollArea
      end try
      return (item 1 of contentPos as text) & ", " & (item 2 of contentPos as text) & ", " & (item 1 of contentSize as text) & ", " & (item 2 of contentSize as text) & "|" & (item 1 of pos as text) & ", " & (item 2 of pos as text) & ", " & (item 1 of sz as text) & ", " & (item 2 of sz as text)
    end try
  end tell
end tell
return ""
`;

const focusTerminalApp = async (appName: string) => {
  await runAppleScript(`tell application "${appName}" to activate`);
};

const captureRegion = async (bounds: { x: number; y: number; width: number; height: number }) => {
  const tempPath = `/tmp/agent-monitor-${randomUUID()}.png`;
  const region = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  try {
    await execFileAsync("screencapture", ["-R", region, "-x", tempPath], { timeout: 10000 });
    const data = await fs.readFile(tempPath);
    await fs.unlink(tempPath).catch(() => null);
    return data.toString("base64");
  } catch {
    await fs.unlink(tempPath).catch(() => null);
    return null;
  }
};

type TmuxOptions = {
  socketName?: string | null;
  socketPath?: string | null;
  primaryClient?: string | null;
};

type PaneGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
};

type CaptureOptions = {
  paneId?: string;
  tmux?: TmuxOptions;
  cropPane?: boolean;
  backend?: "auto" | "alacritty" | "terminal" | "iterm" | "wezterm" | "ghostty";
};

const parsePaneGeometry = (input: string): PaneGeometry | null => {
  const parts = input
    .trim()
    .split("\t")
    .map((value) => Number.parseInt(value.trim(), 10));
  if (parts.length !== 6 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }
  const [left, top, width, height, windowWidth, windowHeight] = parts;
  if (
    left === undefined ||
    top === undefined ||
    width === undefined ||
    height === undefined ||
    windowWidth === undefined ||
    windowHeight === undefined
  ) {
    return null;
  }
  return { left, top, width, height, windowWidth, windowHeight };
};

const buildTmuxArgs = (args: string[], options?: TmuxOptions) => {
  const prefix: string[] = [];
  if (options?.socketName) {
    prefix.push("-L", options.socketName);
  }
  if (options?.socketPath) {
    prefix.push("-S", options.socketPath);
  }
  return [...prefix, ...args];
};

const getPaneSession = async (paneId: string, options?: TmuxOptions) => {
  try {
    const result = await execFileAsync(
      "tmux",
      buildTmuxArgs(["display-message", "-p", "-t", paneId, "-F", "#{session_name}"], options),
      { encoding: "utf8", timeout: 2000 },
    );
    const name = (result.stdout ?? "").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
};

const focusTmuxPane = async (paneId: string, options?: TmuxOptions) => {
  if (!paneId) {
    return;
  }
  if (options?.primaryClient) {
    await execFileAsync(
      "tmux",
      buildTmuxArgs(["switch-client", "-t", options.primaryClient], options),
      {
        encoding: "utf8",
        timeout: 2000,
      },
    ).catch(() => null);
  }
  const sessionName = await getPaneSession(paneId, options);
  if (sessionName) {
    await execFileAsync("tmux", buildTmuxArgs(["switch-client", "-t", sessionName], options), {
      encoding: "utf8",
      timeout: 2000,
    }).catch(() => null);
  }
  await execFileAsync("tmux", buildTmuxArgs(["select-window", "-t", paneId], options), {
    encoding: "utf8",
    timeout: 2000,
  }).catch(() => null);
  await execFileAsync("tmux", buildTmuxArgs(["select-pane", "-t", paneId], options), {
    encoding: "utf8",
    timeout: 2000,
  }).catch(() => null);
};

const getPaneGeometry = async (paneId: string, options?: TmuxOptions) => {
  try {
    const format = [
      "#{pane_left}",
      "#{pane_top}",
      "#{pane_width}",
      "#{pane_height}",
      "#{window_width}",
      "#{window_height}",
    ].join("\t");
    const result = await execFileAsync(
      "tmux",
      buildTmuxArgs(["display-message", "-p", "-t", paneId, "-F", format], options),
      { encoding: "utf8", timeout: 2000 },
    );
    return parsePaneGeometry(result.stdout ?? "");
  } catch {
    return null;
  }
};

const parseBoundsSet = (input: string) => {
  const [contentRaw, windowRaw] = input.split("|").map((part) => part.trim());
  const content = contentRaw ? parseBounds(contentRaw) : null;
  const window = windowRaw ? parseBounds(windowRaw) : null;
  return { content, window: window ?? content };
};

const cropPaneBounds = (
  base: { x: number; y: number; width: number; height: number },
  geometry: PaneGeometry,
) => {
  if (geometry.windowWidth <= 0 || geometry.windowHeight <= 0) {
    return null;
  }
  const cellWidth = base.width / geometry.windowWidth;
  const cellHeight = base.height / geometry.windowHeight;
  const x = Math.round(base.x + geometry.left * cellWidth);
  const y = Math.round(base.y + geometry.top * cellHeight);
  const width = Math.round(geometry.width * cellWidth);
  const height = Math.round(geometry.height * cellHeight);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};

export const captureTerminalScreen = async (tty: string, options: CaptureOptions = {}) => {
  if (!isMacOS() || !isValidTty(tty)) {
    return null;
  }
  const backend = options.backend ?? "auto";
  const candidates = [
    { key: "alacritty", appName: "Alacritty" },
    { key: "terminal", appName: "Terminal" },
    { key: "iterm", appName: "iTerm2" },
    { key: "wezterm", appName: "WezTerm" },
    { key: "ghostty", appName: "Ghostty" },
  ] as const;

  const getFrontmostApp = async () => {
    const result = await runAppleScript(
      'tell application "System Events" to get name of first application process whose frontmost is true',
    );
    return result.trim();
  };

  const isRunning = async (appName: string) => {
    const result = await runAppleScript(
      `tell application "System Events" to (exists process "${appName}")`,
    );
    return result.trim() === "true";
  };

  const resolveApp = async () => {
    if (backend !== "auto") {
      return candidates.find((candidate) => candidate.key === backend) ?? null;
    }
    const frontmost = await getFrontmostApp();
    const frontCandidate = candidates.find((candidate) => candidate.appName === frontmost);
    if (frontCandidate) {
      return frontCandidate;
    }
    const running = [];
    for (const candidate of candidates) {
      if (await isRunning(candidate.appName)) {
        running.push(candidate);
      }
    }
    if (running.length === 1) {
      return running[0] ?? null;
    }
    return running[0] ?? null;
  };

  const app = await resolveApp();
  if (!app) {
    return null;
  }
  await focusTerminalApp(app.appName);
  await wait(150);
  if (options.paneId) {
    await focusTmuxPane(options.paneId, options.tmux);
    await wait(120);
  }

  const boundsRaw = await runAppleScript(buildTerminalBoundsScript(app.appName));
  const boundsSet = boundsRaw ? parseBoundsSet(boundsRaw) : { content: null, window: null };
  const bounds = boundsSet.content ?? boundsSet.window;
  const paneGeometry =
    options.cropPane !== false && options.paneId
      ? await getPaneGeometry(options.paneId, options.tmux)
      : null;
  if (!bounds) {
    return null;
  }
  const croppedBounds = paneGeometry ? cropPaneBounds(bounds, paneGeometry) : null;
  const targetBounds = croppedBounds ?? bounds;
  const imageBase64 = await captureRegion(targetBounds);
  if (!imageBase64) {
    return null;
  }
  return { imageBase64, cropped: Boolean(croppedBounds) };
};
