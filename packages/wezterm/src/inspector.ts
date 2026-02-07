import type { PaneMeta } from "@vde-monitor/shared";

import type { WeztermAdapter } from "./adapter.js";

type WeztermPaneRaw = {
  pane_id?: unknown;
  paneId?: unknown;
  workspace?: unknown;
  tab_id?: unknown;
  tabId?: unknown;
  window_id?: unknown;
  windowId?: unknown;
  pane_index?: unknown;
  paneIndex?: unknown;
  cwd?: unknown;
  title?: unknown;
  tty_name?: unknown;
  tty?: unknown;
  pid?: unknown;
  foreground_process_name?: unknown;
  process_name?: unknown;
};

type WeztermClientRaw = {
  focused_pane_id?: unknown;
  focusedPaneId?: unknown;
  idle_time?: unknown;
  idleTime?: unknown;
};

type WeztermDurationRaw = {
  secs?: unknown;
  seconds?: unknown;
  nanos?: unknown;
  nanoseconds?: unknown;
};

type InspectorDeps = {
  now?: () => Date;
};

const toNullable = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const toPaneId = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
};

const normalizeCwd = (cwd: unknown): string | null => {
  const value = toNullable(cwd);
  if (!value) {
    return null;
  }
  if (!value.startsWith("file://")) {
    return value;
  }
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value;
  }
};

const parseJsonArray = <T>(raw: string): T[] => {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
};

const toDurationMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const duration = value as WeztermDurationRaw;
  const secs = toNumber(duration.secs ?? duration.seconds);
  const nanos = toNumber(duration.nanos ?? duration.nanoseconds) ?? 0;
  if (secs === null || secs < 0 || nanos < 0) {
    return null;
  }
  return secs * 1000 + Math.floor(nanos / 1_000_000);
};

const toActivityEpochSeconds = (idleMs: number, nowMs: number): number | null => {
  const atMs = nowMs - idleMs;
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return null;
  }
  return Math.floor(atMs / 1000);
};

const buildFocusedPaneSet = (clients: WeztermClientRaw[]): Set<string> => {
  const focused = new Set<string>();
  for (const client of clients) {
    const paneId = toPaneId(client.focused_pane_id ?? client.focusedPaneId);
    if (paneId) {
      focused.add(paneId);
    }
  }
  return focused;
};

const resolvePaneWindowIndex = (pane: WeztermPaneRaw) =>
  toNumber(pane.tab_id ?? pane.tabId ?? pane.window_id ?? pane.windowId) ?? 0;

const buildActivityMaps = ({
  panes,
  clients,
  now,
}: {
  panes: WeztermPaneRaw[];
  clients: WeztermClientRaw[];
  now: () => Date;
}) => {
  const paneWindowIndexById = new Map<string, number>();
  for (const pane of panes) {
    const paneId = toPaneId(pane.pane_id ?? pane.paneId);
    if (!paneId) {
      continue;
    }
    paneWindowIndexById.set(paneId, resolvePaneWindowIndex(pane));
  }

  const paneActivityByPaneId = new Map<string, number>();
  const windowActivityByWindowIndex = new Map<number, number>();
  const nowMs = now().getTime();

  for (const client of clients) {
    const paneId = toPaneId(client.focused_pane_id ?? client.focusedPaneId);
    if (!paneId) {
      continue;
    }
    const idleMs = toDurationMs(client.idle_time ?? client.idleTime);
    if (idleMs === null) {
      continue;
    }
    const activityAt = toActivityEpochSeconds(idleMs, nowMs);
    if (activityAt === null) {
      continue;
    }
    const prevPane = paneActivityByPaneId.get(paneId) ?? 0;
    paneActivityByPaneId.set(paneId, Math.max(prevPane, activityAt));

    const windowIndex = paneWindowIndexById.get(paneId);
    if (windowIndex === undefined) {
      continue;
    }
    const prevWindow = windowActivityByWindowIndex.get(windowIndex) ?? 0;
    windowActivityByWindowIndex.set(windowIndex, Math.max(prevWindow, activityAt));
  }

  return { paneActivityByPaneId, windowActivityByWindowIndex };
};

const toPaneMetaList = (
  panes: WeztermPaneRaw[],
  focusedPaneIds: Set<string>,
  paneActivityByPaneId: Map<string, number>,
  windowActivityByWindowIndex: Map<number, number>,
): PaneMeta[] => {
  const nextPaneIndexByWindow = new Map<number, number>();
  const results: PaneMeta[] = [];
  for (const pane of panes) {
    const paneId = toPaneId(pane.pane_id ?? pane.paneId);
    if (!paneId) {
      continue;
    }
    const windowIndex = resolvePaneWindowIndex(pane);
    const providedPaneIndex = toNumber(pane.pane_index ?? pane.paneIndex);
    const fallbackPaneIndex = nextPaneIndexByWindow.get(windowIndex) ?? 0;
    const paneIndex = providedPaneIndex ?? fallbackPaneIndex;
    nextPaneIndexByWindow.set(windowIndex, paneIndex + 1);

    results.push({
      paneId,
      sessionName: toNullable(pane.workspace) ?? "default",
      windowIndex,
      paneIndex,
      windowActivity: windowActivityByWindowIndex.get(windowIndex) ?? null,
      paneActivity: paneActivityByPaneId.get(paneId) ?? null,
      paneActive: focusedPaneIds.has(paneId),
      currentCommand: toNullable(pane.foreground_process_name ?? pane.process_name),
      currentPath: normalizeCwd(pane.cwd),
      paneTty: toNullable(pane.tty_name ?? pane.tty),
      paneDead: false,
      panePipe: false,
      alternateOn: false,
      panePid: toNumber(pane.pid),
      paneTitle: toNullable(pane.title),
      paneStartCommand: null,
      pipeTagValue: null,
    });
  }
  return results;
};

export const createInspector = (adapter: WeztermAdapter, deps: InspectorDeps = {}) => {
  const now = deps.now ?? (() => new Date());

  const listPanes = async (): Promise<PaneMeta[]> => {
    const panesResult = await adapter.run(["list", "--format", "json"]);
    if (panesResult.exitCode !== 0) {
      throw new Error(panesResult.stderr || "wezterm list failed");
    }
    const panes = parseJsonArray<WeztermPaneRaw>(panesResult.stdout);

    const clientsResult = await adapter.run(["list-clients", "--format", "json"]);
    const clients =
      clientsResult.exitCode === 0 ? parseJsonArray<WeztermClientRaw>(clientsResult.stdout) : [];
    const focusedPaneIds =
      clientsResult.exitCode === 0 ? buildFocusedPaneSet(clients) : new Set<string>();
    const { paneActivityByPaneId, windowActivityByWindowIndex } = buildActivityMaps({
      panes,
      clients,
      now,
    });

    return toPaneMetaList(panes, focusedPaneIds, paneActivityByPaneId, windowActivityByWindowIndex);
  };

  const readUserOption = async (paneId: string, key: string): Promise<string | null> => {
    void paneId;
    void key;
    return Promise.resolve(null);
  };

  return {
    listPanes,
    readUserOption,
  };
};
