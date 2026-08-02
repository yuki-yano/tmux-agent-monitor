/**
 * This file contains two categories of types:
 *  1. z.infer aliases – derived from the zod schemas in ./schemas (source of truth for wire shapes).
 *  2. Schema-less hand-written types – git/diff/commit types, RepoFile* types, Worktree*,
 *     RepoNote, ApiEnvelope<T>, ResolvedConfig, and related config types.
 *
 * Note: PaneMeta, HookStateSignal, StateSignals, AgentMonitorConfig, AgentMonitorConfigFile have
 * been moved to @vde-monitor/multiplexer to avoid including server-only types in the shared package.
 */

import type { z } from "zod";

import type {
  acknowledgeSessionViewRequestSchema,
  allowedKeySchema,
  apiErrorSchema,
  claudeHookEventSchema,
  clientConfigSchema,
  codexHookEventSchema,
  commandResponseSchema,
  configOverrideSchema,
  configPushEventTypeSchema,
  generatedConfigTemplateSchema,
  highlightCorrectionSchema,
  imageAttachmentSchema,
  launchAgentResultSchema,
  launchAgentSchema,
  launchCommandResponseSchema,
  launchConfigSchema,
  launchResumeMetaSchema,
  launchResumePolicySchema,
  launchResumeTargetSchema,
  launchRollbackSchema,
  launchVerificationSchema,
  notificationClientInfoSchema,
  notificationSettingsSchema,
  notificationSubscriptionRevokeSchema,
  notificationSubscriptionScopeSchema,
  notificationSubscriptionUpsertSchema,
  promptCompletionItemSchema,
  promptCompletionResultSchema,
  promptCompletionTriggerSchema,
  pushEventTypeSchema,
  pushSubscriptionJsonSchema,
  rawItemSchema,
  screenCaptureMetaSchema,
  screenDeltaSchema,
  screenResponseSchema,
  sessionDetailSchema,
  sessionStateSchema,
  sessionStateTimelineItemSchema,
  sessionStateTimelineRangeSchema,
  sessionStateTimelineSchema,
  sessionStateTimelineScopeSchema,
  sessionStateTimelineSourceSchema,
  sessionSummarySchema,
  sessionsStreamEventSchema,
  usageBillingMetaSchema,
  usageBillingSchema,
  usageConfigSchema,
  usageCostConfidenceSchema,
  usageCostDataSourceSchema,
  usageDailyCostItemSchema,
  usageDashboardResponseSchema,
  usageGlobalTimelineResponseSchema,
  usageIssueSchema,
  usageMetricWindowIdSchema,
  usageMetricWindowSchema,
  usageModelCostItemSchema,
  usagePaceStatusSchema,
  usagePricingConfigSchema,
  usageProviderCapabilitiesSchema,
  usageProviderIdSchema,
  usageProviderRuleSchema,
  usageProviderSnapshotSchema,
  usageProviderStatusSchema,
  usageRepositoryActivityItemSchema,
  usageRepositoryActivityResponseSchema,
  usageSessionConfigSchema,
  workspaceTabsDisplayModeSchema,
} from "./schemas";

// ---- z.infer aliases (derived from schemas in ./schemas) ----

export type SessionStateValue = z.infer<typeof sessionStateSchema>;
export type AllowedKey = z.infer<typeof allowedKeySchema>;
export type RawItem = z.infer<typeof rawItemSchema>;
export type PromptCompletionTrigger = z.infer<typeof promptCompletionTriggerSchema>;
export type PromptCompletionItem = z.infer<typeof promptCompletionItemSchema>;
export type PromptCompletionResult = z.infer<typeof promptCompletionResultSchema>;

export type PushEventType = z.infer<typeof pushEventTypeSchema>;
export type ConfigPushEventType = z.infer<typeof configPushEventTypeSchema>;

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = ApiError["code"];

export type PushSubscriptionJson = z.infer<typeof pushSubscriptionJsonSchema>;
export type NotificationSubscriptionScope = z.infer<typeof notificationSubscriptionScopeSchema>;
export type NotificationClientInfo = z.infer<typeof notificationClientInfoSchema>;
export type NotificationSubscriptionUpsertJson = z.infer<
  typeof notificationSubscriptionUpsertSchema
>;
export type NotificationSubscriptionRevokeJson = z.infer<
  typeof notificationSubscriptionRevokeSchema
>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export type ScreenDelta = z.infer<typeof screenDeltaSchema>;
export type ScreenCaptureMeta = z.infer<typeof screenCaptureMetaSchema>;
export type ScreenResponse = z.infer<typeof screenResponseSchema>;
export type CommandResponse = z.infer<typeof commandResponseSchema>;

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type AcknowledgeSessionViewRequest = z.infer<typeof acknowledgeSessionViewRequestSchema>;

export type SessionsStreamEvent = z.infer<typeof sessionsStreamEventSchema>;

export type SessionStateTimelineRange = z.infer<typeof sessionStateTimelineRangeSchema>;
export type SessionStateTimelineScope = z.infer<typeof sessionStateTimelineScopeSchema>;
export type SessionStateTimelineSource = z.infer<typeof sessionStateTimelineSourceSchema>;
export type SessionStateTimelineItem = z.infer<typeof sessionStateTimelineItemSchema>;
export type SessionStateTimeline = z.infer<typeof sessionStateTimelineSchema>;

export type UsageProviderId = z.infer<typeof usageProviderIdSchema>;
export type UsageMetricWindowId = z.infer<typeof usageMetricWindowIdSchema>;
export type UsageMetricWindow = z.infer<typeof usageMetricWindowSchema>;
export type UsagePaceStatus = z.infer<typeof usagePaceStatusSchema>;
export type UsageCostDataSource = z.infer<typeof usageCostDataSourceSchema>;
export type UsageCostConfidence = z.infer<typeof usageCostConfidenceSchema>;
export type UsageBillingMeta = z.infer<typeof usageBillingMetaSchema>;
export type UsageModelCostItem = z.infer<typeof usageModelCostItemSchema>;
export type UsageDailyCostItem = z.infer<typeof usageDailyCostItemSchema>;
export type UsageBilling = z.infer<typeof usageBillingSchema>;
export type UsageProviderCapabilities = z.infer<typeof usageProviderCapabilitiesSchema>;
export type UsageProviderStatus = z.infer<typeof usageProviderStatusSchema>;
export type UsageIssue = z.infer<typeof usageIssueSchema>;
export type UsageProviderSnapshot = z.infer<typeof usageProviderSnapshotSchema>;
export type UsageDashboardResponse = z.infer<typeof usageDashboardResponseSchema>;
export type UsageGlobalTimelineResponse = z.infer<typeof usageGlobalTimelineResponseSchema>;
export type UsageRepositoryActivityItem = z.infer<typeof usageRepositoryActivityItemSchema>;
export type UsageRepositoryActivityResponse = z.infer<typeof usageRepositoryActivityResponseSchema>;
export type UsageProviderRuleConfig = z.infer<typeof usageProviderRuleSchema>;
export type UsageSessionConfig = z.infer<typeof usageSessionConfigSchema>;
export type UsagePricingConfig = z.infer<typeof usagePricingConfigSchema>;
export type UsageConfig = z.infer<typeof usageConfigSchema>;

export type LaunchAgent = z.infer<typeof launchAgentSchema>;
export type LaunchResumePolicy = z.infer<typeof launchResumePolicySchema>;
export type LaunchResumeTarget = z.infer<typeof launchResumeTargetSchema>;
export type LaunchRollback = z.infer<typeof launchRollbackSchema>;
export type LaunchVerification = z.infer<typeof launchVerificationSchema>;
export type LaunchResumeMeta = z.infer<typeof launchResumeMetaSchema>;
export type LaunchAgentResult = z.infer<typeof launchAgentResultSchema>;
export type LaunchCommandResponse = z.infer<typeof launchCommandResponseSchema>;
export type AgentLaunchOptionsConfig = z.infer<typeof launchConfigSchema>["agents"]["codex"];
export type LaunchConfig = z.infer<typeof launchConfigSchema>;

export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;
export type ClaudeHookEvent = z.infer<typeof claudeHookEventSchema>;
export type CodexHookEvent = z.infer<typeof codexHookEventSchema>;

export type HighlightCorrectionConfig = z.infer<typeof highlightCorrectionSchema>;
export type WorkspaceTabsDisplayMode = z.infer<typeof workspaceTabsDisplayModeSchema>;
export type ClientScreenConfig = z.infer<typeof clientConfigSchema>["screen"];
export type ClientFileNavigatorConfig = z.infer<typeof clientConfigSchema>["fileNavigator"];
export type ClientWorkspaceTabsConfig = z.infer<typeof clientConfigSchema>["workspaceTabs"];
export type ClientCapabilities = z.infer<typeof clientConfigSchema>["capabilities"];
export type ClientConfig = z.infer<typeof clientConfigSchema>;

export type GeneratedConfigTemplate = z.infer<typeof generatedConfigTemplateSchema>;
export type UserConfigReadable = z.infer<typeof configOverrideSchema>;

// ---- Hand-written types (no corresponding zod schema) ----

export type DiffFileStatus = "A" | "M" | "D" | "R" | "C" | "U" | "?";

export type DiffMode = "total" | "committed" | "uncommitted";

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
  reason?: "not_git" | "cwd_unknown" | "default_branch_unavailable" | "error";
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

export type RepoFileNodeKind = "file" | "directory";

export type RepoFileTreeNode = {
  path: string;
  name: string;
  kind: RepoFileNodeKind;
  hasChildren?: boolean;
  isIgnored?: boolean;
};

export type RepoFileTreePage = {
  basePath: string;
  entries: RepoFileTreeNode[];
  nextCursor?: string;
};

export type RepoFileSearchItem = {
  path: string;
  name: string;
  kind: RepoFileNodeKind;
  score: number;
  highlights: number[];
  isIgnored?: boolean;
};

export type RepoFileSearchPage = {
  query: string;
  items: RepoFileSearchItem[];
  nextCursor?: string;
  truncated: boolean;
  totalMatchedCount: number;
};

export type RepoFileLanguageHint =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "yaml"
  | "bash"
  | "markdown"
  | "html"
  | "diff"
  | "dockerfile"
  | "go"
  | "rust"
  | "lua"
  | "toml"
  | "text";

export type RepoFilePreview = {
  token: string;
  url: string;
  mimeType: string;
  expiresAt: string;
};

export type RepoFileContent = {
  path: string;
  sizeBytes: number;
  isBinary: boolean;
  truncated: boolean;
  languageHint: RepoFileLanguageHint | null;
  content: string | null;
  preview?: RepoFilePreview | null;
};

export type WorktreePrStatus = "none" | "open" | "merged" | "closed_unmerged" | "unknown";

export type WorktreeListEntry = {
  path: string;
  branch: string | null;
  dirty: boolean | null;
  locked: boolean | null;
  lockOwner: string | null;
  lockReason: string | null;
  merged: boolean | null;
  prUrl?: string | null;
  prStatus?: WorktreePrStatus | null;
  ahead?: number | null;
  behind?: number | null;
  fileChanges?: {
    add: number;
    m: number;
    d: number;
  } | null;
  additions?: number | null;
  deletions?: number | null;
};

export type WorktreeList = {
  repoRoot: string | null;
  currentPath: string | null;
  baseBranch?: string | null;
  entries: WorktreeListEntry[];
};

export type BranchPrState = "open" | "merged" | "closed_unmerged" | "none";

export type BranchPrInfo = {
  state: BranchPrState;
  url: string | null;
  number: number | null;
};

export type BranchListEntry = {
  name: string;
  current: boolean;
  isDefault: boolean;
  ahead: number | null;
  behind: number | null;
  fileChanges: { add: number; m: number; d: number } | null;
  additions: number | null;
  deletions: number | null;
  merged: boolean | null;
  pr: BranchPrInfo | null;
  worktreePath: string | null;
  committedAt: string | null;
};

export type BranchList = {
  repoRoot: string | null;
  defaultBranch: string | null;
  currentBranch: string | null;
  entries: BranchListEntry[];
};

export type RepoNote = {
  id: string;
  repoRoot: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type FileNavigatorConfig = {
  externalRoots: string[];
  autoExpandMatchLimit: number;
};

export type ApiEnvelope<T> = T & {
  error?: ApiError;
};

export type ResolvedConfig = {
  bind: "127.0.0.1" | "0.0.0.0";
  port: number;
  allowedOrigins: string[];
  dangerKeys: string[];
  dangerCommandPatterns: string[];
  activity: {
    pollIntervalMs: number;
    runningThresholdMs: number;
  };
  screen: {
    maxLines: number;
    highlightCorrection: HighlightCorrectionConfig;
    image: {
      backend: "alacritty" | "terminal" | "iterm" | "wezterm" | "ghostty";
    };
  };
  multiplexer: {
    backend: "tmux" | "wezterm" | "herdr" | "cmux";
    wezterm: {
      cliPath: string;
      target: string | null;
    };
    cmux: {
      cliPath: string;
      socketPath: string | null;
      password: string | null;
    };
  };
  launch: LaunchConfig;
  notifications: {
    pushEnabled: boolean;
    enabledEventTypes: ConfigPushEventType[];
  };
  usage: UsageConfig;
  workspaceTabs: {
    displayMode: WorkspaceTabsDisplayMode;
  };
  fileNavigator: FileNavigatorConfig;
  tmux: { socketName: string | null; socketPath: string | null; primaryClient: string | null };
};
