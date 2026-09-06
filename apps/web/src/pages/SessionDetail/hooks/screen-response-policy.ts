import type { ScreenResponse } from "@vde-monitor/shared";

import type { ScreenMode } from "@/lib/screen-loading";

export type ScreenResponseContext = {
  key: string;
  paneId: string;
  mode: ScreenMode;
};
export type AppliedScreenResponse = {
  contextKey: string;
  capturedAtMs: number;
};

export const canAcceptScreenResponse = (
  response: ScreenResponse,
  context: ScreenResponseContext,
  latest: AppliedScreenResponse,
) => {
  if (response.paneId !== context.paneId || response.mode !== context.mode) return false;
  const capturedAtMs = Date.parse(response.capturedAt);
  return (
    Number.isFinite(capturedAtMs) &&
    (latest.contextKey !== context.key || capturedAtMs >= latest.capturedAtMs)
  );
};

export type ScreenRequestBasis = {
  requestId: number | null;
  contextKey: string;
  sseGeneration: number;
  cursor: string | null;
};

// REST can only apply to the same request, context, stream generation, and delta base.
export const isCurrentScreenRequest = (request: ScreenRequestBasis, current: ScreenRequestBasis) =>
  request.requestId === current.requestId &&
  request.contextKey === current.contextKey &&
  request.sseGeneration === current.sseGeneration &&
  request.cursor === current.cursor;
