import type { InferRequestType } from "hono/client";
import { hc } from "hono/client";

import type { ApiAppType } from "../../../server/src/http/api-router";

export const createApiClient = (apiBasePath: string, authHeaders: Record<string, string>) =>
  hc<ApiAppType>(apiBasePath, {
    headers: authHeaders,
  });

type ApiClientContract = ReturnType<typeof createApiClient>;
type SessionClient = ApiClientContract["sessions"][":paneId"];

export type PaneParam = NonNullable<InferRequestType<SessionClient["focus"]["$post"]>["param"]>;
export type PaneHashParam = NonNullable<
  InferRequestType<SessionClient["commits"][":hash"]["$get"]>["param"]
>;
export type ForceQuery = NonNullable<InferRequestType<SessionClient["diff"]["$get"]>["query"]>;
export type DiffFileQuery = NonNullable<
  InferRequestType<SessionClient["diff"]["file"]["$get"]>["query"]
>;
export type CommitLogQuery = NonNullable<
  InferRequestType<SessionClient["commits"]["$get"]>["query"]
>;
export type CommitFileQuery = NonNullable<
  InferRequestType<SessionClient["commits"][":hash"]["file"]["$get"]>["query"]
>;
export type ScreenRequestJson = NonNullable<
  InferRequestType<SessionClient["screen"]["$post"]>["json"]
>;
export type UploadImageForm = NonNullable<
  InferRequestType<SessionClient["attachments"]["image"]["$post"]>["form"]
>;
export type TimelineQuery = NonNullable<
  InferRequestType<SessionClient["timeline"]["$get"]>["query"]
>;

export type { ApiClientContract };
