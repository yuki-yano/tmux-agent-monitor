import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ScreenMode } from "@/lib/screen-loading";
import { useLazyRef } from "@/lib/use-lazy-ref";
import type { ScreenWrapMode } from "../atoms/screenAtoms";
import {
  extractLogReferenceTokensFromLine,
  linkifyLogLineFileReferences,
  linkifyLogLineHttpUrls,
} from "@/features/shared-session-ui/lib/log-file-reference";

const VISIBLE_REFERENCE_LINE_PADDING = 20;
const FALLBACK_VISIBLE_REFERENCE_WINDOW = 120;
const LINE_TOKEN_CACHE_LIMIT = 2000;
const EMPTY_LINKABLE_TOKENS = new Set<string>();

type ScreenRange = { startIndex: number; endIndex: number };

type UseScreenPanelLogReferenceLinkingArgs = {
  mode: ScreenMode;
  effectiveWrapMode: ScreenWrapMode;
  paneId: string;
  sourceRepoRoot: string | null;
  agent: "codex" | "claude" | "unknown";
  screenLines: string[];
  onResolveFileReferenceCandidates: (rawTokens: string[]) => Promise<string[]>;
};

type ResolveContext = {
  paneId: string;
  sourceRepoRoot: string | null;
  agent: "codex" | "claude" | "unknown";
  effectiveWrapMode: ScreenWrapMode;
  referenceCandidateTokens: string[];
  resolver: (rawTokens: string[]) => Promise<string[]>;
};

const areStringArraysEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const isSameResolveContext = (left: ResolveContext, right: ResolveContext) =>
  left.paneId === right.paneId &&
  left.sourceRepoRoot === right.sourceRepoRoot &&
  left.agent === right.agent &&
  left.effectiveWrapMode === right.effectiveWrapMode &&
  left.resolver === right.resolver &&
  areStringArraysEqual(left.referenceCandidateTokens, right.referenceCandidateTokens);

export const useScreenPanelLogReferenceLinking = ({
  mode,
  effectiveWrapMode,
  paneId,
  sourceRepoRoot,
  agent,
  screenLines,
  onResolveFileReferenceCandidates,
}: UseScreenPanelLogReferenceLinkingArgs) => {
  const [linkableTokens, setLinkableTokens] = useState<Set<string>>(new Set());
  const [visibleRange, setVisibleRange] = useState<ScreenRange | null>(null);
  const activeResolveCandidatesRequestIdRef = useRef(0);
  const lastResolveContextRef = useRef<ResolveContext | null>(null);
  const lineTokenCacheRef = useLazyRef(() => new Map<string, string[]>());

  const extractCachedTokensFromLine = useCallback(
    (line: string) => {
      const cache = lineTokenCacheRef.current;
      const cached = cache.get(line);
      if (cached) {
        cache.delete(line);
        cache.set(line, cached);
        return cached;
      }
      const extracted = extractLogReferenceTokensFromLine(line);
      cache.set(line, extracted);
      if (cache.size > LINE_TOKEN_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey != null) {
          cache.delete(oldestKey);
        }
      }
      return extracted;
    },
    [lineTokenCacheRef],
  );

  // react-doctor-disable-next-line no-event-handler
  const visibleRangeForMemo = effectiveWrapMode === "smart" ? null : visibleRange;

  const referenceCandidateTokens = useMemo(() => {
    // react-doctor-disable-next-line no-event-handler
    if (mode !== "text") {
      return [];
    }
    // react-doctor-disable-next-line no-event-handler
    if (screenLines.length === 0) {
      return [];
    }
    const seen = new Set<string>();
    const ordered: string[] = [];
    const maxIndex = screenLines.length - 1;
    const fallbackStart = Math.max(0, maxIndex - FALLBACK_VISIBLE_REFERENCE_WINDOW);
    const startIndex =
      visibleRangeForMemo == null
        ? effectiveWrapMode === "smart"
          ? 0
          : fallbackStart
        : Math.max(0, visibleRangeForMemo.startIndex - VISIBLE_REFERENCE_LINE_PADDING);
    const endIndex =
      visibleRangeForMemo == null
        ? maxIndex
        : Math.min(maxIndex, visibleRangeForMemo.endIndex + VISIBLE_REFERENCE_LINE_PADDING);

    for (let index = endIndex; index >= startIndex; index -= 1) {
      const line = screenLines[index];
      if (!line) {
        continue;
      }
      // oxlint-disable-next-line react/refs -- A bounded deterministic LRU avoids reparsing unchanged log lines.
      const tokens = extractCachedTokensFromLine(line);
      const pathTokens: string[] = [];
      const filenameTokens: string[] = [];
      for (const token of tokens) {
        if (seen.has(token)) {
          continue;
        }
        if (token.includes("/") || token.includes("\\")) {
          pathTokens.push(token);
          continue;
        }
        filenameTokens.push(token);
      }
      for (const token of [...pathTokens, ...filenameTokens]) {
        seen.add(token);
        ordered.push(token);
      }
    }
    return ordered;
  }, [effectiveWrapMode, extractCachedTokensFromLine, mode, screenLines, visibleRangeForMemo]);

  const referenceCandidateTokenSet = useMemo(
    () => new Set(referenceCandidateTokens),
    [referenceCandidateTokens],
  );
  const activeLinkableTokens =
    referenceCandidateTokens.length > 0 ? linkableTokens : EMPTY_LINKABLE_TOKENS;

  useEffect(() => {
    const resolveContext: ResolveContext = {
      paneId,
      sourceRepoRoot,
      agent,
      effectiveWrapMode,
      referenceCandidateTokens,
      resolver: onResolveFileReferenceCandidates,
    };
    const previousResolveContext = lastResolveContextRef.current;
    if (
      previousResolveContext != null &&
      isSameResolveContext(previousResolveContext, resolveContext)
    ) {
      return;
    }
    lastResolveContextRef.current = resolveContext;

    const requestId = activeResolveCandidatesRequestIdRef.current + 1;
    activeResolveCandidatesRequestIdRef.current = requestId;

    if (referenceCandidateTokens.length === 0) {
      return;
    }

    void onResolveFileReferenceCandidates(referenceCandidateTokens)
      .then((resolvedTokens) => {
        if (activeResolveCandidatesRequestIdRef.current !== requestId) {
          return;
        }
        const resolvedTokenSet = new Set(resolvedTokens);
        setLinkableTokens((previous) => {
          const next = new Set<string>();
          referenceCandidateTokens.forEach((token) => {
            if (resolvedTokenSet.has(token) || previous.has(token)) {
              next.add(token);
            }
          });
          if (next.size === previous.size && [...next].every((token) => previous.has(token))) {
            return previous;
          }
          return next;
        });
      })
      .catch(() => {
        if (activeResolveCandidatesRequestIdRef.current !== requestId) {
          return;
        }
        // Restore previous context so identical inputs can retry on the next render cycle.
        lastResolveContextRef.current = previousResolveContext;
        setLinkableTokens((previous) => {
          const next = new Set<string>();
          previous.forEach((token) => {
            if (referenceCandidateTokenSet.has(token)) {
              next.add(token);
            }
          });
          if (next.size === previous.size && [...next].every((token) => previous.has(token))) {
            return previous;
          }
          return next;
        });
      });
  }, [
    agent,
    effectiveWrapMode,
    onResolveFileReferenceCandidates,
    paneId,
    referenceCandidateTokenSet,
    referenceCandidateTokens,
    sourceRepoRoot,
  ]);

  const linkifiedScreenLines = useMemo(() => {
    if (mode !== "text") {
      return screenLines;
    }
    if (
      activeLinkableTokens.size === 0 &&
      screenLines.every((line) => !line.includes("http://") && !line.includes("https://"))
    ) {
      return screenLines;
    }
    return screenLines.map((line) => {
      let linkifiedLine = line;
      if (activeLinkableTokens.size > 0) {
        linkifiedLine = linkifyLogLineFileReferences(linkifiedLine, {
          isLinkableToken: (rawToken) => activeLinkableTokens.has(rawToken),
        });
      }
      if (linkifiedLine.includes("http://") || linkifiedLine.includes("https://")) {
        linkifiedLine = linkifyLogLineHttpUrls(linkifiedLine);
      }
      return linkifiedLine;
    });
  }, [activeLinkableTokens, mode, screenLines]);

  const handleScreenRangeChanged = useCallback(
    (range: ScreenRange) => {
      if (screenLines.length === 0 || range.endIndex < range.startIndex) {
        return;
      }
      setVisibleRange(range);
    },
    [screenLines.length],
  );

  return {
    linkifiedScreenLines,
    handleScreenRangeChanged,
  };
};
