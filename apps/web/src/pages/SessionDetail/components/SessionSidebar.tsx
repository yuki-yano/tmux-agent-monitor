import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { Clock } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, LastInputPill, TagPill } from "@/components/ui";
import { renderAnsiLines } from "@/lib/ansi";
import { cn } from "@/lib/cn";
import { agentIconMeta, formatRepoDirLabel, statusIconMeta } from "@/lib/quick-panel-utils";
import type { SessionGroup } from "@/lib/session-group";
import { useSessions } from "@/state/session-context";
import { useTheme } from "@/state/theme-context";

import { useSessionPreview } from "../hooks/useSessionPreview";
import { formatRelativeTime, getLastInputTone } from "../sessionDetailUtils";

type SessionSidebarProps = {
  sessionGroups: SessionGroup[];
  nowMs: number;
  currentPaneId?: string | null;
  className?: string;
};

const surfaceLinkClass =
  "border-latte-surface2/50 bg-latte-crust/60 focus-visible:ring-latte-lavender block w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 hover:shadow-[0_6px_14px_rgba(114,135,253,0.2)] focus-visible:outline-none focus-visible:ring-2";

const PREVIEW_MIN_WIDTH = 640;
const PREVIEW_MAX_WIDTH = 1200;
const PREVIEW_MIN_HEIGHT = 420;
const PREVIEW_MAX_HEIGHT = 760;
const PREVIEW_MARGIN = 16;
const PREVIEW_HEADER_OFFSET = 96;
const PREVIEW_LINE_HEIGHT = 16;
const HOVER_PREVIEW_DELAY_MS = 320;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const SidebarBackdrop = memo(() => (
  <div className="pointer-events-none absolute inset-0">
    <div className="bg-latte-lavender/15 absolute -left-10 top-10 h-32 w-32 rounded-full blur-3xl" />
    <div className="bg-latte-peach/15 absolute -right-12 top-40 h-36 w-36 rounded-full blur-3xl" />
    <div className="from-latte-lavender/70 via-latte-peach/40 absolute left-0 top-0 h-full w-[2px] bg-gradient-to-b to-transparent" />
    <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/5 to-transparent" />
  </div>
));

SidebarBackdrop.displayName = "SidebarBackdrop";

type SidebarHeaderProps = {
  totalSessions: number;
  repoCount: number;
};

const SidebarHeader = memo(({ totalSessions, repoCount }: SidebarHeaderProps) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <p className="text-latte-subtext0 text-[10px] uppercase tracking-[0.45em]">vde-monitor</p>
      <h2 className="font-display text-latte-text text-xl font-semibold">Live Constellation</h2>
    </div>
    <div className="flex flex-col items-end gap-2">
      <TagPill tone="neutral" className="bg-latte-crust/70">
        {totalSessions} Active
      </TagPill>
      <span className="text-latte-subtext0 text-[10px] uppercase tracking-[0.3em]">
        {repoCount} repos
      </span>
    </div>
  </div>
));

SidebarHeader.displayName = "SidebarHeader";

type PreviewFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  lines: number;
};

type SessionSidebarItemProps = {
  item: SessionSummary;
  nowMs: number;
  isCurrent: boolean;
  onHoverStart: (paneId: string) => void;
  onHoverEnd: (paneId: string) => void;
  onFocus: (paneId: string) => void;
  onBlur: (paneId: string) => void;
  onSelect: () => void;
  registerItemRef: (paneId: string, node: HTMLDivElement | null) => void;
};

const SessionSidebarItem = memo(
  ({
    item,
    nowMs,
    isCurrent,
    onHoverStart,
    onHoverEnd,
    onFocus,
    onBlur,
    onSelect,
    registerItemRef,
  }: SessionSidebarItemProps) => {
    const displayTitle = item.customTitle ?? item.title ?? item.sessionName;
    const lastInputTone = getLastInputTone(item.lastInputAt ?? null, nowMs);
    const statusMeta = statusIconMeta(item.state);
    const agentMeta = agentIconMeta(item.agent);
    const StatusIcon = statusMeta.icon;
    const AgentIcon = agentMeta.icon;

    const handleRef = useCallback(
      (node: HTMLDivElement | null) => {
        registerItemRef(item.paneId, node);
      },
      [item.paneId, registerItemRef],
    );

    const handleMouseEnter = useCallback(() => {
      if (!isCurrent) {
        onHoverStart(item.paneId);
      }
    }, [isCurrent, item.paneId, onHoverStart]);

    const handleMouseLeave = useCallback(() => {
      onHoverEnd(item.paneId);
    }, [item.paneId, onHoverEnd]);

    const handleFocus = useCallback(() => {
      if (!isCurrent) {
        onFocus(item.paneId);
      }
    }, [isCurrent, item.paneId, onFocus]);

    const handleBlur = useCallback(() => {
      onBlur(item.paneId);
    }, [item.paneId, onBlur]);

    return (
      <div
        className="relative"
        ref={handleRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
      >
        <Link
          to="/sessions/$paneId"
          params={{ paneId: item.paneId }}
          aria-current={isCurrent ? "page" : undefined}
          onClick={onSelect}
          className={cn(
            surfaceLinkClass,
            "flex flex-col gap-2",
            isCurrent
              ? "border-latte-lavender/80 bg-latte-lavender/20 ring-latte-lavender/40 hover:border-latte-lavender/90 hover:bg-latte-lavender/25 shadow-[0_0_0_1px_rgba(114,135,253,0.45),0_12px_24px_-12px_rgba(114,135,253,0.45)] ring-1 ring-inset"
              : "hover:border-latte-lavender/60 hover:bg-latte-lavender/10",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${statusMeta.wrap}`}
              aria-label={statusMeta.label}
            >
              <StatusIcon className={`h-3.5 w-3.5 ${statusMeta.className}`} />
            </span>
            <span className="text-latte-text min-w-0 truncate text-sm font-semibold">
              {displayTitle}
            </span>
          </div>
          <div className="text-latte-subtext0 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${agentMeta.wrap}`}
              aria-label={agentMeta.label}
            >
              <AgentIcon className={`h-3.5 w-3.5 ${agentMeta.className}`} />
              <span className="text-[9px] uppercase tracking-[0.2em]">{agentMeta.label}</span>
            </span>
            <LastInputPill
              tone={lastInputTone}
              label={<Clock className="h-3 w-3" />}
              srLabel="Last input"
              value={formatRelativeTime(item.lastInputAt, nowMs)}
              size="xs"
              showDot={false}
            />
          </div>
        </Link>
      </div>
    );
  },
);

SessionSidebarItem.displayName = "SessionSidebarItem";

type SessionPreviewPopoverProps = {
  frame: PreviewFrame;
  title: string;
  lines: string[];
  loading: boolean;
  error: string | null;
};

const SessionPreviewPopover = memo(
  ({ frame, title, lines, loading, error }: SessionPreviewPopoverProps) => (
    <div
      className="pointer-events-none fixed z-50 hidden -translate-y-1/2 md:block"
      style={{
        left: frame.left,
        top: frame.top,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
      }}
      aria-hidden="true"
    >
      <div className="border-latte-surface1/70 bg-latte-base/90 relative flex h-full flex-col rounded-2xl border p-4 shadow-[0_20px_60px_-30px_rgba(17,17,27,0.65)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-latte-text truncate text-sm font-semibold">{title}</p>
        </div>
        <div className="border-latte-surface2/70 bg-latte-crust/70 mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border px-3 py-3 font-mono text-[12px] leading-[16px]">
          {loading && <p className="text-latte-subtext0 text-xs">Loading preview...</p>}
          {!loading && error && <p className="text-latte-red text-xs">{error}</p>}
          {!loading && !error && lines.length === 0 && (
            <p className="text-latte-subtext0 text-xs">Preview unavailable.</p>
          )}
          {!loading && !error && lines.length > 0 && (
            <div className="flex min-h-full flex-col justify-end">
              {lines.map((line, index) => (
                <div
                  key={`preview-${index}`}
                  className="whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: line || "&#x200B;" }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="border-latte-surface1/70 bg-latte-base/90 absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t" />
      </div>
    </div>
  ),
);

SessionPreviewPopover.displayName = "SessionPreviewPopover";

export const SessionSidebar = ({
  sessionGroups,
  nowMs,
  currentPaneId,
  className,
}: SessionSidebarProps) => {
  const { connected, connectionIssue, requestScreen, highlightCorrections } = useSessions();
  const { resolvedTheme } = useTheme();
  const { previewCache, previewLoading, previewError, prefetchPreview } = useSessionPreview({
    connected,
    connectionIssue,
    requestScreen,
  });
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrame | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const hoverTimerRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingPreviewPaneRef = useRef<string | null>(null);

  const { totalSessions, repoCount, sessionIndex } = useMemo(() => {
    let total = 0;
    const map = new Map<string, SessionSummary>();
    sessionGroups.forEach((group) => {
      total += group.sessions.length;
      group.sessions.forEach((session) => {
        map.set(session.paneId, session);
      });
    });
    return { totalSessions: total, repoCount: sessionGroups.length, sessionIndex: map };
  }, [sessionGroups]);

  const hoveredSession = hoveredPaneId ? (sessionIndex.get(hoveredPaneId) ?? null) : null;
  const hoveredPreviewEntry = hoveredPaneId ? previewCache[hoveredPaneId] : null;
  const hoveredPreviewText = hoveredPreviewEntry?.screen ?? "";
  const hoveredPreviewLines = useMemo(() => {
    if (!hoveredPaneId || !hoveredPreviewEntry) return [];
    const text = hoveredPreviewText.length > 0 ? hoveredPreviewText : "No log data";
    const agent =
      hoveredSession?.agent === "codex" || hoveredSession?.agent === "claude"
        ? hoveredSession.agent
        : "unknown";
    return renderAnsiLines(text, resolvedTheme, { agent, highlightCorrections });
  }, [
    highlightCorrections,
    hoveredPaneId,
    hoveredPreviewEntry,
    hoveredPreviewText,
    hoveredSession?.agent,
    resolvedTheme,
  ]);
  const hoveredPreviewLoading = hoveredPaneId ? Boolean(previewLoading[hoveredPaneId]) : false;
  const hoveredPreviewError = hoveredPaneId ? (previewError[hoveredPaneId] ?? null) : null;

  const updatePreviewPosition = useCallback((paneId: string) => {
    const node = itemRefs.current.get(paneId);
    if (!node || typeof window === "undefined") return;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.min(PREVIEW_MAX_WIDTH, viewportWidth - 48);
    const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, viewportHeight - 120);
    const width = clamp(Math.round(viewportWidth * 0.56), PREVIEW_MIN_WIDTH, maxWidth);
    const height = clamp(Math.round(viewportHeight * 0.68), PREVIEW_MIN_HEIGHT, maxHeight);
    const bodyHeight = Math.max(
      height - PREVIEW_HEADER_OFFSET,
      PREVIEW_MIN_HEIGHT - PREVIEW_HEADER_OFFSET,
    );
    const lines = Math.max(20, Math.floor(bodyHeight / PREVIEW_LINE_HEIGHT) - 1);

    let left = rect.right + PREVIEW_MARGIN;
    const maxLeft = viewportWidth - width - 24;
    if (left > maxLeft) {
      left = Math.max(24, maxLeft);
    }
    let top = rect.top + rect.height / 2;
    const minTop = height / 2 + 24;
    const maxTop = viewportHeight - height / 2 - 24;
    top = Math.min(Math.max(top, minTop), maxTop);
    setPreviewFrame({ left, top, width, height, lines });
  }, []);

  const schedulePreviewPosition = useCallback(
    (paneId: string) => {
      if (!paneId || typeof window === "undefined") return;
      pendingPreviewPaneRef.current = paneId;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const target = pendingPreviewPaneRef.current;
        if (target) {
          updatePreviewPosition(target);
        }
      });
    },
    [updatePreviewPosition],
  );

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    pendingHoverRef.current = null;
  }, []);

  const clearHoverState = useCallback(
    (paneId: string) => {
      if (pendingHoverRef.current === paneId) {
        clearHoverTimer();
      }
      setHoveredPaneId((prev) => {
        if (prev !== paneId) return prev;
        setPreviewFrame(null);
        return null;
      });
    },
    [clearHoverTimer],
  );

  const registerItemRef = useCallback((paneId: string, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(paneId, node);
    } else {
      itemRefs.current.delete(paneId);
    }
  }, []);

  const handleHoverStart = useCallback(
    (paneId: string) => {
      if (paneId === currentPaneId) return;
      void prefetchPreview(paneId);
      clearHoverTimer();
      pendingHoverRef.current = paneId;
      hoverTimerRef.current = window.setTimeout(() => {
        if (pendingHoverRef.current !== paneId) return;
        setHoveredPaneId(paneId);
        clearHoverTimer();
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [clearHoverTimer, currentPaneId, prefetchPreview],
  );

  const handleHoverEnd = useCallback(
    (paneId: string) => {
      clearHoverState(paneId);
    },
    [clearHoverState],
  );

  const handleFocus = useCallback(
    (paneId: string) => {
      if (paneId === currentPaneId) return;
      clearHoverTimer();
      setHoveredPaneId(paneId);
      void prefetchPreview(paneId);
    },
    [clearHoverTimer, currentPaneId, prefetchPreview],
  );

  const handleBlur = useCallback(
    (paneId: string) => {
      clearHoverState(paneId);
    },
    [clearHoverState],
  );

  const handleSelect = useCallback(() => {
    clearHoverTimer();
    setHoveredPaneId(null);
    setPreviewFrame(null);
  }, [clearHoverTimer]);

  useEffect(() => {
    if (!hoveredPaneId) {
      pendingPreviewPaneRef.current = null;
      setPreviewFrame(null);
      return;
    }
    updatePreviewPosition(hoveredPaneId);
  }, [hoveredPaneId, updatePreviewPosition]);

  useEffect(() => {
    if (!hoveredPaneId) return;
    const handleUpdate = () => schedulePreviewPosition(hoveredPaneId);
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);
    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [hoveredPaneId, schedulePreviewPosition]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
      if (typeof window !== "undefined" && rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [clearHoverTimer]);

  const previewLines = useMemo(() => {
    if (!previewFrame) return [];
    if (hoveredPreviewLines.length === 0) return [];
    return hoveredPreviewLines.slice(-previewFrame.lines);
  }, [hoveredPreviewLines, previewFrame]);

  const previewTitle =
    hoveredSession?.customTitle ??
    hoveredSession?.title ??
    hoveredSession?.sessionName ??
    "Session";

  return (
    <Card
      className={cn(
        "border-latte-surface1/70 bg-latte-mantle/80 relative flex h-full flex-col overflow-hidden p-4 shadow-[0_18px_50px_-25px_rgba(17,17,27,0.6)]",
        className,
      )}
    >
      <SidebarBackdrop />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4">
        <SidebarHeader totalSessions={totalSessions} repoCount={repoCount} />

        <div
          className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto pr-2"
          onScroll={() => {
            if (hoveredPaneId) {
              schedulePreviewPosition(hoveredPaneId);
            }
          }}
        >
          <div className="space-y-4">
            {sessionGroups.length === 0 && (
              <div className="border-latte-surface2/60 bg-latte-crust/50 text-latte-subtext0 rounded-2xl border px-3 py-4 text-center text-xs">
                No sessions available.
              </div>
            )}
            {sessionGroups.map((group) => (
              <div key={group.repoRoot ?? "no-repo"} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-latte-lavender/70 text-[11px] font-semibold uppercase tracking-wider">
                    {formatRepoDirLabel(group.repoRoot)}
                  </p>
                  <TagPill tone="meta" className="text-latte-subtext0 text-[10px] uppercase">
                    {group.sessions.length} sessions
                  </TagPill>
                </div>
                <div className="space-y-2">
                  {group.sessions.map((item) => (
                    <SessionSidebarItem
                      key={item.paneId}
                      item={item}
                      nowMs={nowMs}
                      isCurrent={currentPaneId === item.paneId}
                      onHoverStart={handleHoverStart}
                      onHoverEnd={handleHoverEnd}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      onSelect={handleSelect}
                      registerItemRef={registerItemRef}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {hoveredPaneId && previewFrame && hoveredPaneId !== currentPaneId && (
        <SessionPreviewPopover
          frame={previewFrame}
          title={previewTitle}
          lines={previewLines}
          loading={hoveredPreviewLoading}
          error={hoveredPreviewError ?? null}
        />
      )}
    </Card>
  );
};
