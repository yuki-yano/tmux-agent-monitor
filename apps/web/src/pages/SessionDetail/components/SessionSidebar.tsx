import { Link } from "@tanstack/react-router";
import type {
  HighlightCorrectionConfig,
  ScreenResponse,
  SessionStateTimeline,
  SessionStateTimelineRange,
  SessionStateValue,
  SessionSummary,
} from "@vde-monitor/shared";
import { Clock, Pin, SquareTerminal } from "lucide-react";
import { memo, type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge,
  Card,
  FilterToggleGroup,
  IconButton,
  LastInputPill,
  TagPill,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRepoDirLabel, statusIconMeta } from "@/lib/quick-panel-utils";
import { buildSessionGroups, type SessionGroup } from "@/lib/session-group";
import type { Theme } from "@/lib/theme";
import {
  buildSessionWindowGroups,
  type SessionWindowGroup,
} from "@/pages/SessionList/session-window-group";
import {
  DEFAULT_SESSION_LIST_FILTER,
  isSessionListFilter,
  matchesSessionListFilter,
  SESSION_LIST_FILTER_VALUES,
  type SessionListFilter,
} from "@/pages/SessionList/sessionListFilters";
import {
  createRepoPinKey,
  readStoredSessionListPins,
  storeSessionListPins,
  touchSessionListPin,
} from "@/pages/SessionList/sessionListPins";

import { type PreviewFrame, useSidebarPreview } from "../hooks/useSidebarPreview";
import {
  agentLabelFor,
  agentToneFor,
  formatRelativeTime,
  formatStateLabel,
  getLastInputTone,
  isEditorCommand,
  isKnownAgent,
} from "../sessionDetailUtils";
import { buildTimelineDisplay } from "./state-timeline-display";

type SessionSidebarState = {
  sessionGroups: SessionGroup[];
  nowMs: number;
  connected: boolean;
  connectionIssue: string | null;
  requestStateTimeline: (
    paneId: string,
    options?: { range?: SessionStateTimelineRange; limit?: number },
  ) => Promise<SessionStateTimeline>;
  requestScreen: (
    paneId: string,
    options: { lines?: number; mode?: "text" | "image"; cursor?: string },
  ) => Promise<ScreenResponse>;
  highlightCorrections: HighlightCorrectionConfig;
  resolvedTheme: Theme;
  currentPaneId?: string | null;
  className?: string;
};

type SessionSidebarActions = {
  onSelectSession?: (paneId: string) => void;
  onFocusPane?: (paneId: string) => Promise<void> | void;
  onTouchSession?: (paneId: string) => void;
};

type SessionSidebarProps = {
  state: SessionSidebarState;
  actions: SessionSidebarActions;
};

const surfaceLinkClass =
  "border-latte-surface2/70 bg-latte-base/70 focus-visible:ring-latte-lavender block w-full rounded-2xl border px-3 py-3.5 text-left transition-all duration-200 hover:border-latte-lavender/50 hover:bg-latte-mantle/70 hover:shadow-[0_8px_18px_-10px_rgba(114,135,253,0.35)] focus-visible:outline-none focus-visible:ring-2";

const sidebarSessionBorderClassByState: Record<SessionSummary["state"], string> = {
  RUNNING: "border-green-500/50",
  WAITING_INPUT: "border-amber-500/50",
  WAITING_PERMISSION: "border-red-500/50",
  SHELL: "border-blue-500/50",
  UNKNOWN: "border-gray-400/50",
};

const sidebarEditorSessionBorderClass = "border-latte-maroon/55";

const SidebarBackdrop = memo(() => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-none rounded-r-3xl">
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
      <h2 className="font-display text-latte-text text-xl font-semibold">Live Sessions</h2>
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

const SIDEBAR_FILTER_OPTIONS = SESSION_LIST_FILTER_VALUES.map((value) => ({
  value,
  label: value.replace("_", " "),
}));

type SessionSidebarItemProps = {
  item: SessionSummary;
  nowMs: number;
  isCurrent: boolean;
  isFocusPending: boolean;
  onHoverStart: (paneId: string) => void;
  onHoverEnd: (paneId: string) => void;
  onFocus: (paneId: string) => void;
  onBlur: (paneId: string) => void;
  onSelect: () => void;
  onFocusPane?: (paneId: string) => Promise<void> | void;
  onTouchSession?: (paneId: string) => void;
  registerItemRef: (paneId: string, node: HTMLDivElement | null) => void;
};

const SessionSidebarItem = memo(
  ({
    item,
    nowMs,
    isCurrent,
    isFocusPending,
    onHoverStart,
    onHoverEnd,
    onFocus,
    onBlur,
    onSelect,
    onFocusPane,
    onTouchSession,
    registerItemRef,
  }: SessionSidebarItemProps) => {
    const displayTitle = item.customTitle ?? item.title ?? item.sessionName;
    const lastInputTone = getLastInputTone(item.lastInputAt ?? null, nowMs);
    const showEditorState = item.state === "UNKNOWN" && isEditorCommand(item.currentCommand);
    const statusMeta = showEditorState
      ? {
          ...statusIconMeta("UNKNOWN"),
          className: "text-latte-maroon",
          wrap: "border-latte-maroon/45 bg-latte-maroon/14",
          label: "EDITOR",
        }
      : statusIconMeta(item.state);
    const sessionBorderClass = showEditorState
      ? sidebarEditorSessionBorderClass
      : sidebarSessionBorderClassByState[item.state];
    const StatusIcon = statusMeta.icon;

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

    const handleFocusButtonClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!onFocusPane || isFocusPending) {
          return;
        }
        void onFocusPane(item.paneId);
      },
      [isFocusPending, item.paneId, onFocusPane],
    );

    const handlePinButtonClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onTouchSession?.(item.paneId);
      },
      [item.paneId, onTouchSession],
    );

    return (
      <div
        className="flex items-center gap-2"
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
            "min-w-0 flex-1 flex-col gap-3",
            sessionBorderClass,
            isCurrent
              ? "bg-latte-lavender/20 ring-latte-lavender/40 hover:bg-latte-lavender/25 shadow-[0_0_0_1px_rgba(114,135,253,0.45),0_12px_24px_-12px_rgba(114,135,253,0.45)] ring-1 ring-inset"
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isKnownAgent(item.agent) && (
              <Badge tone={agentToneFor(item.agent)} size="sm">
                {agentLabelFor(item.agent)}
              </Badge>
            )}
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
        {onTouchSession || onFocusPane ? (
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {onTouchSession ? (
              <IconButton
                type="button"
                size="md"
                variant="base"
                aria-label="Pin pane to top"
                title="Pin pane to top"
                className="border-latte-lavender/35 bg-latte-base/90 text-latte-lavender hover:bg-latte-lavender/12 h-8 w-8"
                onClick={handlePinButtonClick}
              >
                <Pin className="h-4 w-4" />
              </IconButton>
            ) : null}
            {onFocusPane ? (
              <IconButton
                type="button"
                size="md"
                variant="lavender"
                aria-label="Focus terminal pane"
                title="Focus terminal pane"
                className="h-8 w-8"
                onClick={handleFocusButtonClick}
                disabled={isFocusPending}
              >
                <SquareTerminal className="h-4 w-4" />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);

SessionSidebarItem.displayName = "SessionSidebarItem";

type SessionPreviewPopoverProps = {
  frame: PreviewFrame;
  title: string;
  sessionName: string | null;
  windowIndex: number | null;
  paneId: string;
  lines: string[];
  loading: boolean;
  error: string | null;
  timeline: SessionStateTimeline | null;
  timelineLoading: boolean;
  timelineError: string | null;
};

const SEGMENT_COLOR_CLASS: Record<SessionStateValue, string> = {
  RUNNING: "bg-latte-green/80",
  WAITING_INPUT: "bg-latte-peach/80",
  WAITING_PERMISSION: "bg-latte-red/80",
  SHELL: "bg-latte-blue/80",
  UNKNOWN: "bg-latte-overlay0/80",
};

const resolveSegmentWidthPercent = (durationMs: number, totalDurationMs: number) => {
  if (durationMs <= 0 || totalDurationMs <= 0) {
    return 0;
  }
  return (durationMs / totalDurationMs) * 100;
};

const SessionPreviewMeta = ({
  sessionName,
  windowIndex,
}: {
  sessionName: string | null;
  windowIndex: number | null;
}) => (
  <div className="mt-1 flex flex-wrap items-center gap-1.5">
    {sessionName && <TagPill tone="meta">Session {sessionName}</TagPill>}
    {windowIndex != null && <TagPill tone="meta">Window {windowIndex}</TagPill>}
  </div>
);

const SessionPreviewTimeline = ({
  timeline,
  timelineLoading,
  timelineError,
}: {
  timeline: SessionStateTimeline | null;
  timelineLoading: boolean;
  timelineError: string | null;
}) => {
  const timelineDisplay = useMemo(
    () => buildTimelineDisplay(timeline, timeline?.range ?? "1h", { compact: true }),
    [timeline],
  );
  const timelineSegments = useMemo(() => {
    const items = [...timelineDisplay.items]
      .filter((item) => item.durationMs > 0)
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
    const totalDurationMs = items.reduce((total, item) => total + item.durationMs, 0);
    return items.map((item) => ({
      id: item.id,
      state: item.state,
      width: resolveSegmentWidthPercent(item.durationMs, totalDurationMs),
    }));
  }, [timelineDisplay.items]);
  const currentLabel = timelineDisplay.current
    ? formatStateLabel(timelineDisplay.current.state)
    : null;

  return (
    <div className="border-latte-surface1/80 bg-latte-mantle rounded-xl border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <TagPill tone="meta">State Timeline</TagPill>
        <TagPill tone="meta">Range {timeline?.range ?? "1h"}</TagPill>
        {currentLabel ? <TagPill tone="meta">Current {currentLabel}</TagPill> : null}
      </div>
      {timelineError ? (
        <p className="text-latte-red text-xs">{timelineError}</p>
      ) : timelineLoading && !timeline ? (
        <p className="text-latte-subtext0 text-xs">Loading timeline...</p>
      ) : timelineSegments.length > 0 ? (
        <div className="border-latte-surface2 bg-latte-surface0 flex h-2 overflow-hidden rounded-full border">
          {timelineSegments.map((segment) => (
            <div
              key={segment.id}
              className={SEGMENT_COLOR_CLASS[segment.state]}
              style={{ width: `${segment.width}%` }}
            />
          ))}
        </div>
      ) : (
        <p className="text-latte-subtext0 text-xs">No timeline events in this range.</p>
      )}
    </div>
  );
};

const SessionPreviewBody = ({
  lines,
  loading,
  error,
  timeline,
  timelineLoading,
  timelineError,
}: {
  lines: string[];
  loading: boolean;
  error: string | null;
  timeline: SessionStateTimeline | null;
  timelineLoading: boolean;
  timelineError: string | null;
}) => {
  const previewBodyClassName =
    "border-latte-surface1/80 bg-latte-crust text-latte-text min-h-0 flex-1 overflow-hidden rounded-xl border px-3 py-3 font-mono text-[12px] leading-[16px]";
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
      <SessionPreviewTimeline
        timeline={timeline}
        timelineLoading={timelineLoading}
        timelineError={timelineError}
      />
      <div className={previewBodyClassName}>
        {loading ? (
          <p className="text-latte-subtext0 text-xs">Loading preview...</p>
        ) : error ? (
          <p className="text-latte-red text-xs">{error}</p>
        ) : lines.length === 0 ? (
          <p className="text-latte-subtext0 text-xs">Preview unavailable.</p>
        ) : (
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
    </div>
  );
};

const SessionPreviewPopover = memo(
  ({
    frame,
    title,
    sessionName,
    windowIndex,
    paneId,
    lines,
    loading,
    error,
    timeline,
    timelineLoading,
    timelineError,
  }: SessionPreviewPopoverProps) => (
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
      <div className="border-latte-surface1/80 bg-latte-base relative flex h-full flex-col rounded-2xl border p-4 shadow-[0_30px_80px_-30px_rgba(17,17,27,0.75)]">
        <div className="from-latte-lavender/12 absolute inset-x-0 top-0 h-14 rounded-t-2xl bg-gradient-to-b to-transparent" />
        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-latte-subtext0 text-[10px] uppercase tracking-[0.28em]">
              Live Preview
            </p>
            <p className="text-latte-text truncate text-sm font-semibold">{title}</p>
          </div>
          <TagPill tone="meta">Pane {paneId}</TagPill>
        </div>
        <SessionPreviewMeta sessionName={sessionName} windowIndex={windowIndex} />
        <div className="border-latte-surface1/80 mt-2 border-t" />
        <SessionPreviewBody
          lines={lines}
          loading={loading}
          error={error}
          timeline={timeline}
          timelineLoading={timelineLoading}
          timelineError={timelineError}
        />
        <div className="border-latte-surface1/80 bg-latte-base absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t" />
      </div>
    </div>
  ),
);

SessionPreviewPopover.displayName = "SessionPreviewPopover";

export const SessionSidebar = ({ state, actions }: SessionSidebarProps) => {
  const {
    sessionGroups,
    nowMs,
    connected,
    connectionIssue,
    requestStateTimeline,
    requestScreen,
    highlightCorrections,
    resolvedTheme,
    currentPaneId,
    className,
  } = state;
  const { onSelectSession, onFocusPane, onTouchSession } = actions;
  const [filter, setFilter] = useState<SessionListFilter>(DEFAULT_SESSION_LIST_FILTER);
  const [pins, setPins] = useState(() => readStoredSessionListPins());
  const [focusPendingPaneIds, setFocusPendingPaneIds] = useState<Set<string>>(() => new Set());
  const repoPinValues = pins.repos;

  useEffect(() => {
    storeSessionListPins(pins);
  }, [pins]);

  const getRepoPinnedAt = useCallback(
    (repoRoot: string | null) => repoPinValues[createRepoPinKey(repoRoot)] ?? null,
    [repoPinValues],
  );

  const filteredSessions = useMemo(
    () =>
      sessionGroups
        .flatMap((group) => group.sessions)
        .filter((session) => matchesSessionListFilter(session, filter)),
    [filter, sessionGroups],
  );
  const paneRepoRootMap = useMemo(
    () =>
      new Map(
        sessionGroups
          .flatMap((group) => group.sessions)
          .map((session) => [session.paneId, session.repoRoot ?? null] as const),
      ),
    [sessionGroups],
  );

  const filteredSessionGroups = useMemo(() => {
    return buildSessionGroups(filteredSessions, { getRepoPinnedAt });
  }, [filteredSessions, getRepoPinnedAt]);

  const sidebarGroups = useMemo(() => {
    return filteredSessionGroups
      .map((group) => {
        const windowGroups = buildSessionWindowGroups(group.sessions);
        if (windowGroups.length === 0) {
          return null;
        }
        return {
          repoRoot: group.repoRoot,
          windowGroups,
        };
      })
      .filter(
        (
          group,
        ): group is { repoRoot: SessionGroup["repoRoot"]; windowGroups: SessionWindowGroup[] } =>
          Boolean(group),
      );
  }, [filteredSessionGroups]);

  const { totalSessions, repoCount, sessionIndex } = useMemo(() => {
    let total = 0;
    const map = new Map<string, SessionSummary>();
    sidebarGroups.forEach((group) => {
      group.windowGroups.forEach((windowGroup) => {
        total += windowGroup.sessions.length;
        windowGroup.sessions.forEach((session) => {
          map.set(session.paneId, session);
        });
      });
    });
    return { totalSessions: total, repoCount: sidebarGroups.length, sessionIndex: map };
  }, [sidebarGroups]);

  const {
    preview,
    handleHoverStart,
    handleHoverEnd,
    handleFocus,
    handleBlur,
    handleSelect: handlePreviewSelect,
    handleListScroll,
    registerItemRef,
  } = useSidebarPreview({
    sessionIndex,
    currentPaneId,
    connected,
    connectionIssue,
    requestStateTimeline,
    requestScreen,
    resolvedTheme,
    highlightCorrections,
  });

  const handleSelect = useCallback(
    (paneId: string) => {
      onSelectSession?.(paneId);
      handlePreviewSelect();
    },
    [handlePreviewSelect, onSelectSession],
  );

  const handleFocusPane = useCallback(
    async (paneId: string) => {
      if (!onFocusPane) {
        return;
      }
      setFocusPendingPaneIds((prev) => {
        if (prev.has(paneId)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(paneId);
        return next;
      });
      try {
        await onFocusPane(paneId);
      } catch {
        // Best-effort UI action: ignore unexpected handler failures.
      } finally {
        setFocusPendingPaneIds((prev) => {
          if (!prev.has(paneId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(paneId);
          return next;
        });
      }
    },
    [onFocusPane],
  );

  const handleFilterChange = useCallback((next: string) => {
    if (!isSessionListFilter(next)) {
      setFilter(DEFAULT_SESSION_LIST_FILTER);
      return;
    }
    setFilter(next);
  }, []);

  const handleToggleRepoPin = useCallback((repoRoot: string | null) => {
    setPins((prev) => touchSessionListPin(prev, "repos", createRepoPinKey(repoRoot)));
  }, []);

  const handleTouchPane = useCallback(
    (paneId: string) => {
      if (paneRepoRootMap.has(paneId)) {
        const repoRoot = paneRepoRootMap.get(paneId) ?? null;
        setPins((prev) => touchSessionListPin(prev, "repos", createRepoPinKey(repoRoot)));
      }
      onTouchSession?.(paneId);
    },
    [onTouchSession, paneRepoRootMap],
  );

  return (
    <Card
      className={cn(
        "border-latte-surface1/70 bg-latte-mantle/80 relative flex h-full flex-col p-4 shadow-[0_18px_50px_-25px_rgba(17,17,27,0.6)]",
        className,
      )}
    >
      <SidebarBackdrop />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-5">
        <SidebarHeader totalSessions={totalSessions} repoCount={repoCount} />
        <FilterToggleGroup
          value={filter}
          onChange={handleFilterChange}
          options={SIDEBAR_FILTER_OPTIONS}
          buttonClassName="uppercase tracking-[0.14em] text-[11px] px-2.5 py-1"
        />

        <div
          className="custom-scrollbar -mr-2 min-h-0 flex-1 overflow-y-auto pr-2"
          onScroll={handleListScroll}
        >
          <div className="space-y-5">
            {sidebarGroups.length === 0 && (
              <div className="border-latte-surface2/60 bg-latte-crust/50 text-latte-subtext0 rounded-2xl border px-3 py-4 text-center text-xs">
                No sessions available for this filter.
              </div>
            )}
            {sidebarGroups.map((group) => {
              const groupTotalPanes = group.windowGroups.reduce(
                (total, windowGroup) => total + windowGroup.sessions.length,
                0,
              );
              return (
                <div key={group.repoRoot ?? "no-repo"} className="space-y-3">
                  <div className="border-latte-surface2/70 bg-latte-base/80 flex items-center justify-between gap-2 rounded-2xl border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-latte-lavender/70 h-2 w-2 rounded-full shadow-[0_0_8px_rgba(114,135,253,0.5)]" />
                      <span className="text-latte-lavender/80 text-[11px] font-semibold uppercase tracking-wider">
                        {formatRepoDirLabel(group.repoRoot)}
                      </span>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      <IconButton
                        type="button"
                        size="xs"
                        variant="base"
                        aria-label="Pin repo to top"
                        title="Pin repo to top"
                        className="border-latte-lavender/35 bg-latte-base/85 text-latte-lavender hover:bg-latte-lavender/12"
                        onClick={() => handleToggleRepoPin(group.repoRoot)}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </IconButton>
                      <TagPill tone="neutral" className="text-[9px]">
                        {group.windowGroups.length} windows
                      </TagPill>
                    </div>
                  </div>
                  <div className="space-y-4 pl-2.5">
                    {group.windowGroups.map((windowGroup) => (
                      <div
                        key={`${windowGroup.sessionName}:${windowGroup.windowIndex}`}
                        className="border-latte-surface2/60 bg-latte-crust/70 rounded-2xl border px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-latte-text truncate text-[12px] font-semibold uppercase tracking-wider">
                              Window {windowGroup.windowIndex}
                            </p>
                            <p className="text-latte-subtext0 truncate text-[10px]">
                              Session {windowGroup.sessionName}
                            </p>
                          </div>
                          <TagPill tone="neutral" className="text-[9px]">
                            {windowGroup.sessions.length} / {groupTotalPanes} panes
                          </TagPill>
                        </div>
                        <div className="mt-3 space-y-2">
                          {windowGroup.sessions.map((item) => (
                            <SessionSidebarItem
                              key={item.paneId}
                              item={item}
                              nowMs={nowMs}
                              isCurrent={currentPaneId === item.paneId}
                              isFocusPending={focusPendingPaneIds.has(item.paneId)}
                              onHoverStart={handleHoverStart}
                              onHoverEnd={handleHoverEnd}
                              onFocus={handleFocus}
                              onBlur={handleBlur}
                              onSelect={() => handleSelect(item.paneId)}
                              onFocusPane={handleFocusPane}
                              onTouchSession={handleTouchPane}
                              registerItemRef={registerItemRef}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {preview && preview.paneId !== currentPaneId && (
        <SessionPreviewPopover
          frame={preview.frame}
          title={preview.title}
          sessionName={preview.sessionName}
          windowIndex={preview.windowIndex}
          paneId={preview.paneId}
          lines={preview.lines}
          loading={preview.loading}
          error={preview.error ?? null}
          timeline={preview.timeline}
          timelineLoading={preview.timelineLoading}
          timelineError={preview.timelineError}
        />
      )}
    </Card>
  );
};
