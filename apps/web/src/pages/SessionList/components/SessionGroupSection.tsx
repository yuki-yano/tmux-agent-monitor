import type { SessionSummary } from "@vde-monitor/shared";
import { Clock, FolderGit2, Pin } from "lucide-react";

import { GlassPanel, GlowCard, IconButton, LastInputPill, TagPill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRelativeTime, getLastInputTone } from "@/lib/session-format";
import type { SessionGroup } from "@/lib/session-group";

import { buildSessionWindowGroups, type SessionWindowGroup } from "../session-window-group";
import { formatRepoName, formatRepoPath } from "../sessionListFormat";
import { SessionWindowSection } from "./SessionWindowSection";

type SessionGroupSectionProps = {
  group: SessionGroup;
  nowMs: number;
  allSessions: SessionSummary[];
  isRepoPinned: (repoRoot: string | null) => boolean;
  isWindowPinned: (sessionName: string, windowIndex: number) => boolean;
  isPanePinned: (paneId: string) => boolean;
  onToggleRepoPin: (repoRoot: string | null) => void;
  onToggleWindowPin: (sessionName: string, windowIndex: number) => void;
  onTogglePanePin: (paneId: string) => void;
};

export const SessionGroupSection = ({
  group,
  nowMs,
  allSessions,
  isRepoPinned,
  isWindowPinned,
  isPanePinned,
  onToggleRepoPin,
  onToggleWindowPin,
  onTogglePanePin,
}: SessionGroupSectionProps) => {
  const groupTone = getLastInputTone(group.lastInputAt, nowMs);
  const repoName = formatRepoName(group.repoRoot);
  const repoPath = formatRepoPath(group.repoRoot);
  const repoSessions = allSessions.filter(
    (session) => (session.repoRoot ?? null) === group.repoRoot,
  );
  const totalWindowGroups = buildSessionWindowGroups(repoSessions, {
    isWindowPinned,
    isPanePinned: (session) => isPanePinned(session.paneId),
  });
  const totalPaneMap = new Map(
    totalWindowGroups.map((windowGroup) => [
      `${windowGroup.sessionName}:${windowGroup.windowIndex}`,
      windowGroup.sessions.length,
    ]),
  );
  const windowGroups = buildSessionWindowGroups(group.sessions, {
    isWindowPinned,
    isPanePinned: (session) => isPanePinned(session.paneId),
  });
  const sessionSections: { sessionName: string; windowGroups: SessionWindowGroup[] }[] = [];
  const bySession = new Map<string, SessionWindowGroup[]>();
  windowGroups.forEach((windowGroup) => {
    const bucket = bySession.get(windowGroup.sessionName) ?? [];
    bucket.push(windowGroup);
    bySession.set(windowGroup.sessionName, bucket);
  });
  bySession.forEach((sessionWindowGroups, sessionName) => {
    sessionSections.push({ sessionName, windowGroups: sessionWindowGroups });
  });
  const repoPinned = isRepoPinned(group.repoRoot);

  return (
    <GlowCard contentClassName="gap-2 sm:gap-3">
      <GlassPanel
        className="px-3 py-3 sm:px-4 sm:py-4"
        contentClassName="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="border-latte-surface2/70 from-latte-crust/70 via-latte-surface0/70 to-latte-mantle/80 relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br">
            <div className="bg-latte-lavender/30 pointer-events-none absolute -bottom-3 -right-3 h-8 w-8 rounded-full blur-xl" />
            <FolderGit2 className="text-latte-lavender h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-display text-latte-text truncate text-lg font-semibold leading-snug">
              {repoName}
            </p>
            {repoPath && (
              <p className="text-latte-subtext0 truncate font-mono text-[11px] leading-normal">
                {repoPath}
              </p>
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:min-w-[320px]">
          <TagPill tone="neutral" className="text-[11px]">
            {windowGroups.length} windows
          </TagPill>
          <TagPill tone="neutral" className="text-[11px]">
            {group.sessions.length} panes
          </TagPill>
          <div className="ml-auto flex items-center gap-2">
            <IconButton
              type="button"
              size="xs"
              variant={repoPinned ? "lavenderStrong" : "base"}
              aria-label="Pin repo to top"
              aria-pressed={repoPinned}
              title="Pin repo to top"
              onClick={() => onToggleRepoPin(group.repoRoot)}
            >
              <Pin className={cn("h-3.5 w-3.5", repoPinned ? "fill-current" : null)} />
            </IconButton>
            <LastInputPill
              tone={groupTone}
              label={<Clock className="h-3 w-3" />}
              srLabel="Latest input"
              value={formatRelativeTime(group.lastInputAt, nowMs)}
              size="xs"
              showDot={false}
              className="text-[10px]"
            />
          </div>
        </div>
      </GlassPanel>
      <div className="pt-2 sm:pt-3">
        <div className="flex flex-col gap-3 sm:gap-4">
          {sessionSections.map((sessionSection, sessionIndex) => (
            <div
              key={sessionSection.sessionName}
              className={cn(sessionIndex > 0 ? "pt-3 sm:pt-4" : null)}
            >
              <div className="space-y-3 sm:space-y-4">
                {sessionSection.windowGroups.map((windowGroup) => (
                  <SessionWindowSection
                    key={`${windowGroup.sessionName}:${windowGroup.windowIndex}`}
                    group={windowGroup}
                    totalPanes={
                      totalPaneMap.get(`${windowGroup.sessionName}:${windowGroup.windowIndex}`) ??
                      windowGroup.sessions.length
                    }
                    nowMs={nowMs}
                    isWindowPinned={isWindowPinned(
                      windowGroup.sessionName,
                      windowGroup.windowIndex,
                    )}
                    onToggleWindowPin={onToggleWindowPin}
                    isPanePinned={isPanePinned}
                    onTogglePanePin={onTogglePanePin}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlowCard>
  );
};
