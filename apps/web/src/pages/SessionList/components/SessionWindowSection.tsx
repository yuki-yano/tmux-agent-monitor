import { LayoutGrid } from "lucide-react";

import { InsetPanel, TagPill } from "@/components/ui";

import { type SessionWindowGroup } from "../session-window-group";
import { SessionCard } from "./SessionCard";

type SessionWindowSectionProps = {
  group: SessionWindowGroup;
  totalPanes: number;
  nowMs: number;
};

export const SessionWindowSection = ({ group, totalPanes, nowMs }: SessionWindowSectionProps) => {
  return (
    <InsetPanel className="p-3 sm:p-4">
      <div className="border-latte-surface2/70 flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:pl-1">
          <div className="border-latte-surface2/70 from-latte-crust/70 via-latte-surface0/70 to-latte-mantle/80 relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br">
            <div className="bg-latte-sky/25 pointer-events-none absolute -bottom-3 -right-3 h-8 w-8 rounded-full blur-xl" />
            <LayoutGrid className="text-latte-sky h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="font-display text-latte-text truncate text-base font-semibold leading-snug">
              Window {group.windowIndex}
            </p>
            <p className="text-latte-subtext0 truncate font-mono text-[11px] leading-normal">
              Session {group.sessionName}
            </p>
            <div className="hidden flex-wrap items-center gap-2 sm:flex">
              <TagPill tone="neutral" className="text-[11px]">
                {group.sessions.length} / {totalPanes} panes
              </TagPill>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:hidden">
          <TagPill tone="neutral" className="text-[11px]">
            {group.sessions.length} / {totalPanes} panes
          </TagPill>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3 2xl:grid-cols-4">
        {group.sessions.map((session) => (
          <SessionCard key={session.paneId} session={session} nowMs={nowMs} />
        ))}
      </div>
    </InsetPanel>
  );
};
