import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildSessionGroups } from "@/lib/session-group";
import { useSessions } from "@/state/session-context";

const stateTone = (state: string) => {
  switch (state) {
    case "RUNNING":
      return "running";
    case "WAITING_INPUT":
      return "waiting";
    case "WAITING_PERMISSION":
      return "permission";
    default:
      return "unknown";
  }
};

const agentTone = (agent: string) => {
  switch (agent) {
    case "codex":
      return "codex" as const;
    case "claude":
      return "claude" as const;
    default:
      return "unknown" as const;
  }
};

const agentLabel = (agent: string) => {
  switch (agent) {
    case "codex":
      return "CODEX";
    case "claude":
      return "CLAUDE";
    default:
      return "UNKNOWN";
  }
};

const formatPath = (value: string | null) => {
  if (!value) return "—";
  const match = value.match(/^\/(Users|home)\/[^/]+(\/.*)?$/);
  if (match) {
    return `~${match[2] ?? ""}`;
  }
  return value;
};

const formatRepoLabel = (value: string | null) => {
  if (!value) return "No repo";
  return formatPath(value);
};

const formatRelativeTime = (value: string | null, nowMs: number) => {
  if (!value) return "-";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "-";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
};

const getLastInputTone = (value: string | null, nowMs: number) => {
  if (!value) {
    return {
      pill: "border-latte-surface2/70 bg-latte-crust/60 text-latte-subtext0",
      dot: "bg-latte-subtext0",
    };
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return {
      pill: "border-latte-surface2/70 bg-latte-crust/60 text-latte-subtext0",
      dot: "bg-latte-subtext0",
    };
  }
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 300) {
    return {
      pill: "border-latte-green/40 bg-latte-green/10 text-latte-green",
      dot: "bg-latte-green shadow-[0_0_8px_rgba(64,160,43,0.6)]",
    };
  }
  if (diffSec < 1800) {
    return {
      pill: "border-latte-yellow/40 bg-latte-yellow/10 text-latte-yellow",
      dot: "bg-latte-yellow shadow-[0_0_8px_rgba(223,142,29,0.6)]",
    };
  }
  if (diffSec < 7200) {
    return {
      pill: "border-latte-peach/40 bg-latte-peach/10 text-latte-peach",
      dot: "bg-latte-peach shadow-[0_0_8px_rgba(239,159,118,0.6)]",
    };
  }
  return {
    pill: "border-latte-red/40 bg-latte-red/10 text-latte-red",
    dot: "bg-latte-red shadow-[0_0_8px_rgba(210,15,57,0.6)]",
  };
};

export const SessionListPage = () => {
  const { sessions, connected, connectionIssue, readOnly, reconnect, refreshSessions } =
    useSessions();
  const [filter, setFilter] = useState("ALL");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    return sessions.filter((session) => {
      const matchesFilter = filter === "ALL" || session.state === filter;
      return matchesFilter;
    });
  }, [filter, sessions]);

  const groups = useMemo(() => buildSessionGroups(filtered), [filtered]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <header className="shadow-glass border-latte-surface1/60 bg-latte-base/80 flex flex-col gap-4 rounded-[32px] border p-6 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-latte-subtext0 text-xs uppercase tracking-[0.5em]">
              tmux-agent-monitor
            </p>
            <h1 className="font-display text-latte-text text-3xl">Live Sessions</h1>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${connected ? "bg-latte-green" : "bg-latte-red"}`}
                />
                <span className="text-latte-subtext0 text-xs">
                  {connected ? "Connected" : "Reconnecting"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (connected ? refreshSessions() : reconnect())}
                aria-label={connected ? "Refresh" : "Reconnect"}
              >
                <RefreshCw className="h-4 w-4" />
                <span className="sr-only">{connected ? "Refresh" : "Reconnect"}</span>
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["ALL", "RUNNING", "WAITING_INPUT", "WAITING_PERMISSION", "UNKNOWN"].map((state) => (
            <Button
              key={state}
              variant={filter === state ? "primary" : "ghost"}
              size="sm"
              onClick={() => setFilter(state)}
            >
              {state.replace("_", " ")}
            </Button>
          ))}
        </div>
        {readOnly && (
          <div className="border-latte-peach/50 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-sm">
            Read-only mode is active. Actions are disabled.
          </div>
        )}
        {connectionIssue && (
          <div className="border-latte-peach/50 bg-latte-peach/10 text-latte-peach rounded-2xl border px-4 py-2 text-sm">
            {connectionIssue}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const groupTone = getLastInputTone(group.lastInputAt, nowMs);
          return (
            <Card
              key={group.repoRoot ?? "no-repo"}
              className="shadow-glass border-latte-surface1/60 bg-latte-base/70 relative overflow-hidden rounded-[32px] border p-5 backdrop-blur"
            >
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[32px]">
                <div className="from-latte-lavender/10 to-latte-green/10 absolute inset-0 bg-gradient-to-br via-transparent" />
                <div className="bg-latte-lavender/20 absolute -top-24 right-0 h-48 w-48 rounded-full blur-3xl" />
                <div className="from-latte-lavender/70 via-latte-green/30 absolute inset-y-0 left-0 w-1 rounded-l-[32px] bg-gradient-to-b to-transparent" />
              </div>
              <div className="relative flex flex-col gap-4">
                <div className="border-latte-surface2/70 bg-latte-mantle/90 relative overflow-hidden rounded-2xl border px-5 py-4 backdrop-blur">
                  <div className="from-latte-crust/30 to-latte-crust/10 pointer-events-none absolute inset-0 bg-gradient-to-r via-transparent" />
                  <div className="relative">
                    <p className="text-latte-subtext0 text-[10px] uppercase tracking-[0.4em]">
                      Repository
                    </p>
                    <p className="text-latte-text mt-1 text-base font-semibold">
                      {formatRepoLabel(group.repoRoot)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="border-latte-surface2/70 bg-latte-crust/60 text-latte-subtext0 rounded-full border px-3 py-1 font-semibold">
                        {group.sessions.length} sessions
                      </span>
                      <span
                        className={`${groupTone.pill} inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${groupTone.dot}`} />
                        <span className="text-[9px] uppercase tracking-[0.2em]">Latest input</span>
                        <span>{formatRelativeTime(group.lastInputAt, nowMs)}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {group.sessions.map((session) => {
                    const sessionTone = getLastInputTone(session.lastInputAt, nowMs);
                    return (
                      <Link
                        key={session.paneId}
                        to={`/sessions/${encodeURIComponent(session.paneId)}`}
                        className="group"
                      >
                        <Card className="hover:shadow-glow p-6 transition hover:-translate-y-1">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone={stateTone(session.state)}>{session.state}</Badge>
                              </div>
                              {session.pipeConflict && (
                                <span className="bg-latte-red/15 text-latte-red rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em]">
                                  Pipe conflict
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={agentTone(session.agent)}>
                                {agentLabel(session.agent)}
                              </Badge>
                              <span
                                className={`${sessionTone.pill} inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${sessionTone.dot}`} />
                                <span className="text-[9px] uppercase tracking-[0.2em]">
                                  Last input
                                </span>
                                <span>{formatRelativeTime(session.lastInputAt, nowMs)}</span>
                              </span>
                            </div>
                          </div>
                          <div className="mt-4 space-y-3">
                            <h3 className="font-display text-latte-text text-lg">
                              {session.customTitle ?? session.title ?? session.sessionName}
                            </h3>
                            <p className="text-latte-subtext0 text-sm">
                              {formatPath(session.currentPath)}
                            </p>
                            {session.lastMessage && (
                              <p className="text-latte-overlay1 text-xs">{session.lastMessage}</p>
                            )}
                          </div>
                          <div className="text-latte-overlay1 mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                            <span className="border-latte-surface2/60 bg-latte-crust/40 rounded-full border px-3 py-1">
                              Session {session.sessionName}
                            </span>
                            <span className="border-latte-surface2/60 bg-latte-crust/40 rounded-full border px-3 py-1">
                              Window {session.windowIndex}
                            </span>
                            <span className="border-latte-surface2/60 bg-latte-crust/40 rounded-full border px-3 py-1">
                              Pane {session.paneId}
                            </span>
                          </div>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
