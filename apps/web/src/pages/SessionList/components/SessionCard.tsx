import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { Clock } from "lucide-react";

import { Badge, Card, LastInputPill, TagPill } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  agentLabelFor,
  agentToneFor,
  formatPath,
  formatRelativeTime,
  formatStateLabel,
  getLastInputTone,
  isKnownAgent,
  stateTone,
} from "@/lib/session-format";

type SessionCardProps = {
  session: SessionSummary;
  nowMs: number;
};

const sessionStateStyles: Record<
  SessionSummary["state"],
  {
    card: string;
    overlay: string;
  }
> = {
  RUNNING: {
    card: "border-green-500/50 shadow-lg shadow-green-500/10",
    overlay: "from-green-500/5",
  },
  WAITING_INPUT: {
    card: "border-amber-500/50 shadow-lg shadow-amber-500/10",
    overlay: "from-amber-500/5",
  },
  WAITING_PERMISSION: {
    card: "border-red-500/50 shadow-lg shadow-red-500/10",
    overlay: "from-red-500/5",
  },
  SHELL: {
    card: "border-blue-500/50 shadow-lg shadow-blue-500/10",
    overlay: "from-blue-500/5",
  },
  UNKNOWN: {
    card: "border-gray-400/50 shadow-lg shadow-gray-400/10",
    overlay: "from-gray-400/5",
  },
};

const resolveSessionTitle = (session: SessionSummary) => {
  if (session.customTitle) return session.customTitle;
  if (session.title) return session.title;
  return session.sessionName;
};

export const SessionCard = ({ session, nowMs }: SessionCardProps) => {
  const sessionTone = getLastInputTone(session.lastInputAt, nowMs);
  const stateStyle = sessionStateStyles[session.state];
  const sessionTitle = resolveSessionTitle(session);
  const showAgentBadge = isKnownAgent(session.agent);

  return (
    <Link to="/sessions/$paneId" params={{ paneId: session.paneId }} className="group">
      <Card
        interactive
        className={cn(
          "relative flex h-full flex-col overflow-hidden p-4 transition-all",
          stateStyle.card,
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br to-transparent opacity-50",
            stateStyle.overlay,
          )}
        />

        <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={stateTone(session.state)} size="sm">
              {formatStateLabel(session.state)}
            </Badge>
            {showAgentBadge && (
              <Badge tone={agentToneFor(session.agent)} size="sm">
                {agentLabelFor(session.agent)}
              </Badge>
            )}
            {session.pipeConflict && (
              <TagPill tone="danger" className="text-[9px]">
                Conflict
              </TagPill>
            )}
          </div>
          <span className="self-center justify-self-end">
            <LastInputPill
              tone={sessionTone}
              label={<Clock className="h-2.5 w-2.5" />}
              srLabel="Last input"
              value={formatRelativeTime(session.lastInputAt, nowMs)}
              size="xs"
              showDot={false}
            />
          </span>
        </div>

        <div className="relative mt-2.5 flex min-w-0 flex-1 flex-col">
          <h3 className="font-display text-latte-text truncate text-[15px] font-semibold leading-snug">
            {sessionTitle}
          </h3>
          <p
            className="text-latte-subtext0 mt-1 line-clamp-2 font-mono text-[11px] leading-normal tracking-tight"
            title={session.currentPath ?? undefined}
          >
            {formatPath(session.currentPath)}
          </p>
          {session.lastMessage && (
            <p className="text-latte-overlay1 mt-2.5 line-clamp-2 text-[11px] leading-relaxed">
              {session.lastMessage}
            </p>
          )}
        </div>

        <div className="border-latte-surface1/30 relative mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
          <TagPill tone="meta">Session {session.sessionName}</TagPill>
          <TagPill tone="meta">Window {session.windowIndex}</TagPill>
          <TagPill tone="meta">Pane {session.paneId}</TagPill>
        </div>
      </Card>
    </Link>
  );
};
