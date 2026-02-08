import { isEditorCommand } from "@vde-monitor/shared";

import type { TmuxAdapter } from "./adapter";

export type TextCaptureOptions = {
  paneId: string;
  lines: number;
  joinLines: boolean;
  includeAnsi: boolean;
  altScreen: "auto" | "on" | "off";
  alternateOn: boolean;
  currentCommand?: string | null;
};

export type TextCaptureResult = {
  screen: string;
  truncated: boolean | null;
  alternateOn: boolean;
};

const normalizeScreen = (text: string, lineLimit: number): string => {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  if (lines.length > lineLimit) {
    return lines.slice(-lineLimit).join("\n");
  }
  return lines.join("\n");
};

const shouldUsePrimaryBuffer = (command?: string | null): boolean => {
  return isEditorCommand(command);
};

const resolveAltFlag = (altScreen: "auto" | "on" | "off", alternateOn: boolean): boolean => {
  if (altScreen === "on") {
    return true;
  }
  if (altScreen === "off") {
    return false;
  }
  return alternateOn;
};

const getPaneSize = async (
  adapter: TmuxAdapter,
  paneId: string,
): Promise<{ historySize: number; paneHeight: number } | null> => {
  const result = await adapter.run([
    "display-message",
    "-p",
    "-t",
    paneId,
    "#{history_size}\t#{pane_height}",
  ]);
  if (result.exitCode !== 0) {
    return null;
  }
  const [historySize, paneHeight] = result.stdout.trim().split("\t");
  const history = Number.parseInt(historySize ?? "", 10);
  const height = Number.parseInt(paneHeight ?? "", 10);
  if (Number.isNaN(history) || Number.isNaN(height)) {
    return null;
  }
  return { historySize: history, paneHeight: height };
};

export const createScreenCapture = (adapter: TmuxAdapter) => {
  const runCapture = async (
    options: TextCaptureOptions,
    useAlt: boolean,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const args = ["capture-pane", "-p", "-t", options.paneId];
    if (options.joinLines) {
      args.push("-J");
    }
    if (options.includeAnsi) {
      args.push("-e");
    }
    if (useAlt) {
      args.push("-a");
    }
    args.push("-S", `-${options.lines}`, "-E", "-");
    return adapter.run(args);
  };

  const captureText = async (options: TextCaptureOptions): Promise<TextCaptureResult> => {
    const useAlt = resolveAltFlag(options.altScreen, options.alternateOn);
    const result = await runCapture(
      options,
      useAlt && !shouldUsePrimaryBuffer(options.currentCommand),
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "capture-pane failed");
    }

    const size = await getPaneSize(adapter, options.paneId);
    const truncated = size == null ? null : size.historySize + size.paneHeight > options.lines;

    return {
      screen: normalizeScreen(result.stdout, options.lines),
      truncated,
      alternateOn: options.alternateOn,
    };
  };

  return { captureText };
};
