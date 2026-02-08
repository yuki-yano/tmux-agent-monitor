import { normalizeWeztermTarget } from "@vde-monitor/wezterm";
import { execa } from "execa";

import type { PaneGeometry } from "./tmux-geometry";

export type WeztermOptions = {
  cliPath?: string | null;
  target?: string | null;
};

type WeztermListPane = {
  pane_id?: unknown;
  tab_id?: unknown;
  window_id?: unknown;
  left_col?: unknown;
  top_row?: unknown;
  size?: {
    cols?: unknown;
    rows?: unknown;
    pixel_width?: unknown;
    pixel_height?: unknown;
  } | null;
};

type PaneCellGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const resolveCliPath = (options?: WeztermOptions) => {
  const value = options?.cliPath?.trim();
  return value && value.length > 0 ? value : "wezterm";
};

const buildTargetArgs = (options?: WeztermOptions) => {
  const target = normalizeWeztermTarget(options?.target);
  if (target === "auto") {
    return [];
  }
  return ["--target", target];
};

const runWeztermCli = async (args: string[], options?: WeztermOptions) =>
  execa(resolveCliPath(options), ["cli", ...buildTargetArgs(options), ...args], {
    timeout: 2000,
  });

const toPaneId = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return null;
};

const toInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const parseListPanes = (stdout: string): WeztermListPane[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is WeztermListPane => typeof entry === "object" && entry !== null,
  );
};

const toPaneCellGeometry = (pane: WeztermListPane): PaneCellGeometry | null => {
  const left = toInteger(pane.left_col);
  const top = toInteger(pane.top_row);
  const width = toInteger(pane.size?.cols);
  const height = toInteger(pane.size?.rows);
  if (
    left === null ||
    top === null ||
    width === null ||
    height === null ||
    left < 0 ||
    top < 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { left, top, width, height };
};

const toPanePixelSize = (pane: WeztermListPane): { width: number; height: number } | null => {
  const width = toInteger(pane.size?.pixel_width);
  const height = toInteger(pane.size?.pixel_height);
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
};

export const focusWeztermPane = async (paneId: string, options?: WeztermOptions) => {
  if (!paneId) {
    return;
  }
  await runWeztermCli(["activate-pane", "--pane-id", paneId], options).catch(() => null);
};

export const getWeztermPaneGeometry = async (
  paneId: string,
  options?: WeztermOptions,
): Promise<PaneGeometry | null> => {
  try {
    const result = await runWeztermCli(["list", "--format", "json"], options);
    const panes = parseListPanes(result.stdout ?? "");
    const targetPane = panes.find((pane) => toPaneId(pane.pane_id) === paneId);
    if (!targetPane) {
      return null;
    }

    const targetGeometry = toPaneCellGeometry(targetPane);
    if (!targetGeometry) {
      return null;
    }

    const tabId = toPaneId(targetPane.tab_id);
    const windowId = toPaneId(targetPane.window_id);
    const tabPanes = panes
      .filter((pane) => toPaneId(pane.tab_id) === tabId && toPaneId(pane.window_id) === windowId)
      .map((pane) => toPaneCellGeometry(pane))
      .filter((pane): pane is PaneCellGeometry => pane !== null);

    const windowWidth =
      tabPanes.length > 0
        ? Math.max(...tabPanes.map((pane) => pane.left + pane.width))
        : targetGeometry.width;
    const windowHeight =
      tabPanes.length > 0
        ? Math.max(...tabPanes.map((pane) => pane.top + pane.height))
        : targetGeometry.height;

    if (windowWidth <= 0 || windowHeight <= 0) {
      return null;
    }

    return {
      left: targetGeometry.left,
      top: targetGeometry.top,
      width: targetGeometry.width,
      height: targetGeometry.height,
      windowWidth,
      windowHeight,
      panePixelWidth: toPanePixelSize(targetPane)?.width,
      panePixelHeight: toPanePixelSize(targetPane)?.height,
    };
  } catch {
    return null;
  }
};
