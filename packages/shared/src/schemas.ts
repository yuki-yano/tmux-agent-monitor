import { z } from "zod";

import { allowedKeys } from "./constants";

export const sessionStateSchema = z.enum([
  "RUNNING",
  "WAITING_INPUT",
  "WAITING_PERMISSION",
  "DONE",
  "SHELL",
  "UNKNOWN",
]);

export const allowedKeySchema = z.enum(allowedKeys);

export const apiErrorSchema = z.object({
  code: z.enum([
    "INVALID_PANE",
    "INVALID_PAYLOAD",
    "DANGEROUS_COMMAND",
    "NOT_FOUND",
    "REPO_UNAVAILABLE",
    "FORBIDDEN_PATH",
    "PERMISSION_DENIED",
    "TMUX_UNAVAILABLE",
    "WEZTERM_UNAVAILABLE",
    "CMUX_UNAVAILABLE",
    "RESUME_NOT_FOUND",
    "RESUME_AMBIGUOUS",
    "RESUME_UNSUPPORTED",
    "RESUME_INVALID_INPUT",
    "RATE_LIMIT",
    "PUSH_DISABLED",
    "GIT_COMMAND_FAILED",
    "INTERNAL",
  ]),
  message: z.string(),
});

export const pushEventTypeValues = [
  "pane.waiting_permission",
  "pane.task_completed",
  "pane.error",
  "pane.long_waiting_permission",
] as const;
export const configPushEventTypeValues = [
  "pane.waiting_permission",
  "pane.task_completed",
] as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+={0,2}$/;

export const pushEventTypeSchema = z.enum(pushEventTypeValues);
export const configPushEventTypeSchema = z.enum(configPushEventTypeValues);

export const pushSubscriptionJsonSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(512).regex(base64UrlPattern),
    auth: z.string().min(1).max(512).regex(base64UrlPattern),
  }),
});

export const notificationSubscriptionScopeSchema = z.object({
  paneIds: z.array(z.string()).optional(),
  eventTypes: z.union([z.array(pushEventTypeSchema).min(1), z.null()]).optional(),
});

export const notificationClientInfoSchema = z.object({
  platform: z.enum(["ios", "android", "desktop", "unknown"]).optional(),
  standalone: z.boolean().optional(),
  userAgent: z.string().max(2048).optional(),
});

export const notificationSubscriptionUpsertSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(128),
    subscription: pushSubscriptionJsonSchema,
    scope: notificationSubscriptionScopeSchema.optional(),
    client: notificationClientInfoSchema.optional(),
  })
  .strict();

export const notificationSubscriptionRevokeSchema = z
  .object({
    subscriptionId: z.string().trim().min(1).max(128).optional(),
    endpoint: z.string().url().max(2048).optional(),
    deviceId: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        (value.subscriptionId && value.subscriptionId.length > 0) ||
        (value.endpoint && value.endpoint.length > 0) ||
        (value.deviceId && value.deviceId.length > 0),
      ),
    {
      message: "subscriptionId, endpoint, or deviceId is required",
      path: ["subscriptionId"],
    },
  );

export const notificationSettingsSchema = z.object({
  pushEnabled: z.boolean(),
  vapidPublicKey: z.string().min(1),
  supportedEvents: z.array(pushEventTypeSchema).min(1),
  enabledEventTypes: z.array(configPushEventTypeSchema).min(1),
  requireStandaloneOnIOS: z.boolean(),
});

export const screenDeltaSchema = z.object({
  start: z.number(),
  deleteCount: z.number(),
  insertLines: z.array(z.string()),
});

export const screenCaptureMetaSchema = z.object({
  backend: z.enum(["tmux", "wezterm", "herdr", "cmux", "unknown"]),
  // "logical" is reserved for future backends/modes that can return logical lines.
  lineModel: z.enum(["joined-physical", "physical", "logical", "none"]),
  joinLinesApplied: z.boolean().nullable(),
  // "wezterm-logical-lines" is reserved for future wezterm logical-line capture support.
  captureMethod: z.enum([
    "tmux-capture-pane",
    "wezterm-get-text",
    "wezterm-logical-lines",
    "herdr-pane-read",
    "cmux-read-screen",
    "terminal-image",
    "none",
  ]),
});

export const screenResponseSchema = z.object({
  ok: z.boolean(),
  paneId: z.string(),
  mode: z.enum(["text", "image"]),
  capturedAt: z.string(),
  captureMeta: screenCaptureMetaSchema.optional(),
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

export const launchAgentSchema = z.enum(["codex", "claude"]);
export const launchResumePolicySchema = z.enum(["required", "best_effort"]);
export const launchResumeTargetSchema = z.enum(["pane", "window"]);

const containsNulOrLineBreak = (value: string) =>
  value.includes("\0") || value.includes("\r") || value.includes("\n") || value.includes("\t");

const launchOptionSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0, {
    message: "launch option must not be empty",
  })
  .refine((value) => !containsNulOrLineBreak(value), {
    message: "launch option contains forbidden control characters",
  });

export const launchAgentRequestSchema = z
  .object({
    sessionName: z.string().trim().min(1).max(128),
    agent: launchAgentSchema,
    requestId: z.string().trim().min(1).max(128),
    windowName: z.string().trim().min(1).max(64).optional(),
    cwd: z.string().trim().min(1).max(512).optional(),
    agentOptions: z.array(launchOptionSchema).max(32).optional(),
    worktreePath: z.string().trim().min(1).max(1024).optional(),
    worktreeBranch: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => !value.startsWith("-"), { message: "invalid branch name" })
      .optional(),
    worktreeCreateIfMissing: z.boolean().optional(),
    resumeSessionId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => !value.startsWith("-"), { message: "invalid session id" })
      .optional(),
    resumeFromPaneId: z.string().trim().min(1).max(64).optional(),
    resumePolicy: launchResumePolicySchema.optional(),
    resumeTarget: launchResumeTargetSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.windowName && containsNulOrLineBreak(value.windowName)) {
      ctx.addIssue({
        code: "custom",
        path: ["windowName"],
        message: "windowName must not include control characters",
      });
    }
    if (value.cwd && (value.worktreePath || value.worktreeBranch)) {
      ctx.addIssue({
        code: "custom",
        path: ["cwd"],
        message: "cwd cannot be combined with worktreePath/worktreeBranch",
      });
    }
    if (value.worktreeCreateIfMissing && !value.worktreeBranch) {
      ctx.addIssue({
        code: "custom",
        path: ["worktreeBranch"],
        message: "worktreeBranch is required when worktreeCreateIfMissing is true",
      });
    }
    if (value.worktreeCreateIfMissing && value.worktreePath) {
      ctx.addIssue({
        code: "custom",
        path: ["worktreePath"],
        message: "worktreePath cannot be combined with worktreeCreateIfMissing",
      });
    }
    if (value.resumeSessionId && containsNulOrLineBreak(value.resumeSessionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["resumeSessionId"],
        message: "resumeSessionId must not include control characters",
      });
    }
    if (value.resumeFromPaneId && containsNulOrLineBreak(value.resumeFromPaneId)) {
      ctx.addIssue({
        code: "custom",
        path: ["resumeFromPaneId"],
        message: "resumeFromPaneId must not include control characters",
      });
    }
    const resumeRequested = Boolean(value.resumeSessionId || value.resumeFromPaneId);
    if (!resumeRequested && value.resumePolicy) {
      ctx.addIssue({
        code: "custom",
        path: ["resumePolicy"],
        message: "resumePolicy requires resumeSessionId or resumeFromPaneId",
      });
    }
    if (value.resumeTarget === "window" && !value.resumeFromPaneId) {
      ctx.addIssue({
        code: "custom",
        path: ["resumeFromPaneId"],
        message: "resumeFromPaneId is required when resumeTarget is window",
      });
    }
  });

export const launchRollbackSchema = z.object({
  attempted: z.boolean(),
  ok: z.boolean(),
  message: z.string().optional(),
});

export const launchVerificationSchema = z.object({
  status: z.enum(["verified", "timeout", "mismatch", "skipped"]),
  observedCommand: z.string().nullable(),
  attempts: z.number().int().min(0),
});

export const launchAgentResultSchema = z.object({
  sessionName: z.string(),
  agent: launchAgentSchema,
  windowId: z.string(),
  windowIndex: z.number(),
  windowName: z.string(),
  paneId: z.string(),
  launchedCommand: launchAgentSchema,
  resolvedOptions: z.array(z.string()),
  verification: launchVerificationSchema,
});

export const launchResumeMetaSchema = z.object({
  requested: z.boolean(),
  reused: z.boolean(),
  sessionId: z.string().nullable(),
  source: z.enum(["manual", "hook", "lsof", "history"]).nullable(),
  confidence: z.enum(["high", "medium", "low", "none"]),
  policy: launchResumePolicySchema.nullable(),
  fallbackReason: z.enum(["not_found", "ambiguous", "unsupported", "invalid_input"]).optional(),
  failureReason: z.enum(["not_found", "ambiguous", "unsupported", "invalid_input"]).optional(),
});

export const launchCommandResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: launchAgentResultSchema,
    rollback: launchRollbackSchema,
    resume: launchResumeMetaSchema.optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: apiErrorSchema,
    rollback: launchRollbackSchema,
    resume: launchResumeMetaSchema.optional(),
  }),
]);

export const launchConfigSchema = z.object({
  agents: z
    .object({
      codex: z
        .object({
          options: z.array(launchOptionSchema).max(32).default([]),
        })
        .default({ options: [] }),
      claude: z
        .object({
          options: z.array(launchOptionSchema).max(32).default([]),
        })
        .default({ options: [] }),
    })
    .default({
      codex: { options: [] },
      claude: { options: [] },
    }),
});

export const imageAttachmentSchema = z.object({
  path: z.string(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  createdAt: z.string(),
  insertText: z.string(),
});

export const rawItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("key"), value: allowedKeySchema }),
]);

export const promptCompletionTriggerSchema = z.enum(["at", "dollar", "slash"]);

export const promptCompletionItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  insertText: z.string().min(1),
  description: z.string(),
  argumentHint: z.string(),
  kind: z.enum(["skill", "command", "plugin"]),
  scope: z.string().nullable(),
  disabledReason: z.string().optional(),
});

export const promptCompletionResultSchema = z.object({
  items: z.array(promptCompletionItemSchema),
});

export const sessionSummarySchema = z.object({
  paneId: z.string(),
  sessionId: z.string().min(1),
  sessionName: z.string(),
  windowId: z.string().min(1),
  windowIndex: z.number(),
  paneIndex: z.number(),
  paneActive: z.boolean(),
  currentCommand: z.string().nullable(),
  currentPath: z.string().nullable(),
  paneTty: z.string().nullable(),
  title: z.string().nullable(),
  customTitle: z.string().nullable(),
  branch: z.string().nullable().optional(),
  worktreePath: z.string().nullable().optional(),
  worktreeDirty: z.boolean().nullable().optional(),
  worktreeLocked: z.boolean().nullable().optional(),
  worktreeLockOwner: z.string().nullable().optional(),
  worktreeLockReason: z.string().nullable().optional(),
  worktreeMerged: z.boolean().nullable().optional(),
  repoRoot: z.string().nullable(),
  agent: z.enum(["codex", "claude", "unknown"]),
  completion: z
    .object({
      epoch: z.string(),
      completedSeq: z.number().int().nonnegative(),
      acknowledgedSeq: z.number().int().nonnegative(),
    })
    .nullable(),
  state: sessionStateSchema,
  stateReason: z.string(),
  lastMessage: z.string().nullable(),
  lastOutputAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  lastInputAt: z.string().nullable(),
  lastRunStartedAt: z.string().nullable(),
  manualSortAt: z.string().nullable(),
  agentSessionId: z.string().nullable().optional(),
  agentSessionSource: z.enum(["hook", "lsof", "history"]).nullable().optional(),
  agentSessionConfidence: z.enum(["high", "medium", "low"]).nullable().optional(),
  agentSessionObservedAt: z.string().nullable().optional(),
  paneDead: z.boolean(),
  alternateOn: z.boolean(),
  pipeAttached: z.boolean(),
  pipeConflict: z.boolean(),
});

export const sessionDetailSchema = sessionSummarySchema.extend({
  startCommand: z.string().nullable(),
  panePid: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// SSE stream contract (PLAN-20260226-003 v2)
//
// Wire format (text/event-stream):
//   - sessions stream (`GET /api/streams/sessions`):
//       event: sessions / id: <monotonic integer> / data: SessionsStreamEvent JSON
//       Sends type=snapshot immediately after connection. If Last-Event-ID is still in the replay
//       buffer, omits the snapshot and replays only the upsert/remove deltas.
//   - screen stream (`GET /api/streams/sessions/:paneId/screen`):
//       event: screen / data: ScreenResponse JSON
//       Sends a full response immediately after connection, followed by deltas from a server-side
//       cursor. No replay buffer is kept, so reconnecting sends a new full response.
//   - heartbeat: sends event: heartbeat / data: "{}" at a fixed interval.
// ---------------------------------------------------------------------------

export const sessionsStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    serverTime: z.string(),
    sessions: z.array(sessionSummarySchema),
  }),
  z.object({
    type: z.literal("upsert"),
    serverTime: z.string(),
    session: sessionSummarySchema,
  }),
  z.object({
    type: z.literal("remove"),
    serverTime: z.string(),
    paneId: z.string(),
  }),
]);

export const sessionStateTimelineRangeSchema = z.enum([
  "15m",
  "1h",
  "3h",
  "6h",
  "24h",
  "3d",
  "7d",
  "14d",
  "30d",
]);
export const sessionStateTimelineScopeSchema = z.enum(["pane", "repo"]);

export const sessionStateTimelineSourceSchema = z.enum(["poll", "hook", "view", "restore"]);

export const acknowledgeSessionViewRequestSchema = z
  .object({
    epoch: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => {
        for (const character of value) {
          if ((character.codePointAt(0) ?? 128) > 127) {
            return false;
          }
        }
        return true;
      }, "epoch must contain ASCII characters only"),
    throughSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const sessionStateTimelineItemSchema = z.object({
  id: z.string(),
  paneId: z.string(),
  state: sessionStateSchema,
  reason: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number(),
  source: sessionStateTimelineSourceSchema,
});

export const sessionStateTimelineSchema = z.object({
  paneId: z.string(),
  now: z.string(),
  range: sessionStateTimelineRangeSchema,
  items: z.array(sessionStateTimelineItemSchema),
  totalsMs: z.record(sessionStateSchema, z.number()),
  current: sessionStateTimelineItemSchema.nullable(),
});

export const usageProviderIdSchema = z.enum(["claude", "codex", "cursor", "gemini", "unknown"]);
export const usageMetricWindowIdSchema = z.enum(["session", "weekly", "model", "extra"]);
export const usagePaceStatusSchema = z.enum(["margin", "balanced", "over", "unknown"]);
export const usageProviderStatusSchema = z.enum(["ok", "degraded", "error"]);
export const usageCostDataSourceSchema = z.enum(["actual", "estimated", "unavailable"]);
export const usageCostConfidenceSchema = z.enum(["high", "medium", "low"]).nullable();

export const usageMetricWindowSchema = z.object({
  id: usageMetricWindowIdSchema,
  title: z.string(),
  utilizationPercent: z.number().nullable(),
  windowDurationMs: z.number().nullable(),
  resetsAt: z.string().nullable(),
  pace: z.object({
    elapsedPercent: z.number().nullable(),
    projectedEndUtilizationPercent: z.number().nullable(),
    paceMarginPercent: z.number().nullable(),
    status: usagePaceStatusSchema,
  }),
});

export const usageBillingMetaSchema = z.object({
  source: usageCostDataSourceSchema,
  sourceLabel: z.string().nullable(),
  confidence: usageCostConfidenceSchema,
  updatedAt: z.string().nullable(),
  reasonCode: z.string().nullable(),
  reasonMessage: z.string().nullable(),
});

export const usageModelCostItemSchema = z.object({
  modelId: z.string(),
  modelLabel: z.string(),
  resolvedModelId: z.string(),
  resolveStrategy: z.enum(["exact", "prefix", "alias", "fallback"]),
  tokens: z.number().nullable(),
  usd: z.number().nullable(),
  source: usageCostDataSourceSchema,
});

export const usageDailyCostItemSchema = z.object({
  date: z.string(),
  modelIds: z.array(z.string()),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheCreationInputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  usd: z.number().nullable(),
});

export const usageBillingSchema = z.object({
  creditsLeft: z.number().nullable(),
  creditsUnit: z.enum(["tokens", "credits"]).nullable(),
  extraUsageUsedUsd: z.number().nullable(),
  extraUsageLimitUsd: z.number().nullable(),
  costTodayUsd: z.number().nullable(),
  costTodayTokens: z.number().nullable(),
  costLast30DaysUsd: z.number().nullable(),
  costLast30DaysTokens: z.number().nullable(),
  meta: usageBillingMetaSchema,
  modelBreakdown: z.array(usageModelCostItemSchema),
  dailyBreakdown: z.array(usageDailyCostItemSchema),
});

export const usageProviderCapabilitiesSchema = z.object({
  session: z.boolean(),
  weekly: z.boolean(),
  pace: z.boolean(),
  modelWindows: z.boolean(),
  credits: z.boolean(),
  extraUsage: z.boolean(),
  cost: z.boolean(),
});

export const usageIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["warning", "error"]),
});

export const usageProviderSnapshotSchema = z.object({
  providerId: usageProviderIdSchema,
  providerLabel: z.string(),
  accountLabel: z.string().nullable(),
  planLabel: z.string().nullable(),
  windows: z.array(usageMetricWindowSchema),
  billing: usageBillingSchema,
  capabilities: usageProviderCapabilitiesSchema,
  status: usageProviderStatusSchema,
  issues: z.array(usageIssueSchema),
  fetchedAt: z.string(),
  staleAt: z.string(),
});

export const usageDashboardResponseSchema = z.object({
  providers: z.array(usageProviderSnapshotSchema),
  fetchedAt: z.string(),
});

export const usageGlobalTimelineResponseSchema = z.object({
  timeline: sessionStateTimelineSchema,
  paneCount: z.number().int().min(0),
  activePaneCount: z.number().int().min(0),
  fetchedAt: z.string(),
});

export const usageRepositoryActivityItemSchema = z.object({
  repoKey: z.string(),
  repoRoot: z.string(),
  repoName: z.string(),
  activeTimeMs: z.number().nonnegative(),
  agentTimeMs: z.number().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
  lastActiveAt: z.string(),
});

export const usageRepositoryActivityResponseSchema = z.object({
  range: sessionStateTimelineRangeSchema,
  rangeStart: z.string(),
  rangeEnd: z.string(),
  coverage: z.object({
    status: z.enum(["complete", "partial"]),
    trackingStartedAt: z.string(),
    gapDurationMs: z.number().nonnegative(),
    unattributedRunningMs: z.number().nonnegative(),
    unattributedCompletedRunCount: z.number().int().nonnegative(),
    unverifiedCompletedRunCount: z.number().int().nonnegative(),
  }),
  items: z.array(usageRepositoryActivityItemSchema),
  fetchedAt: z.string(),
});

const strictObject = <TShape extends z.ZodRawShape>(shape: TShape) => z.object(shape).strict();

export const highlightCorrectionSchema = strictObject({
  codex: z.boolean(),
  claude: z.boolean(),
});

const externalRootSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\0"), {
    message: "externalRoots must not include null bytes",
  })
  .refine((value) => value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value), {
    message: "externalRoots must contain absolute paths",
  });

export const clientConfigSchema = z.object({
  capabilities: z.object({
    screenImage: z.boolean(),
    launchAgent: z.boolean(),
    resumeAgent: z.boolean(),
  }),
  screen: z.object({
    highlightCorrection: highlightCorrectionSchema,
  }),
  fileNavigator: z.object({
    autoExpandMatchLimit: z.number().int().min(1).max(500),
  }),
  workspaceTabs: z.object({
    displayMode: z.preprocess(
      (value) => (typeof value === "string" ? value.toLowerCase() : value),
      z.enum(["all", "pwa", "none"]),
    ),
  }),
  launch: launchConfigSchema,
});

const notificationsConfigSchema = strictObject({
  pushEnabled: z.boolean(),
  enabledEventTypes: z.array(configPushEventTypeSchema).min(1),
});

export const usageProviderRuleSchema = z.object({
  enabled: z.boolean(),
});

export const usageSessionConfigSchema = z.object({
  providers: z.object({
    codex: usageProviderRuleSchema,
    claude: usageProviderRuleSchema,
  }),
});

export const usagePricingConfigSchema = z.object({
  providers: z.object({
    codex: usageProviderRuleSchema,
    claude: usageProviderRuleSchema,
  }),
});

export const usageConfigSchema = z.object({
  session: usageSessionConfigSchema,
  pricing: usagePricingConfigSchema,
});

const resolvedUsageConfigSchema = strictObject({
  session: strictObject({
    providers: strictObject({
      codex: usageProviderRuleSchema,
      claude: usageProviderRuleSchema,
    }),
  }),
  pricing: strictObject({
    providers: strictObject({
      codex: usageProviderRuleSchema,
      claude: usageProviderRuleSchema,
    }),
  }),
});

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
  herdr_pane: z.string().nullable().optional(),
  cmux_surface: z.string().nullable().optional(),
  transcript_path: z.string().optional(),
  fallback: z
    .object({
      cwd: z.string().optional(),
      transcript_path: z.string().optional(),
    })
    .optional(),
  payload: z.object({ raw: z.string() }),
});

export const codexHookEventSchema = z.object({
  ts: z.string(),
  hook_event_name: z.enum([
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
    "UserPromptSubmit",
  ]),
  session_id: z.string(),
  cwd: z.string().optional(),
  tty: z.string().optional(),
  tmux_pane: z.string().nullable().optional(),
  herdr_pane: z.string().nullable().optional(),
  cmux_surface: z.string().nullable().optional(),
  transcript_path: z.string().optional(),
  fallback: z
    .object({
      cwd: z.string().optional(),
      transcript_path: z.string().optional(),
    })
    .optional(),
  payload: z.object({ raw: z.string() }),
});

export const workspaceTabsDisplayModeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(["all", "pwa", "none"]),
);

const multiplexerConfigSchema = strictObject({
  backend: z.enum(["tmux", "wezterm", "herdr", "cmux"]),
  wezterm: strictObject({
    cliPath: z.string(),
    target: z.string().nullable(),
  }),
  cmux: strictObject({
    cliPath: z.string(),
    socketPath: z.string().nullable(),
    password: z.string().nullable(),
  }),
});

const screenConfigSchema = strictObject({
  maxLines: z.number().int().positive(),
  highlightCorrection: highlightCorrectionSchema,
  image: strictObject({
    backend: z.enum(["alacritty", "terminal", "iterm", "wezterm", "ghostty"]),
  }),
});

const tmuxConfigSchema = strictObject({
  socketName: z.string().nullable(),
  socketPath: z.string().nullable(),
  primaryClient: z.string().nullable(),
});

const workspaceTabsConfigSchema = strictObject({
  displayMode: workspaceTabsDisplayModeSchema,
});

const fileNavigatorConfigSchema = strictObject({
  externalRoots: z.array(externalRootSchema),
  autoExpandMatchLimit: z.number().int().min(1).max(500),
});

export const configSchema = strictObject({
  bind: z.enum(["127.0.0.1", "0.0.0.0"]),
  port: z.number().int().min(1).max(65535),
  allowedOrigins: z.array(z.string()),
  dangerKeys: z.array(z.string()),
  dangerCommandPatterns: z.array(z.string()),
  activity: strictObject({
    pollIntervalMs: z.number().int().positive(),
    runningThresholdMs: z.number().int().nonnegative(),
  }),
  screen: screenConfigSchema,
  multiplexer: multiplexerConfigSchema,
  launch: launchConfigSchema,
  notifications: notificationsConfigSchema,
  usage: resolvedUsageConfigSchema,
  workspaceTabs: workspaceTabsConfigSchema,
  fileNavigator: fileNavigatorConfigSchema,
  tmux: tmuxConfigSchema,
});

export const generatedConfigTemplateSchema = strictObject({
  multiplexer: strictObject({
    backend: z.enum(["tmux", "wezterm", "herdr", "cmux"]),
  }),
  screen: strictObject({
    image: strictObject({
      backend: z.enum(["alacritty", "terminal", "iterm", "wezterm", "ghostty"]),
    }),
  }),
  dangerKeys: z.array(z.string()),
  dangerCommandPatterns: z.array(z.string()),
  launch: launchConfigSchema,
  workspaceTabs: workspaceTabsConfigSchema,
});

export const configOverrideSchema = strictObject({
  bind: z.enum(["127.0.0.1", "0.0.0.0"]).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  dangerKeys: z.array(z.string()).optional(),
  dangerCommandPatterns: z.array(z.string()).optional(),
  activity: strictObject({
    pollIntervalMs: z.number().int().positive().optional(),
    runningThresholdMs: z.number().int().nonnegative().optional(),
  }).optional(),
  screen: strictObject({
    maxLines: z.number().int().positive().optional(),
    highlightCorrection: strictObject({
      codex: z.boolean().optional(),
      claude: z.boolean().optional(),
    }).optional(),
    image: strictObject({
      backend: z.enum(["alacritty", "terminal", "iterm", "wezterm", "ghostty"]).optional(),
    }).optional(),
  }).optional(),
  multiplexer: strictObject({
    backend: z.enum(["tmux", "wezterm", "herdr", "cmux"]).optional(),
    wezterm: strictObject({
      cliPath: z.string().optional(),
      target: z.string().nullable().optional(),
    }).optional(),
    cmux: strictObject({
      cliPath: z.string().optional(),
      socketPath: z.string().nullable().optional(),
    }).optional(),
  }).optional(),
  launch: strictObject({
    agents: strictObject({
      codex: strictObject({
        options: z.array(launchOptionSchema).max(32).optional(),
      }).optional(),
      claude: strictObject({
        options: z.array(launchOptionSchema).max(32).optional(),
      }).optional(),
    }).optional(),
  }).optional(),
  notifications: strictObject({
    pushEnabled: z.boolean().optional(),
    enabledEventTypes: z.array(configPushEventTypeSchema).min(1).optional(),
  }).optional(),
  usage: strictObject({
    session: strictObject({
      providers: strictObject({
        codex: strictObject({
          enabled: z.boolean().optional(),
        }).optional(),
        claude: strictObject({
          enabled: z.boolean().optional(),
        }).optional(),
      }).optional(),
    }).optional(),
    pricing: strictObject({
      providers: strictObject({
        codex: strictObject({
          enabled: z.boolean().optional(),
        }).optional(),
        claude: strictObject({
          enabled: z.boolean().optional(),
        }).optional(),
      }).optional(),
    }).optional(),
  }).optional(),
  workspaceTabs: strictObject({
    displayMode: workspaceTabsDisplayModeSchema.optional(),
  }).optional(),
  fileNavigator: strictObject({
    externalRoots: z.array(externalRootSchema).optional(),
    autoExpandMatchLimit: z.number().int().min(1).max(500).optional(),
  }).optional(),
  tmux: strictObject({
    socketName: z.string().nullable().optional(),
    socketPath: z.string().nullable().optional(),
    primaryClient: z.string().nullable().optional(),
  }).optional(),
});
export const userConfigSchema = configOverrideSchema;
