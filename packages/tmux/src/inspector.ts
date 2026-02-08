import type { PaneMeta } from "@vde-monitor/shared";

import type { TmuxAdapter } from "./adapter";

const format = [
  "#{pane_id}",
  "#{session_name}",
  "#{window_index}",
  "#{pane_index}",
  "#{window_activity}",
  "#{pane_activity}",
  "#{pane_active}",
  "#{pane_current_command}",
  "#{pane_current_path}",
  "#{pane_tty}",
  "#{pane_dead}",
  "#{pane_pipe}",
  "#{alternate_on}",
  "#{pane_pid}",
  "#{pane_title}",
  "#{pane_start_command}",
  "#{@vde-monitor_pipe}",
].join("\t");

const toNullable = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const toNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const toEpochSeconds = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const toBool = (value: string | undefined): boolean => {
  return value === "1" || value === "on" || value === "true";
};

const parseLine = (line: string): PaneMeta | null => {
  if (!line) {
    return null;
  }
  const parts = line.split("\t");
  if (parts.length < 17) {
    return null;
  }
  const [
    paneIdRaw,
    sessionNameRaw,
    windowIndexRaw,
    paneIndexRaw,
    windowActivityRaw,
    paneActivityRaw,
    paneActiveRaw,
    currentCommand,
    currentPath,
    paneTty,
    paneDead,
    panePipe,
    alternateOn,
    panePid,
    paneTitle,
    paneStartCommand,
    pipeTagValue,
  ] = parts;

  if (!paneIdRaw || !sessionNameRaw) {
    return null;
  }

  const paneId = paneIdRaw;
  const sessionName = sessionNameRaw;
  const windowIndex = windowIndexRaw ?? "0";
  const paneIndex = paneIndexRaw ?? "0";

  return {
    paneId,
    sessionName,
    windowIndex: Number.parseInt(windowIndex, 10),
    paneIndex: Number.parseInt(paneIndex, 10),
    windowActivity: toEpochSeconds(windowActivityRaw),
    paneActivity: toEpochSeconds(paneActivityRaw),
    paneActive: toBool(paneActiveRaw),
    currentCommand: toNullable(currentCommand),
    currentPath: toNullable(currentPath),
    paneTty: toNullable(paneTty),
    paneDead: toBool(paneDead),
    panePipe: toBool(panePipe),
    alternateOn: toBool(alternateOn),
    panePid: toNumber(panePid),
    paneTitle: toNullable(paneTitle),
    paneStartCommand: toNullable(paneStartCommand),
    pipeTagValue: toNullable(pipeTagValue),
  };
};

export const createInspector = (adapter: TmuxAdapter) => {
  const listPanes = async (): Promise<PaneMeta[]> => {
    const result = await adapter.run(["list-panes", "-a", "-F", format]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "tmux list-panes failed");
    }
    return result.stdout
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0)
      .map(parseLine)
      .filter((pane): pane is PaneMeta => pane != null);
  };

  const readUserOption = async (paneId: string, key: string): Promise<string | null> => {
    const result = await adapter.run(["show-options", "-t", paneId, "-v", key]);
    if (result.exitCode !== 0) {
      return null;
    }
    return toNullable(result.stdout);
  };

  const writeUserOption = async (
    paneId: string,
    key: string,
    value: string | null,
  ): Promise<void> => {
    if (value == null) {
      await adapter.run(["set-option", "-t", paneId, "-u", key]);
      return;
    }
    await adapter.run(["set-option", "-t", paneId, key, value]);
  };

  return {
    listPanes,
    readUserOption,
    writeUserOption,
  };
};
