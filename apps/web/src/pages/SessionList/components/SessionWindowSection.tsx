import { LayoutGrid, Pin } from "lucide-react";

import { IconButton, InsetPanel, TagPill } from "@/components/ui";
import { cn } from "@/lib/cn";

import { type SessionWindowGroup } from "../session-window-group";
import { SessionCard } from "./SessionCard";

type SessionWindowSectionProps = {
  group: SessionWindowGroup;
  totalPanes: number;
  nowMs: number;
  isWindowPinned: boolean;
  onToggleWindowPin: (sessionName: string, windowIndex: number) => void;
  isPanePinned: (paneId: string) => boolean;
  onTogglePanePin: (paneId: string) => void;
};

export const SessionWindowSection = ({
  group,
  totalPanes,
  nowMs,
  isWindowPinned,
  onToggleWindowPin,
  isPanePinned,
  onTogglePanePin,
}: SessionWindowSectionProps) => {
  return (
    <InsetPanel className="p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3 pb-2 sm:pl-1">
        <div className="flex min-w-0 items-center gap-3">
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
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <IconButton
            type="button"
            size="xs"
            variant={isWindowPinned ? "lavenderStrong" : "base"}
            aria-label="Pin window to top"
            aria-pressed={isWindowPinned}
            title="Pin window to top"
            onClick={() => onToggleWindowPin(group.sessionName, group.windowIndex)}
          >
            <Pin className={cn("h-3.5 w-3.5", isWindowPinned ? "fill-current" : null)} />
          </IconButton>
          <TagPill tone="neutral" className="whitespace-nowrap text-[11px]">
            {group.sessions.length} / {totalPanes} panes
          </TagPill>
        </div>
      </div>
      <div className="mt-2 grid gap-3 sm:gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3 2xl:grid-cols-4">
        {group.sessions.map((session) => (
          <SessionCard
            key={session.paneId}
            session={session}
            nowMs={nowMs}
            isPinned={isPanePinned(session.paneId)}
            onTogglePin={onTogglePanePin}
          />
        ))}
      </div>
    </InsetPanel>
  );
};
