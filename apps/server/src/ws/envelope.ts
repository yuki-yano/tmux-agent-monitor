import type { WsEnvelope } from "@vde-monitor/shared";

import { nowIso } from "../http/helpers.js";

export const buildEnvelope = <TType extends string, TData>(
  type: TType,
  data: TData,
  reqId?: string,
): WsEnvelope<TType, TData> => ({
  type,
  ts: nowIso(),
  reqId,
  data,
});
