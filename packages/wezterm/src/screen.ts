import type { WeztermAdapter } from "./adapter";

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

const normalizeLines = (text: string) => {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  return lines;
};

export const createScreenCapture = (adapter: WeztermAdapter) => {
  const captureText = async (options: TextCaptureOptions): Promise<TextCaptureResult> => {
    const args = ["get-text", "--pane-id", options.paneId, "--start-line", `-${options.lines}`];
    if (options.includeAnsi) {
      args.push("--escapes");
    }
    const result = await adapter.run(args);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "wezterm get-text failed");
    }
    const allLines = normalizeLines(result.stdout);
    const truncated = allLines.length > options.lines;
    const visible = truncated ? allLines.slice(-options.lines) : allLines;
    return {
      screen: visible.join("\n"),
      truncated,
      alternateOn: false,
    };
  };

  return { captureText };
};
