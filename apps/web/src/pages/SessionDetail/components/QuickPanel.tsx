import { ArrowRight, Clock, List, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge, Card, IconButton, LastInputPill, SurfaceButton, TagPill } from "@/components/ui";
import { formatRepoDirLabel, statusIconMeta } from "@/lib/quick-panel-utils";
import type { SessionGroup } from "@/lib/session-group";
import {
  buildSessionWindowGroups,
  type SessionWindowGroup,
} from "@/pages/SessionList/session-window-group";

import {
  agentLabelFor,
  agentToneFor,
  formatRelativeTime,
  getLastInputTone,
  isKnownAgent,
} from "../sessionDetailUtils";

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
  onClose: () => void;
  onToggle: () => void;
};

type QuickPanelProps = {
  state: QuickPanelState;
  actions: QuickPanelActions;
};

export const QuickPanel = ({ state, actions }: QuickPanelProps) => {
  const { open, sessionGroups, allSessions, nowMs, currentPaneId } = state;
  const { onOpenLogModal, onOpenSessionLink, onClose, onToggle } = actions;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
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
    <div className="fixed bottom-4 left-6 z-40 flex flex-col items-start gap-3">
      {open && (
        <Card className="font-body animate-panel-enter border-latte-lavender/30 bg-latte-mantle/85 relative flex max-h-[75dvh] w-[calc(100vw-3.5rem)] max-w-[480px] flex-col overflow-hidden rounded-3xl border-2 p-4 shadow-[0_25px_80px_-20px_rgba(114,135,253,0.4),0_0_0_1px_rgba(114,135,253,0.15)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
          <IconButton
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-30"
            variant="lavender"
            size="sm"
            aria-label="Close quick panel"
          >
            <X className="h-4 w-4" />
          </IconButton>
          <div
            ref={scrollRef}
            className="custom-scrollbar -mr-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-5"
          >
            <div className="space-y-5 pr-5">
              {agentGroups.length === 0 && (
                <div className="border-latte-lavender/20 bg-latte-crust/50 text-latte-subtext0 rounded-2xl border px-3 py-4 text-center text-xs">
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
                    `${windowGroup.sessionName}:${windowGroup.windowIndex}`,
                    windowGroup.sessions.length,
                  ]),
                );
                return (
                  <div key={group.repoRoot ?? "no-repo"} className="space-y-3">
                    <div className="border-latte-surface2/70 bg-latte-base/70 flex items-center justify-between gap-2 rounded-2xl border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-latte-lavender/70 h-2 w-2 rounded-full shadow-[0_0_8px_rgba(114,135,253,0.5)]" />
                        <span className="text-latte-lavender/80 text-[11px] font-semibold uppercase tracking-wider">
                          {formatRepoDirLabel(group.repoRoot)}
                        </span>
                      </div>
                      <TagPill tone="neutral" className="text-[9px]">
                        {group.windowGroups.length} windows
                      </TagPill>
                    </div>
                    <div className="space-y-3 pl-2.5">
                      {group.windowGroups.map((windowGroup, index) => (
                        <div key={`${windowGroup.sessionName}:${windowGroup.windowIndex}`}>
                          {index > 0 && <div className="border-latte-surface2/70 mb-3 border-t" />}
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-latte-overlay1 truncate text-[11px] font-semibold uppercase tracking-wider">
                                Window {windowGroup.windowIndex}
                              </p>
                              <p className="text-latte-subtext0 truncate text-[10px]">
                                Session {windowGroup.sessionName}
                              </p>
                            </div>
                            <TagPill tone="neutral" className="text-[9px]">
                              {windowGroup.sessions.length} /{" "}
                              {totalPaneMap.get(
                                `${windowGroup.sessionName}:${windowGroup.windowIndex}`,
                              ) ?? windowGroup.sessions.length}{" "}
                              panes
                            </TagPill>
                          </div>
                          <div className="mt-2 space-y-2">
                            {windowGroup.sessions.map((item) => {
                              const displayTitle =
                                item.customTitle ?? item.title ?? item.sessionName;
                              const lastInputTone = getLastInputTone(
                                item.lastInputAt ?? null,
                                nowMs,
                              );
                              const statusMeta = statusIconMeta(item.state);
                              const StatusIcon = statusMeta.icon;
                              const isCurrent = currentPaneId === item.paneId;
                              return (
                                <div key={item.paneId} className="relative pr-10">
                                  <SurfaceButton
                                    type="button"
                                    onClick={() => onOpenLogModal(item.paneId)}
                                    aria-current={isCurrent ? "true" : undefined}
                                    className={`flex w-full min-w-0 flex-col gap-2.5 ${
                                      isCurrent
                                        ? "border-latte-lavender/70 bg-latte-lavender/10 shadow-[0_0_0_1px_rgba(114,135,253,0.35),0_10px_20px_-12px_rgba(114,135,253,0.35)]"
                                        : ""
                                    }`}
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span
                                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${statusMeta.wrap}`}
                                        aria-label={statusMeta.label}
                                      >
                                        <StatusIcon
                                          className={`h-3.5 w-3.5 ${statusMeta.className}`}
                                        />
                                      </span>
                                      <span className="text-latte-text min-w-0 truncate text-sm font-semibold">
                                        {displayTitle}
                                      </span>
                                    </div>
                                    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
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
                                        className="ml-auto"
                                      />
                                    </div>
                                  </SurfaceButton>
                                  <IconButton
                                    type="button"
                                    onClick={() => onOpenSessionLink(item.paneId)}
                                    variant={isCurrent ? "lavenderStrong" : "lavender"}
                                    size="sm"
                                    aria-label="Open session link"
                                    className="absolute right-0 top-1/2 z-10 -translate-y-1/2 shadow-md"
                                  >
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </IconButton>
                                </div>
                              );
                            })}
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
      <IconButton
        type="button"
        onClick={onToggle}
        variant="lavenderStrong"
        size="lg"
        aria-label="Toggle session quick panel"
      >
        <List className="h-5 w-5" />
      </IconButton>
    </div>
  );
};
