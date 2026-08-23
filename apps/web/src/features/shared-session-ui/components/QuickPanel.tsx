import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  List,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Card, IconButton, LastInputPill, SurfaceButton, TagPill } from "@/components/ui";
import {
  isSessionEditorState,
  resolveSessionDisplayTitle,
} from "@/features/shared-session-ui/model/session-display";
import {
  type SessionWindowGroup,
  buildSessionWindowGroups,
  getSessionWindowGroupKey,
} from "@/features/shared-session-ui/model/session-window-group";
import { cn } from "@/lib/cn";
import { isPwaDisplayMode } from "@/lib/pwa-display-mode";
import { agentIconMeta, formatRepoDirLabel, statusIconMeta } from "@/lib/quick-panel-utils";
import { formatBranchLabel, formatRelativeTime, getLastInputTone } from "@/lib/session-format";
import type { SessionGroup } from "@/lib/session-group";

type QuickPanelState = {
  open: boolean;
  sessionGroups: SessionGroup[];
  allSessions: SessionGroup["sessions"];
  nowMs: number;
  currentPaneId?: string | null;
};

type QuickPanelActions = {
  onOpenLogModal: (paneId: string) => void;
  onOpenSessionLink: (paneId: string) => void;
  onOpenSessionLinkInNewWindow: (paneId: string) => void;
  onClose: () => void;
  onToggle: () => void;
};

type QuickPanelProps = {
  state: QuickPanelState;
  actions: QuickPanelActions;
};

type QuickPanelSessionItemProps = {
  item: SessionGroup["sessions"][number];
  nowMs: number;
  currentPaneId?: string | null;
  onOpenLogModal: (paneId: string) => void;
  onOpenSessionLink: (paneId: string) => void;
  onOpenSessionLinkInNewWindow: (paneId: string) => void;
};

const QuickPanelSessionItem = ({
  item,
  nowMs,
  currentPaneId,
  onOpenLogModal,
  onOpenSessionLink,
  onOpenSessionLinkInNewWindow,
}: QuickPanelSessionItemProps) => {
  const displayTitle = resolveSessionDisplayTitle(item);
  const lastInputTone = getLastInputTone(item.lastInputAt ?? null, nowMs);
  const statusMeta = isSessionEditorState(item)
    ? {
        ...statusIconMeta("UNKNOWN"),
        className: "text-latte-maroon-text",
        wrap: "border-latte-maroon/45 bg-latte-maroon/14",
        label: "EDITOR",
      }
    : statusIconMeta(item.state);
  const agentMeta = agentIconMeta(item.agent);
  const StatusIcon = statusMeta.icon;
  const AgentIcon = agentMeta.icon;
  const isCurrent = currentPaneId === item.paneId;

  return (
    <div className="relative pr-11">
      <SurfaceButton
        type="button"
        onClick={() => onOpenLogModal(item.paneId)}
        aria-current={isCurrent ? "true" : undefined}
        className={cn(
          "flex w-full min-w-0 flex-col gap-2.5",
          isCurrent &&
            "border-latte-blue/58 bg-latte-blue/12 shadow-[inset_0_0_0_1px_rgb(var(--ctp-blue)/0.1),0_5px_16px_-10px_rgb(var(--ctp-blue)/0.42)]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-full border",
              statusMeta.wrap,
            )}
            aria-label={statusMeta.label}
          >
            <StatusIcon className={cn("h-3.5 w-3.5", statusMeta.className)} />
          </span>
          <span
            className="font-ident text-latte-text min-w-0 truncate text-sm font-medium tracking-normal"
            title={displayTitle}
          >
            {displayTitle}
          </span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
              agentMeta.wrap,
            )}
            aria-label={agentMeta.label}
          >
            <AgentIcon className={cn("h-3 w-3", agentMeta.className)} />
          </span>
          <TagPill
            tone="meta"
            className="inline-flex max-w-[160px] items-center gap-1"
            title={formatBranchLabel(item.branch)}
          >
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate font-mono">{formatBranchLabel(item.branch)}</span>
          </TagPill>
          <LastInputPill
            tone={lastInputTone}
            label={<Clock className="h-3 w-3" />}
            srLabel="Last input"
            value={formatRelativeTime(item.lastInputAt, nowMs)}
            size="xs"
            showDot={false}
            className="ml-auto"
          />
        </div>
      </SurfaceButton>
      <div className="absolute right-0 top-1/2 flex -translate-y-1/2 flex-col gap-1">
        <IconButton
          type="button"
          onClick={() => onOpenSessionLink(item.paneId)}
          variant="base"
          size="sm"
          aria-label="Open session link"
          className={cn(
            "shadow-elev-3 z-10",
            isCurrent && "border-latte-blue/58 bg-latte-blue/16 text-latte-blue-text",
          )}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          type="button"
          onClick={() => onOpenSessionLinkInNewWindow(item.paneId)}
          variant="base"
          size="sm"
          aria-label="Open session link in new window"
          className={cn(
            "shadow-elev-3 z-10",
            isCurrent && "border-latte-blue/58 bg-latte-blue/16 text-latte-blue-text",
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
};

type QuickPanelPhase = "closed" | "open" | "closing";

const resolveQuickPanelPhase = (open: boolean, previousPhase: QuickPanelPhase): QuickPanelPhase =>
  open ? "open" : previousPhase === "open" ? "closing" : previousPhase;

const useQuickPanelPhase = (open: boolean) => {
  const [panelState, setPanelState] = useState<{ open: boolean; phase: QuickPanelPhase }>(() => ({
    open,
    phase: open ? "open" : "closed",
  }));
  const nextPhase = resolveQuickPanelPhase(open, panelState.phase);
  if (panelState.open !== open) {
    setPanelState({ open, phase: nextPhase });
  }
  const panelPhase = panelState.open === open ? panelState.phase : nextPhase;
  const finishClosing = useCallback(() => {
    setPanelState((previous) =>
      previous.phase === "closed" ? previous : { ...previous, phase: "closed" },
    );
  }, []);

  useEffect(() => {
    if (panelPhase !== "closing") {
      return;
    }
    // Animations never fire inside display:none subtrees (e.g. the md:hidden
    // wrapper on desktop), so force-unmount if animationend never arrives.
    const fallback = window.setTimeout(finishClosing, 400);
    return () => {
      window.clearTimeout(fallback);
    };
  }, [finishClosing, panelPhase]);

  return { panelPhase, finishClosing };
};

export const QuickPanel = ({ state, actions }: QuickPanelProps) => {
  const { open, sessionGroups, allSessions, nowMs, currentPaneId } = state;
  const { onOpenLogModal, onOpenSessionLink, onOpenSessionLinkInNewWindow, onClose, onToggle } =
    actions;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const pwaDisplayMode = isPwaDisplayMode();
  // Keep the card mounted while the exit animation plays.
  const { panelPhase, finishClosing } = useQuickPanelPhase(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("[data-log-modal-overlay]")) {
        return;
      }
      if (target.closest("[data-log-modal-panel]")) {
        return;
      }
      if (target.closest("[data-quick-panel-card]")) {
        return;
      }
      if (target.closest('[aria-label="Toggle session quick panel"]')) {
        return;
      }
      if (target.closest("[data-quick-panel-history-controls]")) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose, open]);
  const agentGroups = sessionGroups
    .map((group) => {
      const agentSessions = group.sessions.filter((session) => session.agent !== "unknown");
      const windowGroups = buildSessionWindowGroups(agentSessions);
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

  useEffect(() => {
    const target = scrollRef.current;
    if (!target) return;
    const handleWheel = (event: WheelEvent) => {
      const { scrollHeight, clientHeight, scrollTop } = target;
      if (scrollHeight <= clientHeight) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.deltaY < 0 && scrollTop <= 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.deltaY > 0 && scrollTop + clientHeight >= scrollHeight) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      touchStartYRef.current = touch.clientY;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const startY = touchStartYRef.current;
      if (startY == null) return;
      const currentY = touch.clientY;
      const deltaY = startY - currentY;
      const { scrollHeight, clientHeight, scrollTop } = target;
      if (scrollHeight <= clientHeight) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (deltaY < 0 && scrollTop <= 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (deltaY > 0 && scrollTop + clientHeight >= scrollHeight) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    target.addEventListener("wheel", handleWheel, { passive: false });
    target.addEventListener("touchstart", handleTouchStart, { passive: true });
    target.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      target.removeEventListener("wheel", handleWheel);
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  return (
    <div
      data-quick-panel-root
      data-open={open ? "true" : "false"}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.9rem)] left-[calc(env(safe-area-inset-left)+0.625rem)] z-40 flex flex-col items-start gap-2.5 sm:bottom-[calc(env(safe-area-inset-bottom)+1rem)] sm:left-6 sm:gap-3"
    >
      {panelPhase !== "closed" && (
        <Card
          data-quick-panel-card
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && panelPhase === "closing") {
              finishClosing();
            }
          }}
          className={cn(
            "font-body ring-latte-overlay2/20 relative flex max-h-[75dvh] w-[calc(100vw-env(safe-area-inset-left)-env(safe-area-inset-right)-1.25rem)] max-w-[480px] flex-col overflow-hidden rounded-3xl border border-[var(--material-stroke)] bg-[var(--material-raised)] p-3 shadow-[var(--shadow-popover)] ring-1 ring-inset backdrop-blur-xl sm:w-[calc(100vw-3.5rem)] sm:p-4",
            panelPhase === "closing" ? "animate-panel-exit" : "animate-panel-enter",
          )}
        >
          <IconButton
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 z-30 sm:right-2.5 sm:top-2.5"
            variant="base"
            size="sm"
            aria-label="Close quick panel"
          >
            <X className="h-4 w-4" />
          </IconButton>
          <div
            ref={scrollRef}
            className="custom-scrollbar -mr-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-9 sm:-mr-4 sm:pt-10"
          >
            <div className="space-y-4 pr-3 sm:space-y-5 sm:pr-5">
              {agentGroups.length === 0 && (
                <div className="text-latte-subtext0 rounded-xl border border-[var(--material-stroke)] bg-[var(--material-inset)] px-2.5 py-3 text-center text-xs sm:px-3 sm:py-4">
                  No agent sessions available.
                </div>
              )}
              {agentGroups.map((group) => {
                const repoSessions = allSessions.filter(
                  (session) => (session.repoRoot ?? null) === group.repoRoot,
                );
                const totalWindowGroups = buildSessionWindowGroups(repoSessions);
                const totalPaneMap = new Map(
                  totalWindowGroups.map((windowGroup) => [
                    getSessionWindowGroupKey(windowGroup),
                    windowGroup.sessions.length,
                  ]),
                );
                return (
                  <div key={group.repoRoot ?? "no-repo"} className="space-y-3">
                    <div className="border-latte-surface2/70 bg-latte-base/70 flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 sm:px-3 sm:py-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-latte-blue/80 h-2 w-2 rounded-full shadow-[0_0_8px_rgb(var(--ctp-blue)/0.42)]" />
                        <span className="text-latte-blue-text text-[11px] font-semibold uppercase tracking-wider">
                          {formatRepoDirLabel(group.repoRoot)}
                        </span>
                      </div>
                      <TagPill tone="neutral" className="text-[9px]">
                        {group.windowGroups.length} windows
                      </TagPill>
                    </div>
                    <div className="space-y-3 pl-2 sm:pl-2.5">
                      {group.windowGroups.map((windowGroup, index) => (
                        <div key={getSessionWindowGroupKey(windowGroup)}>
                          {index > 0 && <div className="border-latte-surface2/70 mb-3 border-t" />}
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-ident text-latte-subtext0 truncate text-[11px] font-medium uppercase tracking-normal">
                                Window {windowGroup.windowIndex}
                              </p>
                              <p className="font-ident text-latte-subtext0 truncate text-[10px] tracking-normal">
                                Session {windowGroup.sessionName}
                              </p>
                            </div>
                            <TagPill tone="neutral" className="text-[9px]">
                              {windowGroup.sessions.length} /{" "}
                              {totalPaneMap.get(getSessionWindowGroupKey(windowGroup)) ??
                                windowGroup.sessions.length}{" "}
                              panes
                            </TagPill>
                          </div>
                          <div className="mt-1.5 space-y-2 sm:mt-2">
                            {windowGroup.sessions.map((item) => (
                              <QuickPanelSessionItem
                                key={item.paneId}
                                item={item}
                                nowMs={nowMs}
                                currentPaneId={currentPaneId}
                                onOpenLogModal={onOpenLogModal}
                                onOpenSessionLink={onOpenSessionLink}
                                onOpenSessionLinkInNewWindow={onOpenSessionLinkInNewWindow}
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
        </Card>
      )}
      <div className="flex items-center gap-2">
        <IconButton
          type="button"
          onClick={onToggle}
          variant="base"
          size="lg"
          aria-label="Toggle session quick panel"
          className={cn(
            "border-latte-blue/46 bg-latte-blue/14 text-latte-blue-text shadow-[0_0_0_1px_rgb(var(--ctp-blue)/0.12),0_8px_22px_-12px_rgb(var(--ctp-blue)/0.56)]",
            open && "border-latte-blue/68 bg-latte-blue/22",
          )}
        >
          <List className="h-5 w-5" />
        </IconButton>
        {pwaDisplayMode && (
          <div data-quick-panel-history-controls className="flex items-center gap-1.5">
            <IconButton
              type="button"
              onClick={() => {
                window.history.back();
              }}
              variant="base"
              size="md"
              className="h-11 w-11"
              aria-label="Go back"
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton
              type="button"
              onClick={() => {
                window.history.forward();
              }}
              variant="base"
              size="md"
              className="h-11 w-11"
              aria-label="Go forward"
            >
              <ChevronRight className="h-[18px] w-[18px]" />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
};
