import { randomUUID } from "node:crypto";

import type { ScreenResponse } from "@vde-monitor/shared";

import { nowIso } from "../http/helpers.js";
import { buildScreenDeltas, shouldSendFull } from "../screen-diff.js";

type ScreenSnapshot = {
  cursor: string;
  lines: string[];
  alternateOn: boolean;
  truncated: boolean | null;
};

type BuildTextResponseParams = {
  paneId: string;
  lineCount: number;
  screen: string;
  alternateOn: boolean;
  truncated: boolean | null;
  cursor?: string;
  fallbackReason?: "image_failed" | "image_disabled";
};

export type ScreenCache = {
  buildTextResponse: (params: BuildTextResponseParams) => ScreenResponse;
};

export const createScreenCache = (limit = 10): ScreenCache => {
  const screenCache = new Map<string, Map<string, ScreenSnapshot>>();

  const splitScreenLines = (value: string) => value.replace(/\r\n/g, "\n").split("\n");

  const getScreenCacheKey = (paneId: string, lineCount: number) => `${paneId}:text:${lineCount}`;

  const storeScreenSnapshot = (cacheKey: string, snapshot: ScreenSnapshot) => {
    const bucket = screenCache.get(cacheKey) ?? new Map<string, ScreenSnapshot>();
    bucket.set(snapshot.cursor, snapshot);
    while (bucket.size > limit) {
      const oldestKey = bucket.keys().next().value;
      if (!oldestKey) break;
      bucket.delete(oldestKey);
    }
    screenCache.set(cacheKey, bucket);
  };

  const setFullScreenResponse = (response: ScreenResponse, screen: string) => {
    response.full = true;
    response.screen = screen;
    return response;
  };

  const hasSnapshotModeMismatch = (
    previous: ScreenSnapshot,
    alternateOn: boolean,
    truncated: boolean | null,
  ) => previous.alternateOn !== alternateOn || previous.truncated !== truncated;

  const resolvePreviousSnapshot = (
    cursor: string | undefined,
    bucket: Map<string, ScreenSnapshot> | undefined,
  ) => {
    if (!cursor || !bucket) {
      return null;
    }
    return bucket.get(cursor) ?? null;
  };

  const applyFallbackReason = (
    response: ScreenResponse,
    fallbackReason?: "image_failed" | "image_disabled",
  ) => {
    if (fallbackReason) {
      response.fallbackReason = fallbackReason;
    }
    return response;
  };

  const shouldSendFullForMissingSnapshot = (
    cursor: string | undefined,
    previous: ScreenSnapshot | null,
  ) => !cursor || !previous;

  const buildTextResponse = ({
    paneId,
    lineCount,
    screen,
    alternateOn,
    truncated,
    cursor,
    fallbackReason,
  }: BuildTextResponseParams): ScreenResponse => {
    const cacheKey = getScreenCacheKey(paneId, lineCount);
    const bucket = screenCache.get(cacheKey);
    const previous = resolvePreviousSnapshot(cursor, bucket);

    const nextLines = splitScreenLines(screen);
    const nextCursor = randomUUID();
    storeScreenSnapshot(cacheKey, {
      cursor: nextCursor,
      lines: nextLines,
      alternateOn,
      truncated,
    });

    const response: ScreenResponse = {
      ok: true,
      paneId,
      mode: "text",
      capturedAt: nowIso(),
      lines: lineCount,
      truncated,
      alternateOn,
      cursor: nextCursor,
    };
    applyFallbackReason(response, fallbackReason);

    if (shouldSendFullForMissingSnapshot(cursor, previous)) {
      return setFullScreenResponse(response, screen);
    }
    if (!previous) {
      return setFullScreenResponse(response, screen);
    }

    if (hasSnapshotModeMismatch(previous, alternateOn, truncated)) {
      return setFullScreenResponse(response, screen);
    }

    const deltas = buildScreenDeltas(previous.lines, nextLines);
    if (shouldSendFull(previous.lines.length, nextLines.length, deltas)) {
      return setFullScreenResponse(response, screen);
    }

    response.full = false;
    response.deltas = deltas;
    return response;
  };

  return { buildTextResponse };
};
