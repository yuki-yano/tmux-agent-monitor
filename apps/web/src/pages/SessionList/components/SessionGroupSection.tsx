import { Clock, FolderGit2 } from "lucide-react";

import { GlassPanel, GlowCard, LastInputPill, TagPill } from "@/components/ui";
import { formatRelativeTime, getLastInputTone } from "@/lib/session-format";
import type { SessionGroup } from "@/lib/session-group";

import { buildSessionWindowGroups } from "../session-window-group";
import { formatRepoName, formatRepoPath } from "../sessionListFormat";
import { SessionWindowSection } from "./SessionWindowSection";

type SessionGroupSectionProps = {
  group: SessionGroup;
  nowMs: number;
};

export const SessionGroupSection = ({ group, nowMs }: SessionGroupSectionProps) => {
  const groupTone = getLastInputTone(group.lastInputAt, nowMs);
  const repoName = formatRepoName(group.repoRoot);
  const repoPath = formatRepoPath(group.repoRoot);
  const windowGroups = buildSessionWindowGroups(group.sessions);

  return (
    <GlowCard contentClassName="gap-3 sm:gap-4">
      <GlassPanel
        className="px-4 py-3 sm:px-5 sm:py-4"
        contentClassName="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="border-latte-surface2/70 from-latte-crust/70 via-latte-surface0/70 to-latte-mantle/80 relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br">
            <div className="bg-latte-lavender/30 pointer-events-none absolute -bottom-3 -right-3 h-8 w-8 rounded-full blur-xl" />
            <FolderGit2 className="text-latte-lavender h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-2">
            <p className="font-display text-latte-text truncate text-lg font-semibold leading-snug">
              {repoName}
            </p>
            {repoPath && (
              <p className="text-latte-subtext0 truncate font-mono text-[11px] leading-normal">
                {repoPath}
              </p>
            )}
            <div className="hidden flex-wrap items-center gap-2 sm:flex">
              <TagPill tone="neutral" className="text-[11px]">
                {windowGroups.length} windows
              </TagPill>
              <TagPill tone="neutral" className="text-[11px]">
                {group.sessions.length} panes
              </TagPill>
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
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:hidden">
          <TagPill tone="neutral" className="text-[11px]">
            {windowGroups.length} windows
          </TagPill>
          <TagPill tone="neutral" className="text-[11px]">
            {group.sessions.length} panes
          </TagPill>
          <LastInputPill
            tone={groupTone}
            label={<Clock className="h-3 w-3" />}
            srLabel="Latest input"
            value={formatRelativeTime(group.lastInputAt, nowMs)}
            size="xs"
            showDot={false}
            className="ml-auto text-[10px]"
          />
        </div>
      </GlassPanel>
      <div className="flex flex-col gap-3 sm:gap-4">
        {windowGroups.map((windowGroup) => (
          <SessionWindowSection
            key={`${windowGroup.sessionName}:${windowGroup.windowIndex}`}
            group={windowGroup}
            totalPanes={group.sessions.length}
            nowMs={nowMs}
          />
        ))}
      </div>
    </GlowCard>
  );
};
