import type { AllowedKey, RawItem, SessionStateTimelineRange } from "@vde-monitor/shared";

export type PaneParam = { paneId: string };
export type PaneHashParam = { paneId: string; hash: string };
export type ForceQuery = { force?: string };
export type DiffFileQuery = { path: string; rev?: string; force?: string };
export type CommitLogQuery = { limit?: string; skip?: string; force?: string };
export type CommitFileQuery = { path: string; force?: string };
export type TimelineQuery = { range?: SessionStateTimelineRange; limit?: string };
export type ScreenRequestJson = { mode?: "text" | "image"; lines?: number; cursor?: string };
export type SendTextJson = { text: string; enter: boolean };
export type SendKeysJson = { keys: AllowedKey[] };
export type SendRawJson = { items: RawItem[]; unsafe: boolean };
export type UpdateTitleJson = { title: string | null };
export type UploadImageForm = { image: File | Blob };

export type ApiClientContract = {
  sessions: {
    $get: () => Promise<Response>;
    ":paneId": {
      diff: {
        $get: (args: { param: PaneParam; query: ForceQuery }) => Promise<Response>;
        file: {
          $get: (args: { param: PaneParam; query: DiffFileQuery }) => Promise<Response>;
        };
      };
      commits: {
        $get: (args: { param: PaneParam; query: CommitLogQuery }) => Promise<Response>;
        ":hash": {
          $get: (args: { param: PaneHashParam; query: ForceQuery }) => Promise<Response>;
          file: {
            $get: (args: { param: PaneHashParam; query: CommitFileQuery }) => Promise<Response>;
          };
        };
      };
      timeline: {
        $get: (args: { param: PaneParam; query: TimelineQuery }) => Promise<Response>;
      };
      screen: {
        $post: (args: { param: PaneParam; json: ScreenRequestJson }) => Promise<Response>;
      };
      focus: {
        $post: (args: { param: PaneParam }) => Promise<Response>;
      };
      attachments: {
        image: {
          $post: (args: { param: PaneParam; form: UploadImageForm }) => Promise<Response>;
        };
      };
      send: {
        text: {
          $post: (args: { param: PaneParam; json: SendTextJson }) => Promise<Response>;
        };
        keys: {
          $post: (args: { param: PaneParam; json: SendKeysJson }) => Promise<Response>;
        };
        raw: {
          $post: (args: { param: PaneParam; json: SendRawJson }) => Promise<Response>;
        };
      };
      title: {
        $put: (args: { param: PaneParam; json: UpdateTitleJson }) => Promise<Response>;
      };
      touch: {
        $post: (args: { param: PaneParam }) => Promise<Response>;
      };
    };
  };
};
