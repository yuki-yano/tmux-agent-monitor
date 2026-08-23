import {
  type MouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MonoBlock } from "@/components/ui";
import { cn } from "@/lib/cn";

import { normalizeLogReference } from "@/features/shared-session-ui/lib/log-file-reference";
import { diffLineClass } from "../sessionDetailUtils";

type DiffPatchProps = {
  lines: string[];
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

const TOKEN_PATTERN = /[^\s]+/g;
const FILE_REFERENCE_CLASS_NAME =
  "cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit hover:text-latte-lavender-text focus-visible:text-latte-lavender-text focus-visible:outline-hidden";
const EMPTY_LINKABLE_TOKENS = new Set<string>();

const resolveRawTokenFromEventTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const trigger = target.closest<HTMLElement>("[data-vde-file-ref]");
  return trigger?.dataset.vdeFileRef ?? null;
};

const extractReferenceCandidateTokens = (lines: string[]) => {
  const seen = new Set<string>();
  const ordered: string[] = [];

  lines.forEach((line) => {
    TOKEN_PATTERN.lastIndex = 0;
    let match = TOKEN_PATTERN.exec(line);
    while (match) {
      const rawToken = match[0];
      const reference = normalizeLogReference(rawToken, { sourceRepoRoot: null });
      if (reference.kind !== "unknown" && !seen.has(rawToken)) {
        seen.add(rawToken);
        ordered.push(rawToken);
      }
      match = TOKEN_PATTERN.exec(line);
    }
  });

  return ordered;
};

const areSameStringSet = (left: Set<string>, right: Set<string>) =>
  left.size === right.size && [...left].every((token) => right.has(token));

const renderLineWithFileReferenceLinks = (line: string, linkableTokens: Set<string>): ReactNode => {
  if (line.length === 0) {
    return " ";
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(line);
  while (match) {
    const rawToken = match[0];
    const start = match.index;
    const end = start + rawToken.length;
    if (start > cursor) {
      nodes.push(line.slice(cursor, start));
    }
    if (linkableTokens.has(rawToken)) {
      nodes.push(
        <button
          type="button"
          key={`token-${start}-${rawToken}`}
          data-vde-file-ref={rawToken}
          aria-label={`Open file ${rawToken}`}
          className={FILE_REFERENCE_CLASS_NAME}
        >
          {rawToken}
        </button>,
      );
    } else {
      nodes.push(rawToken);
    }
    cursor = end;
    match = TOKEN_PATTERN.exec(line);
  }

  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }

  return nodes.length > 0 ? <>{nodes}</> : " ";
};

const DiffPatch = memo(
  ({ lines, onResolveFileReference, onResolveFileReferenceCandidates }: DiffPatchProps) => {
    const [linkableTokens, setLinkableTokens] = useState<Set<string>>(new Set());
    const activeResolveCandidatesRequestIdRef = useRef(0);
    const referenceCandidateTokens = useMemo(() => extractReferenceCandidateTokens(lines), [lines]);
    const referenceCandidateTokenSet = useMemo(
      () => new Set(referenceCandidateTokens),
      [referenceCandidateTokens],
    );
    const activeLinkableTokens = useMemo(() => {
      if (!onResolveFileReferenceCandidates || referenceCandidateTokenSet.size === 0) {
        return EMPTY_LINKABLE_TOKENS;
      }
      const activeTokens = new Set<string>();
      linkableTokens.forEach((token) => {
        if (referenceCandidateTokenSet.has(token)) {
          activeTokens.add(token);
        }
      });
      return activeTokens;
    }, [linkableTokens, onResolveFileReferenceCandidates, referenceCandidateTokenSet]);
    const renderedLines = useMemo(() => {
      const lineCounts = new Map<string, number>();
      return lines.map((line) => {
        const count = lineCounts.get(line) ?? 0;
        lineCounts.set(line, count + 1);
        return {
          key: `diff-line-${line}-${count}`,
          className: diffLineClass(line),
          content: renderLineWithFileReferenceLinks(line, activeLinkableTokens),
        };
      });
    }, [activeLinkableTokens, lines]);

    useEffect(() => {
      if (!onResolveFileReferenceCandidates || referenceCandidateTokens.length === 0) {
        return;
      }
      const requestId = activeResolveCandidatesRequestIdRef.current + 1;
      activeResolveCandidatesRequestIdRef.current = requestId;
      let cancelled = false;

      void onResolveFileReferenceCandidates(referenceCandidateTokens)
        .then((resolvedTokens) => {
          if (cancelled || activeResolveCandidatesRequestIdRef.current !== requestId) {
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
            return areSameStringSet(next, previous) ? previous : next;
          });
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
      };
    }, [onResolveFileReferenceCandidates, referenceCandidateTokenSet, referenceCandidateTokens]);

    const handleResolveFileReference = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        if (!onResolveFileReference) {
          return;
        }
        const rawToken = resolveRawTokenFromEventTarget(event.target);
        if (!rawToken || !activeLinkableTokens.has(rawToken)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void onResolveFileReference(rawToken);
      },
      [activeLinkableTokens, onResolveFileReference],
    );

    return (
      <MonoBlock onClick={handleResolveFileReference}>
        {renderedLines.map((line) => (
          <div key={line.key} className={cn(line.className, "-mx-2 block w-full rounded-xs px-2")}>
            {line.content}
          </div>
        ))}
      </MonoBlock>
    );
  },
);

DiffPatch.displayName = "DiffPatch";

export { DiffPatch };
