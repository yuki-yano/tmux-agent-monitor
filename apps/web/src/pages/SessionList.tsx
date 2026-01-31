import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const formatPath = (value: string | null) => {
  if (!value) return "—";
  const match = value.match(/^\/(Users|home)\/[^/]+(\/.*)?$/);
  if (match) {
    return `~${match[2] ?? ""}`;
  }
  return value;
};

export const SessionListPage = () => {
  const { sessions, connected, connectionIssue, readOnly, reconnect, refreshSessions } =
    useSessions();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesFilter = filter === "ALL" || session.state === filter;
      if (!matchesFilter) return false;
      if (!lower) return true;
      const haystack =
        `${session.sessionName} ${session.currentCommand ?? ""} ${session.currentPath ?? ""} ${session.title ?? ""}`.toLowerCase();
      return haystack.includes(lower);
    });
  }, [filter, query, sessions]);

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
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <Input
              placeholder="Search by command, path, session..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
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

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((session) => (
          <Link
            key={session.paneId}
            to={`/sessions/${encodeURIComponent(session.paneId)}`}
            className="group"
          >
            <Card className="hover:shadow-glow transition hover:-translate-y-1">
              <div className="flex items-center justify-between">
                <Badge tone={stateTone(session.state)}>{session.state}</Badge>
                {session.pipeConflict && (
                  <span className="bg-latte-red/15 text-latte-red rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em]">
                    Pipe conflict
                  </span>
                )}
              </div>
              <div className="mt-4 space-y-2">
                <h3 className="font-display text-latte-text text-lg">
                  {session.title ?? session.sessionName}
                </h3>
                <p className="text-latte-subtext0 text-sm">
                  {session.currentCommand ?? "unknown"} · {formatPath(session.currentPath)}
                </p>
                {session.lastMessage && (
                  <p className="text-latte-overlay1 text-xs">{session.lastMessage}</p>
                )}
              </div>
              <div className="text-latte-overlay1 mt-4 flex items-center justify-between text-xs">
                <span>Pane {session.paneId}</span>
                <span>{session.agent}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
};
