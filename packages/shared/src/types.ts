export type SessionStateValue =
  | "RUNNING"
  | "WAITING_INPUT"
  | "WAITING_PERMISSION"
  | "SHELL"
  | "UNKNOWN";

export type AllowedKey =
  | "Enter"
  | "Escape"
  | "Tab"
  | "BTab"
  | "C-Tab"
  | "C-BTab"
  | "Space"
  | "BSpace"
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "C-Up"
  | "C-Down"
  | "C-Left"
  | "C-Right"
  | "C-Enter"
  | "C-Escape"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "C-a"
  | "C-b"
  | "C-c"
  | "C-d"
  | "C-e"
  | "C-f"
  | "C-g"
  | "C-h"
  | "C-i"
  | "C-j"
  | "C-k"
  | "C-l"
  | "C-m"
  | "C-n"
  | "C-o"
  | "C-p"
  | "C-q"
  | "C-r"
  | "C-s"
  | "C-t"
  | "C-u"
  | "C-v"
  | "C-w"
  | "C-x"
  | "C-y"
  | "C-z"
  | "C-\\"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7"
  | "F8"
  | "F9"
  | "F10"
  | "F11"
  | "F12";

export type RawItem = { kind: "text"; value: string } | { kind: "key"; value: AllowedKey };

export type SessionSummary = {
  paneId: string;
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  windowActivity: number | null;
  paneActive: boolean;
  currentCommand: string | null;
  currentPath: string | null;
  paneTty: string | null;
  title: string | null;
  customTitle: string | null;
  repoRoot: string | null;
  agent: "codex" | "claude" | "unknown";
  state: SessionStateValue;
  stateReason: string;
  lastMessage: string | null;
  lastOutputAt: string | null;
  lastEventAt: string | null;
  lastInputAt: string | null;
  paneDead: boolean;
  alternateOn: boolean;
  pipeAttached: boolean;
  pipeConflict: boolean;
};

export type SessionDetail = SessionSummary & {
  startCommand: string | null;
  panePid: number | null;
};

export type DiffFileStatus = "A" | "M" | "D" | "R" | "C" | "U" | "?";

export type DiffSummaryFile = {
  path: string;
  status: DiffFileStatus;
  staged: boolean;
  renamedFrom?: string;
  additions?: number | null;
  deletions?: number | null;
};

export type DiffSummary = {
  repoRoot: string | null;
  rev: string | null;
  generatedAt: string;
  files: DiffSummaryFile[];
  truncated?: boolean;
  reason?: "not_git" | "cwd_unknown" | "error";
};

export type CommitSummary = {
  hash: string;
  shortHash: string;
  subject: string;
  body: string | null;
  authorName: string;
  authorEmail: string | null;
  authoredAt: string;
};

export type CommitLog = {
  repoRoot: string | null;
  rev: string | null;
  generatedAt: string;
  commits: CommitSummary[];
  totalCount?: number | null;
  truncated?: boolean;
  reason?: "not_git" | "cwd_unknown" | "error";
};

export type CommitFile = {
  path: string;
  status: DiffFileStatus;
  additions: number | null;
  deletions: number | null;
  renamedFrom?: string;
};

export type CommitFileDiff = {
  path: string;
  status: DiffFileStatus;
  patch: string | null;
  binary: boolean;
  truncated?: boolean;
};

export type CommitDetail = {
  hash: string;
  shortHash: string;
  subject: string;
  body: string | null;
  authorName: string;
  authorEmail: string | null;
  authoredAt: string;
  files: CommitFile[];
};

export type DiffFile = {
  path: string;
  status: DiffFileStatus;
  patch: string | null;
  binary: boolean;
  truncated?: boolean;
  rev: string | null;
};

export type ApiErrorCode =
  | "INVALID_PANE"
  | "INVALID_PAYLOAD"
  | "DANGEROUS_COMMAND"
  | "READ_ONLY"
  | "NOT_FOUND"
  | "TMUX_UNAVAILABLE"
  | "RATE_LIMIT"
  | "INTERNAL";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
};

export type ApiEnvelope<T> = T & {
  error?: ApiError;
};

export type ScreenResponse = {
  ok: boolean;
  paneId: string;
  mode: "text" | "image";
  capturedAt: string;
  cursor?: string;
  lines?: number;
  truncated?: boolean | null;
  alternateOn?: boolean;
  screen?: string;
  full?: boolean;
  deltas?: ScreenDelta[];
  imageBase64?: string;
  cropped?: boolean;
  fallbackReason?: "image_failed" | "image_disabled";
  error?: ApiError;
};

export type ScreenDelta = {
  start: number;
  deleteCount: number;
  insertLines: string[];
};

export type CommandResponse = {
  ok: boolean;
  error?: ApiError;
};

export type WsEnvelope<TType extends string, TData> = {
  type: TType;
  ts: string;
  reqId?: string;
  data: TData;
};

export type WsClientMessage =
  | WsEnvelope<
      "screen.request",
      { paneId: string; lines?: number; mode?: "text" | "image"; cursor?: string }
    >
  | WsEnvelope<"send.text", { paneId: string; text: string; enter?: boolean }>
  | WsEnvelope<"send.keys", { paneId: string; keys: AllowedKey[] }>
  | WsEnvelope<"send.raw", { paneId: string; items: RawItem[]; unsafe?: boolean }>
  | WsEnvelope<"client.ping", Record<string, never>>;

export type WsServerMessage =
  | WsEnvelope<"sessions.snapshot", { sessions: SessionSummary[] }>
  | WsEnvelope<"session.updated", { session: SessionSummary }>
  | WsEnvelope<"session.removed", { paneId: string }>
  | WsEnvelope<"server.health", ServerHealth>
  | WsEnvelope<"screen.response", ScreenResponse>
  | WsEnvelope<"command.response", CommandResponse>;

export type ClaudeHookEvent = {
  ts: string;
  hook_event_name: "PreToolUse" | "PostToolUse" | "Notification" | "Stop" | "UserPromptSubmit";
  notification_type?: "permission_prompt";
  session_id: string;
  cwd?: string;
  tty?: string;
  tmux_pane?: string | null;
  transcript_path?: string;
  fallback?: { cwd?: string; transcript_path?: string };
  payload: { raw: string };
};

export type HighlightCorrectionConfig = {
  codex: boolean;
  claude: boolean;
};

export type ClientScreenConfig = {
  highlightCorrection: HighlightCorrectionConfig;
};

export type ClientConfig = {
  screen: ClientScreenConfig;
};

export type ServerHealth = {
  version: string;
  clientConfig?: ClientConfig;
};

export type AgentMonitorConfigBase = {
  bind: "127.0.0.1" | "0.0.0.0";
  port: number;
  readOnly: boolean;
  attachOnServe: boolean;
  staticAuth: boolean;
  allowedOrigins: string[];
  rateLimit: {
    send: { windowMs: number; max: number };
    screen: { windowMs: number; max: number };
    raw: { windowMs: number; max: number };
  };
  dangerKeys: string[];
  dangerCommandPatterns: string[];
  activity: {
    pollIntervalMs: number;
    runningThresholdMs: number;
    inactiveThresholdMs: number;
  };
  hooks: {
    ttyCacheTtlMs: number;
    ttyCacheMax: number;
  };
  input: { maxTextLength: number; enterKey: string; enterDelayMs: number };
  screen: {
    mode: "text" | "image";
    defaultLines: number;
    maxLines: number;
    joinLines: boolean;
    ansi: boolean;
    altScreen: "auto" | "on" | "off";
    highlightCorrection: HighlightCorrectionConfig;
    image: {
      enabled: boolean;
      backend: "alacritty" | "terminal" | "iterm" | "wezterm" | "ghostty";
      format: "png";
      cropPane: boolean;
      timeoutMs: number;
    };
  };
  logs: { maxPaneLogBytes: number; maxEventLogBytes: number; retainRotations: number };
  tmux: { socketName: string | null; socketPath: string | null; primaryClient: string | null };
};

export type AgentMonitorConfig = AgentMonitorConfigBase & {
  token: string;
};

export type AgentMonitorConfigFile = AgentMonitorConfigBase;

export type PaneMeta = {
  paneId: string;
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  windowActivity: number | null;
  paneActivity: number | null;
  paneActive: boolean;
  currentCommand: string | null;
  currentPath: string | null;
  paneTty: string | null;
  paneDead: boolean;
  panePipe: boolean;
  alternateOn: boolean;
  panePid: number | null;
  paneTitle: string | null;
  paneStartCommand: string | null;
  pipeTagValue: string | null;
};

export type HookStateSignal = {
  state: SessionStateValue;
  reason: string;
  at: string;
};

export type StateSignals = {
  paneDead: boolean;
  lastOutputAt: string | null;
  hookState: HookStateSignal | null;
  thresholds: { runningThresholdMs: number; inactiveThresholdMs: number };
};
