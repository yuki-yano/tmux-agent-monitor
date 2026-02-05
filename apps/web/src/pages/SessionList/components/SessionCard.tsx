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
  getLastInputTone,
  stateTone,
} from "@/lib/session-format";

type SessionCardProps = {
  session: SessionSummary;
  nowMs: number;
};

export const SessionCard = ({ session, nowMs }: SessionCardProps) => {
  const sessionTone = getLastInputTone(session.lastInputAt, nowMs);

  return (
    <Link to="/sessions/$paneId" params={{ paneId: session.paneId }} className="group">
      <Card
        interactive
        className={cn(
          "relative flex h-full flex-col overflow-hidden p-4 transition-all",
          session.state === "RUNNING" && "border-green-500/50 shadow-lg shadow-green-500/10",
          session.state === "WAITING_INPUT" && "border-amber-500/50 shadow-lg shadow-amber-500/10",
          session.state === "WAITING_PERMISSION" && "border-red-500/50 shadow-lg shadow-red-500/10",
          session.state === "SHELL" && "border-blue-500/50 shadow-lg shadow-blue-500/10",
          session.state === "UNKNOWN" && "border-gray-400/50 shadow-lg shadow-gray-400/10",
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br to-transparent opacity-50",
            session.state === "RUNNING" && "from-green-500/5",
            session.state === "WAITING_INPUT" && "from-amber-500/5",
            session.state === "WAITING_PERMISSION" && "from-red-500/5",
            session.state === "SHELL" && "from-blue-500/5",
            session.state === "UNKNOWN" && "from-gray-400/5",
          )}
        />

        <div className="relative flex flex-wrap items-center gap-2">
          <Badge tone={stateTone(session.state)} size="sm">
            {session.state.replace(/_/g, " ")}
          </Badge>
          <Badge tone={agentToneFor(session.agent)} size="sm">
            {agentLabelFor(session.agent)}
          </Badge>
          {session.pipeConflict && (
            <TagPill tone="danger" className="text-[9px]">
              Conflict
            </TagPill>
          )}
          <span className="ml-auto">
            <LastInputPill
              tone={sessionTone}
              label={<Clock className="h-2.5 w-2.5" />}
              srLabel="Last input"
              value={formatRelativeTime(session.lastInputAt, nowMs)}
              size="sm"
              showDot={false}
            />
          </span>
        </div>

        <div className="relative mt-2.5 flex min-w-0 flex-1 flex-col">
          <h3 className="font-display text-latte-text truncate text-[15px] font-semibold leading-snug">
            {session.customTitle ?? session.title ?? session.sessionName}
          </h3>
          <p
            className="text-latte-subtext0 mt-1.5 line-clamp-2 font-mono text-[11px] leading-normal tracking-tight"
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
