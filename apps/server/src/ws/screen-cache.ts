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
    const previous = cursor ? bucket?.get(cursor) : null;

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
    if (fallbackReason) {
      response.fallbackReason = fallbackReason;
    }

    if (!cursor || !previous) {
      response.full = true;
      response.screen = screen;
      return response;
    }

    if (previous.alternateOn !== alternateOn || previous.truncated !== truncated) {
      response.full = true;
      response.screen = screen;
      return response;
    }

    const deltas = buildScreenDeltas(previous.lines, nextLines);
    if (shouldSendFull(previous.lines.length, nextLines.length, deltas)) {
      response.full = true;
      response.screen = screen;
      return response;
    }

    response.full = false;
    response.deltas = deltas;
    return response;
  };

  return { buildTextResponse };
};
