import type { AllowedKey, RawItem, SessionStateTimelineRange } from "@vde-monitor/shared";
import { hc } from "hono/client";

import type { ApiAppType } from "../../../server/src/http/api-router";

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

export const createApiClient = (apiBasePath: string, authHeaders: Record<string, string>) =>
  hc<ApiAppType>(apiBasePath, {
    headers: authHeaders,
  });

export type ApiClientContract = ReturnType<typeof createApiClient>;
