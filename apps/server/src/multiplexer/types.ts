import type { AllowedKey, ApiError, PaneMeta, RawItem } from "@vde-monitor/shared";

export type MultiplexerBackend = "tmux" | "wezterm";

export type MultiplexerTextCaptureOptions = {
  paneId: string;
  lines: number;
  joinLines: boolean;
  includeAnsi: boolean;
  altScreen: "auto" | "on" | "off";
  alternateOn: boolean;
};

export type MultiplexerTextCaptureResult = {
  screen: string;
  truncated: boolean | null;
  alternateOn: boolean;
};

export type MultiplexerInspector = {
  listPanes: () => Promise<PaneMeta[]>;
  readUserOption: (paneId: string, key: string) => Promise<string | null>;
};

export type MultiplexerScreenCapture = {
  captureText: (options: MultiplexerTextCaptureOptions) => Promise<MultiplexerTextCaptureResult>;
};

export type MultiplexerActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: ApiError };

export type MultiplexerInputActions = {
  sendText: (paneId: string, text: string, enter?: boolean) => Promise<MultiplexerActionResult>;
  sendKeys: (paneId: string, keys: AllowedKey[]) => Promise<MultiplexerActionResult>;
  sendRaw: (paneId: string, items: RawItem[], unsafe?: boolean) => Promise<MultiplexerActionResult>;
  focusPane: (paneId: string) => Promise<MultiplexerActionResult>;
};

export type MultiplexerRuntime = {
  backend: MultiplexerBackend;
  serverKey: string;
  inspector: MultiplexerInspector;
  screenCapture: MultiplexerScreenCapture;
  actions: MultiplexerInputActions;
  pipeManager: {
    hasConflict: (state: { panePipe: boolean; pipeTagValue: string | null }) => boolean;
    attachPipe: (
      paneId: string,
      logPath: string,
      state: { panePipe: boolean; pipeTagValue: string | null },
    ) => Promise<{ attached: boolean; conflict: boolean }>;
  };
  captureFingerprint: (paneId: string, useAlt: boolean) => Promise<string | null>;
  pipeSupport: "tmux-pipe" | "none";
};
