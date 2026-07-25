import type {
  AllowedKey,
  NotificationSubscriptionRevokeJson,
  NotificationSubscriptionUpsertJson,
  RawItem,
  SessionStateTimelineRange,
  SessionStateTimelineScope,
} from "./types";

export type ApiClientRequestOptions<TRequestInit = unknown> = {
  init?: TRequestInit;
};

export type PaneParam = {
  paneId: string;
};

export type PaneHashParam = PaneParam & {
  hash: string;
};

export type NoteIdParam = PaneParam & {
  noteId: string;
};

export type SubscriptionIdParam = {
  subscriptionId: string;
};

export type ForceQuery = {
  force?: string;
  worktreePath?: string;
  branch?: string;
};

export type DiffFileQuery = ForceQuery & {
  path: string;
  rev?: string;
};

export type CommitLogQuery = ForceQuery & {
  limit?: string;
  skip?: string;
};

export type CommitFileQuery = ForceQuery & {
  path: string;
};

export type ScreenRequestJson = {
  mode?: "text" | "image";
  lines?: number;
  cursor?: string;
};

export type SendTextJson = {
  text: string;
  enter: boolean;
  requestId?: string;
};

export type SendKeysJson = {
  keys: AllowedKey[];
};

export type SendRawJson = {
  items: RawItem[];
  unsafe?: boolean;
};

export type LaunchAgentJson = {
  sessionName: string;
  agent: "codex" | "claude";
  requestId: string;
  windowName?: string;
  cwd?: string;
  agentOptions?: string[];
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeCreateIfMissing?: boolean;
  resumeSessionId?: string;
  resumeFromPaneId?: string;
  resumePolicy?: "required" | "best_effort";
  resumeTarget?: "pane" | "window";
};

export type SessionTitleJson = {
  title: string | null;
};

export type AcknowledgeSessionViewJson = {
  epoch: string;
  throughSeq: number;
};

export type UploadImageForm<TFile = unknown> = {
  image: TFile;
};

export type TimelineQuery = {
  scope?: SessionStateTimelineScope;
  range?: SessionStateTimelineRange;
  limit?: string;
};

export type RepositoryActivityQuery = {
  range?: SessionStateTimelineRange;
};

export type BranchCheckoutJson = { branch: string };
export type BranchCreateJson = { name: string; base?: string };
export type BranchDeleteJson = { name: string; force?: boolean };

export type RepoNotePayloadJson = {
  title: string | null;
  body: string;
};

export type RepoFileTreeQuery = {
  path?: string;
  cursor?: string;
  limit?: string;
  worktreePath?: string;
};

export type RepoFileSearchQuery = {
  q: string;
  cursor?: string;
  limit?: string;
  worktreePath?: string;
  exactReference?: string;
};

export type RepoFileContentQuery = {
  path: string;
  maxBytes?: string;
  worktreePath?: string;
};

export type PromptCompletionQuery = {
  trigger: "at" | "dollar" | "slash";
  q?: string;
};

export type RepoFilePreviewRevokeParam = PaneParam & {
  token: string;
};

type ApiRequest<TArgs, TRequestInit, TResponse> = (
  args: TArgs,
  options?: ApiClientRequestOptions<TRequestInit>,
) => Promise<TResponse>;

type ApiRootGetRequest<TRequestInit, TResponse> = (
  options?: ApiClientRequestOptions<TRequestInit>,
) => Promise<TResponse>;

type SessionApiClient<TRequestInit, TResponse, TFile> = {
  completions: {
    $get: ApiRequest<{ param: PaneParam; query: PromptCompletionQuery }, TRequestInit, TResponse>;
  };
  state: {
    acknowledge: {
      $post: ApiRequest<
        { param: PaneParam; json: AcknowledgeSessionViewJson },
        TRequestInit,
        TResponse
      >;
    };
  };
  focus: { $post: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
  kill: {
    pane: { $post: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
    window: { $post: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
  };
  send: {
    text: { $post: ApiRequest<{ param: PaneParam; json: SendTextJson }, TRequestInit, TResponse> };
    keys: { $post: ApiRequest<{ param: PaneParam; json: SendKeysJson }, TRequestInit, TResponse> };
    raw: { $post: ApiRequest<{ param: PaneParam; json: SendRawJson }, TRequestInit, TResponse> };
  };
  title: {
    $put: ApiRequest<{ param: PaneParam; json: SessionTitleJson }, TRequestInit, TResponse>;
    reset: { $post: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
  };
  touch: { $post: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
  "move-to-top": { $post: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
  attachments: {
    image: {
      $post: ApiRequest<
        { param: PaneParam; form: UploadImageForm<TFile> },
        TRequestInit,
        TResponse
      >;
    };
  };
  screen: {
    $post: ApiRequest<{ param: PaneParam; json: ScreenRequestJson }, TRequestInit, TResponse>;
  };
  diff: {
    $get: ApiRequest<{ param: PaneParam; query: ForceQuery }, TRequestInit, TResponse>;
    file: { $get: ApiRequest<{ param: PaneParam; query: DiffFileQuery }, TRequestInit, TResponse> };
  };
  commits: {
    $get: ApiRequest<{ param: PaneParam; query: CommitLogQuery }, TRequestInit, TResponse>;
    ":hash": {
      $get: ApiRequest<{ param: PaneHashParam; query: ForceQuery }, TRequestInit, TResponse>;
      file: {
        $get: ApiRequest<{ param: PaneHashParam; query: CommitFileQuery }, TRequestInit, TResponse>;
      };
    };
  };
  timeline: {
    $get: ApiRequest<{ param: PaneParam; query: TimelineQuery }, TRequestInit, TResponse>;
  };
  notes: {
    $get: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse>;
    $post: ApiRequest<{ param: PaneParam; json: RepoNotePayloadJson }, TRequestInit, TResponse>;
    ":noteId": {
      $put: ApiRequest<{ param: NoteIdParam; json: RepoNotePayloadJson }, TRequestInit, TResponse>;
      $delete: ApiRequest<{ param: NoteIdParam }, TRequestInit, TResponse>;
    };
  };
  files: {
    tree: {
      $get: ApiRequest<{ param: PaneParam; query: RepoFileTreeQuery }, TRequestInit, TResponse>;
    };
    search: {
      $get: ApiRequest<{ param: PaneParam; query: RepoFileSearchQuery }, TRequestInit, TResponse>;
    };
    content: {
      $get: ApiRequest<{ param: PaneParam; query: RepoFileContentQuery }, TRequestInit, TResponse>;
    };
    preview: {
      ":token": {
        $delete: ApiRequest<{ param: RepoFilePreviewRevokeParam }, TRequestInit, TResponse>;
      };
    };
  };
  branches: {
    $get: ApiRequest<{ param: PaneParam; query: ForceQuery }, TRequestInit, TResponse>;
    $post: ApiRequest<{ param: PaneParam; json: BranchCreateJson }, TRequestInit, TResponse>;
    checkout: {
      $post: ApiRequest<{ param: PaneParam; json: BranchCheckoutJson }, TRequestInit, TResponse>;
    };
    delete: {
      $post: ApiRequest<{ param: PaneParam; json: BranchDeleteJson }, TRequestInit, TResponse>;
    };
  };
  worktrees: { $get: ApiRequest<{ param: PaneParam }, TRequestInit, TResponse> };
};

type NotificationApiClient<TRequestInit, TResponse> = {
  settings: { $get: ApiRootGetRequest<TRequestInit, TResponse> };
  subscriptions: {
    $post: ApiRequest<{ json: NotificationSubscriptionUpsertJson }, TRequestInit, TResponse>;
    revoke: {
      $post: ApiRequest<{ json: NotificationSubscriptionRevokeJson }, TRequestInit, TResponse>;
    };
    ":subscriptionId": {
      $delete: ApiRequest<{ param: SubscriptionIdParam }, TRequestInit, TResponse>;
    };
  };
};

export type ApiClientContract<TRequestInit = unknown, TResponse = unknown, TFile = unknown> = {
  sessions: {
    $get: ApiRootGetRequest<TRequestInit, TResponse>;
    launch: { $post: ApiRequest<{ json: LaunchAgentJson }, TRequestInit, TResponse> };
    ":paneId": SessionApiClient<TRequestInit, TResponse, TFile>;
  };
  notifications: NotificationApiClient<TRequestInit, TResponse>;
};
