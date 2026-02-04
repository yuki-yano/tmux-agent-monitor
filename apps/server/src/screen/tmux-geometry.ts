import { execa } from "execa";

export type TmuxOptions = {
  socketName?: string | null;
  socketPath?: string | null;
  primaryClient?: string | null;
};

export type PaneGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
};

const runCommand = (command: string, args: string[], timeout?: number) =>
  execa(command, args, timeout ? { timeout } : undefined);

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
    const result = await runCommand(
      "tmux",
      buildTmuxArgs(["display-message", "-p", "-t", paneId, "-F", "#{session_name}"], options),
      2000,
    );
    const name = (result.stdout ?? "").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
};

export const focusTmuxPane = async (paneId: string, options?: TmuxOptions) => {
  if (!paneId) {
    return;
  }
  if (options?.primaryClient) {
    await runCommand(
      "tmux",
      buildTmuxArgs(["switch-client", "-t", options.primaryClient], options),
      2000,
    ).catch(() => null);
  }
  const sessionName = await getPaneSession(paneId, options);
  if (sessionName) {
    await runCommand(
      "tmux",
      buildTmuxArgs(["switch-client", "-t", sessionName], options),
      2000,
    ).catch(() => null);
  }
  await runCommand("tmux", buildTmuxArgs(["select-window", "-t", paneId], options), 2000).catch(
    () => null,
  );
  await runCommand("tmux", buildTmuxArgs(["select-pane", "-t", paneId], options), 2000).catch(
    () => null,
  );
};

export const getPaneGeometry = async (paneId: string, options?: TmuxOptions) => {
  try {
    const format = [
      "#{pane_left}",
      "#{pane_top}",
      "#{pane_width}",
      "#{pane_height}",
      "#{window_width}",
      "#{window_height}",
    ].join("\t");
    const result = await runCommand(
      "tmux",
      buildTmuxArgs(["display-message", "-p", "-t", paneId, "-F", format], options),
      2000,
    );
    return parsePaneGeometry(result.stdout ?? "");
  } catch {
    return null;
  }
};
