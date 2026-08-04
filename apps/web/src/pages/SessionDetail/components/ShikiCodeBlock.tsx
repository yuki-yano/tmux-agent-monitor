import DOMPurify from "dompurify";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button, Callout, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { highlightCode, peekHighlightedCode, resetShikiHighlighter } from "@/lib/shiki/highlighter";
import type { Theme } from "@/lib/theme";

type ShikiCodeBlockProps = {
  code: string;
  language: string | null;
  theme: Theme;
  flush?: boolean;
  showLineNumbers?: boolean;
  highlightLine?: number | null;
  className?: string;
};

export const ShikiCodeBlock = ({
  code,
  language,
  theme,
  flush = false,
  showLineNumbers = false,
  highlightLine = null,
  className,
}: ShikiCodeBlockProps) => {
  const normalizedCode = useMemo(() => code.replace(/\n$/, ""), [code]);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const horizontalScrollRef = useRef(0);
  const verticalScrollRef = useRef(0);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    horizontalScrollRef.current = scroller.scrollLeft;
    verticalScrollRef.current = scroller.scrollTop;
  }, []);

  useLayoutEffect(() => {
    horizontalScrollRef.current = 0;
    verticalScrollRef.current = 0;
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
    }
    setError(null);
    const cached = peekHighlightedCode({
      code: normalizedCode,
      lang: language,
      theme,
    });
    setHtml(cached?.html ?? null);
  }, [language, normalizedCode, retryToken, theme]);

  useEffect(() => {
    let alive = true;
    void highlightCode({
      code: normalizedCode,
      lang: language,
      theme,
    })
      .then((result) => {
        if (!alive) {
          return;
        }
        setHtml(result.html);
      })
      .catch(() => {
        if (!alive) {
          return;
        }
        setError("Failed to initialize syntax highlighting. Showing plain text.");
      });
    return () => {
      alive = false;
    };
  }, [language, normalizedCode, retryToken, theme]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    if (horizontalScrollRef.current > 0) {
      scroller.scrollLeft = horizontalScrollRef.current;
    }
    if (verticalScrollRef.current > 0) {
      scroller.scrollTop = verticalScrollRef.current;
    }
  }, [error, html]);

  const containerClassName = flush
    ? "text-latte-text custom-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain"
    : "text-latte-text bg-latte-crust/80 custom-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl";

  const shikiClassName = flush
    ? "min-h-full [&_.shiki]:m-0 [&_.shiki]:min-h-full [&_.shiki]:w-max [&_.shiki]:min-w-full [&_.shiki]:overflow-visible [&_.shiki]:rounded-none [&_.shiki]:px-2 [&_.shiki]:py-1.5 [&_.shiki]:font-mono [&_.shiki]:text-xs [&_.shiki]:leading-5"
    : "min-h-full [&_.shiki]:m-0 [&_.shiki]:min-h-full [&_.shiki]:w-max [&_.shiki]:min-w-full [&_.shiki]:overflow-visible [&_.shiki]:rounded-xl [&_.shiki]:p-3 [&_.shiki]:font-mono [&_.shiki]:text-xs [&_.shiki]:leading-5";

  const fallbackPreClassName = flush
    ? "m-0 min-h-full w-max min-w-full whitespace-pre px-2 py-1.5 font-mono text-xs leading-5"
    : "m-0 min-h-full w-max min-w-full whitespace-pre p-3 font-mono text-xs leading-5";
  const emptyLineMarker = "\u200B";
  const fallbackLines = useMemo(() => normalizedCode.split("\n"), [normalizedCode]);
  const applyHighlightToHtml = useCallback(
    (sourceHtml: string) => {
      if (highlightLine == null || highlightLine <= 0 || typeof DOMParser === "undefined") {
        return sourceHtml;
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${sourceHtml}</div>`, "text/html");
      const container = doc.body.firstElementChild;
      if (!container) {
        return sourceHtml;
      }
      const lines = Array.from(container.querySelectorAll<HTMLElement>(".line"));
      const target = lines[highlightLine - 1];
      if (!target) {
        return sourceHtml;
      }
      target.classList.add("vde-shiki-target-line");
      target.dataset.vdeTargetLine = "true";
      return container.innerHTML;
    },
    [highlightLine],
  );

  const highlightedHtml = useMemo(() => {
    if (!html) {
      return null;
    }
    const normalized = showLineNumbers
      ? html
          .replace(/<span class="line"><\/span>/g, `<span class="line">${emptyLineMarker}</span>`)
          .replace(/<\/span>\n<span class="line">/g, '</span><span class="line">')
          .replace(/<\/span>\n<\/code>/g, "</span></code>")
      : html;
    return applyHighlightToHtml(normalized);
  }, [applyHighlightToHtml, emptyLineMarker, html, showLineNumbers]);
  const sanitizedHighlightedHtml = useMemo(
    () => (highlightedHtml ? DOMPurify.sanitize(highlightedHtml) : null),
    [highlightedHtml],
  );

  useLayoutEffect(() => {
    if (highlightLine == null || highlightLine <= 0) {
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const target = scroller.querySelector<HTMLElement>(".vde-shiki-target-line");
    if (!target) {
      return;
    }
    const top = Math.max(target.offsetTop - scroller.clientHeight * 0.3, 0);
    scroller.scrollTo({
      top,
      left: 0,
      behavior: "auto",
    });
  }, [error, highlightLine, sanitizedHighlightedHtml]);

  const fallbackLinesContent = useMemo(() => {
    const lineCounts = new Map<string, number>();
    return fallbackLines.map((line, index) => (
      <span
        key={(() => {
          const count = lineCounts.get(line) ?? 0;
          lineCounts.set(line, count + 1);
          return `fallback-line-${line}-${count}`;
        })()}
        className={cn(
          "line block min-w-max",
          highlightLine === index + 1 ? "vde-shiki-target-line" : "",
          showLineNumbers ? "" : "pl-0",
        )}
      >
        {line || emptyLineMarker}
      </span>
    ));
  }, [emptyLineMarker, fallbackLines, highlightLine, showLineNumbers]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", error ? "gap-2" : "gap-0", className)}>
      {error ? (
        <Callout tone="warning" size="xs">
          {error}
        </Callout>
      ) : null}
      <div ref={scrollerRef} onScroll={handleScroll} className={containerClassName}>
        {sanitizedHighlightedHtml && !error ? (
          <div
            className={cn(shikiClassName, showLineNumbers ? "vde-shiki-with-line-numbers" : "")}
            dangerouslySetInnerHTML={{ __html: sanitizedHighlightedHtml }}
          />
        ) : error ? (
          <pre
            className={cn(
              fallbackPreClassName,
              showLineNumbers ? "vde-shiki-with-line-numbers" : "",
            )}
          >
            <code>{fallbackLinesContent}</code>
          </pre>
        ) : (
          <div className="text-latte-subtext0 flex h-full min-h-[120px] items-center justify-center">
            <Spinner size="sm" />
          </div>
        )}
      </div>
      {error ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            resetShikiHighlighter();
            setRetryToken((prev) => prev + 1);
          }}
          className="h-7 self-start text-xs"
        >
          Retry highlight
        </Button>
      ) : null}
    </div>
  );
};
