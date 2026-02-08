import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { Clock, Pin } from "lucide-react";
import type { MouseEvent } from "react";

import { Badge, Card, IconButton, LastInputPill, TagPill } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  agentLabelFor,
  agentToneFor,
  formatPath,
  formatRelativeTime,
  formatStateLabel,
  getLastInputTone,
  isEditorCommand,
  isKnownAgent,
  stateTone,
} from "@/lib/session-format";

type SessionCardProps = {
  session: SessionSummary;
  nowMs: number;
  onTouchPin?: (paneId: string) => void;
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

const editorSessionStyle = {
  card: "border-latte-maroon/55 shadow-[0_14px_30px_-20px_rgb(var(--ctp-maroon)/0.55)]",
  overlay: "from-latte-maroon/8",
} as const;

const resolveSessionTitle = (session: SessionSummary) => {
  if (session.customTitle) return session.customTitle;
  if (session.title) return session.title;
  return session.sessionName;
};

export const SessionCard = ({ session, nowMs, onTouchPin }: SessionCardProps) => {
  const sessionTone = getLastInputTone(session.lastInputAt, nowMs);
  const sessionTitle = resolveSessionTitle(session);
  const showAgentBadge = isKnownAgent(session.agent);
  const showEditorState = session.state === "UNKNOWN" && isEditorCommand(session.currentCommand);
  const stateStyle = showEditorState ? editorSessionStyle : sessionStateStyles[session.state];
  const stateBadgeTone = showEditorState ? "editor" : stateTone(session.state);
  const stateBadgeLabel = showEditorState ? "EDITOR" : formatStateLabel(session.state);
  const handlePinClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onTouchPin?.(session.paneId);
  };

  return (
    <Link
      to="/sessions/$paneId"
      params={{ paneId: session.paneId }}
      data-pane-scroll-key={session.paneId}
      className="group block w-full min-w-0 max-w-full"
    >
      <Card
        interactive
        className={cn(
          "relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden p-4 transition-all",
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
            <Badge tone={stateBadgeTone} size="sm">
              {stateBadgeLabel}
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
          <h3 className="font-display text-latte-text block w-full max-w-full truncate text-[15px] font-semibold leading-snug">
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

        <div className="relative mt-3 flex flex-wrap items-center gap-1.5 pt-2.5">
          <TagPill tone="meta">Pane {session.paneId}</TagPill>
          {onTouchPin ? (
            <IconButton
              type="button"
              size="xs"
              variant="base"
              className="ml-auto"
              aria-label="Pin pane to top"
              title="Pin pane to top"
              onClick={handlePinClick}
            >
              <Pin className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>
      </Card>
    </Link>
  );
};
