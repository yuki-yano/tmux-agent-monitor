import { z } from "zod";

import { allowedKeys } from "./constants.js";

export const sessionStateSchema = z.enum([
  "RUNNING",
  "WAITING_INPUT",
  "WAITING_PERMISSION",
  "UNKNOWN",
]);

export const allowedKeySchema = z.enum(allowedKeys);

export const apiErrorSchema = z.object({
  code: z.enum([
    "INVALID_PANE",
    "INVALID_PAYLOAD",
    "DANGEROUS_COMMAND",
    "READ_ONLY",
    "NOT_FOUND",
    "TMUX_UNAVAILABLE",
    "RATE_LIMIT",
    "INTERNAL",
  ]),
  message: z.string(),
});

const screenDeltaSchema = z.object({
  start: z.number(),
  deleteCount: z.number(),
  insertLines: z.array(z.string()),
});

export const screenResponseSchema = z.object({
  ok: z.boolean(),
  paneId: z.string(),
  mode: z.enum(["text", "image"]),
  capturedAt: z.string(),
  cursor: z.string().optional(),
  lines: z.number().optional(),
  truncated: z.boolean().nullable().optional(),
  alternateOn: z.boolean().optional(),
  screen: z.string().optional(),
  full: z.boolean().optional(),
  deltas: z.array(screenDeltaSchema).optional(),
  imageBase64: z.string().optional(),
  cropped: z.boolean().optional(),
  fallbackReason: z.enum(["image_failed", "image_disabled"]).optional(),
  error: apiErrorSchema.optional(),
});

export const commandResponseSchema = z.object({
  ok: z.boolean(),
  error: apiErrorSchema.optional(),
});

const rawItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("key"), value: allowedKeySchema }),
]);

export const sessionSummarySchema = z.object({
  paneId: z.string(),
  sessionName: z.string(),
  windowIndex: z.number(),
  paneIndex: z.number(),
  windowActivity: z.number().nullable(),
  paneActive: z.boolean(),
  currentCommand: z.string().nullable(),
  currentPath: z.string().nullable(),
  paneTty: z.string().nullable(),
  title: z.string().nullable(),
  customTitle: z.string().nullable(),
  repoRoot: z.string().nullable(),
  agent: z.enum(["codex", "claude", "unknown"]),
  state: sessionStateSchema,
  stateReason: z.string(),
  lastMessage: z.string().nullable(),
  lastOutputAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  lastInputAt: z.string().nullable(),
  paneDead: z.boolean(),
  alternateOn: z.boolean(),
  pipeAttached: z.boolean(),
  pipeConflict: z.boolean(),
});

export const sessionDetailSchema = sessionSummarySchema.extend({
  startCommand: z.string().nullable(),
  panePid: z.number().nullable(),
});

const highlightCorrectionSchema = z.object({
  codex: z.boolean().default(true),
  claude: z.boolean().default(true),
});

const clientConfigSchema = z.object({
  screen: z.object({
    highlightCorrection: highlightCorrectionSchema,
  }),
});

const serverHealthSchema = z.object({
  version: z.string(),
  clientConfig: clientConfigSchema.optional(),
});

export const wsEnvelopeSchema = <TType extends z.ZodTypeAny, TData extends z.ZodTypeAny>(
  typeSchema: TType,
  dataSchema: TData,
) =>
  z.object({
    type: typeSchema,
    ts: z.string(),
    reqId: z.string().optional(),
    data: dataSchema,
  });

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  wsEnvelopeSchema(
    z.literal("screen.request"),
    z.object({
      paneId: z.string(),
      lines: z.number().optional(),
      mode: z.enum(["text", "image"]).optional(),
      cursor: z.string().optional(),
    }),
  ),
  wsEnvelopeSchema(
    z.literal("send.text"),
    z.object({ paneId: z.string(), text: z.string(), enter: z.boolean().optional() }),
  ),
  wsEnvelopeSchema(
    z.literal("send.keys"),
    z.object({ paneId: z.string(), keys: z.array(allowedKeySchema) }),
  ),
  wsEnvelopeSchema(
    z.literal("send.raw"),
    z.object({ paneId: z.string(), items: z.array(rawItemSchema), unsafe: z.boolean().optional() }),
  ),
  wsEnvelopeSchema(z.literal("client.ping"), z.object({}).strict()),
]);

export const wsServerMessageSchema = z.discriminatedUnion("type", [
  wsEnvelopeSchema(
    z.literal("sessions.snapshot"),
    z.object({ sessions: z.array(sessionSummarySchema) }),
  ),
  wsEnvelopeSchema(z.literal("session.updated"), z.object({ session: sessionSummarySchema })),
  wsEnvelopeSchema(z.literal("session.removed"), z.object({ paneId: z.string() })),
  wsEnvelopeSchema(z.literal("server.health"), serverHealthSchema),
  wsEnvelopeSchema(z.literal("screen.response"), screenResponseSchema),
  wsEnvelopeSchema(z.literal("command.response"), commandResponseSchema),
]);

export const claudeHookEventSchema = z.object({
  ts: z.string(),
  hook_event_name: z.enum([
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "UserPromptSubmit",
  ]),
  notification_type: z.enum(["permission_prompt"]).optional(),
  session_id: z.string(),
  cwd: z.string().optional(),
  tty: z.string().optional(),
  tmux_pane: z.string().nullable().optional(),
  transcript_path: z.string().optional(),
  fallback: z
    .object({
      cwd: z.string().optional(),
      transcript_path: z.string().optional(),
    })
    .optional(),
  payload: z.object({ raw: z.string() }),
});

export const configSchema = z.object({
  bind: z.enum(["127.0.0.1", "0.0.0.0"]),
  port: z.number(),
  readOnly: z.boolean(),
  attachOnServe: z.boolean(),
  staticAuth: z.boolean(),
  allowedOrigins: z.array(z.string()),
  rateLimit: z.object({
    send: z.object({ windowMs: z.number(), max: z.number() }),
    screen: z.object({ windowMs: z.number(), max: z.number() }),
    raw: z.object({ windowMs: z.number(), max: z.number() }).default({ windowMs: 1000, max: 200 }),
  }),
  dangerKeys: z.array(z.string()),
  dangerCommandPatterns: z.array(z.string()),
  activity: z.object({
    pollIntervalMs: z.number(),
    runningThresholdMs: z.number(),
    inactiveThresholdMs: z.number(),
  }),
  hooks: z.object({
    ttyCacheTtlMs: z.number(),
    ttyCacheMax: z.number(),
  }),
  input: z.object({
    maxTextLength: z.number(),
    enterKey: z.string().default("C-m"),
    enterDelayMs: z.number().default(100),
  }),
  screen: z.object({
    mode: z.enum(["text", "image"]),
    defaultLines: z.number(),
    maxLines: z.number(),
    joinLines: z.boolean(),
    ansi: z.boolean().default(true),
    altScreen: z.enum(["auto", "on", "off"]),
    highlightCorrection: highlightCorrectionSchema.default({ codex: true, claude: true }),
    image: z.object({
      enabled: z.boolean(),
      backend: z.enum(["alacritty", "terminal", "iterm", "wezterm", "ghostty"]),
      format: z.enum(["png"]),
      cropPane: z.boolean(),
      timeoutMs: z.number(),
    }),
  }),
  logs: z.object({
    maxPaneLogBytes: z.number(),
    maxEventLogBytes: z.number(),
    retainRotations: z.number(),
  }),
  tmux: z.object({
    socketName: z.string().nullable(),
    socketPath: z.string().nullable(),
    primaryClient: z.string().nullable(),
  }),
});
