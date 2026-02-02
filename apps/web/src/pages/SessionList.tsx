import { Link } from "@tanstack/react-router";
import { Clock, MonitorX, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  Badge,
  Button,
  Callout,
  Card,
  ConnectionStatusPill,
  EmptyCard,
  FilterToggleGroup,
  GlassPanel,
  GlowCard,
  LastInputPill,
  TagPill,
  Toolbar,
} from "@/components/ui";
import {
  agentLabelFor,
  agentToneFor,
  formatPath,
  formatRelativeTime,
  getLastInputTone,
  stateTone,
} from "@/lib/session-format";
import { buildSessionGroups } from "@/lib/session-group";
import { useNowMs } from "@/lib/use-now-ms";
import { useSessions } from "@/state/session-context";

const formatRepoLabel = (value: string | null) => {
  if (!value) return "No repo";
  return formatPath(value);
};

export const SessionListPage = () => {
  const { sessions, connected, connectionIssue, readOnly, reconnect, refreshSessions } =
    useSessions();
  const [filter, setFilter] = useState("ALL");
  const nowMs = useNowMs();

  const filtered = useMemo(() => {
    return sessions.filter((session) => {
      const matchesFilter = filter === "ALL" || session.state === filter;
      return matchesFilter;
    });
  }, [filter, sessions]);

  const groups = useMemo(() => buildSessionGroups(filtered), [filtered]);

  return (
    <div className="animate-fade-in-up mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10 pt-6">
      <div className="flex items-center justify-between gap-3">
        <div />
        <ThemeToggle />
      </div>
      <header className="shadow-glass border-latte-surface1/60 bg-latte-base/80 animate-fade-in stagger-1 flex flex-col gap-4 rounded-[32px] border p-6 opacity-0 backdrop-blur">
        <Toolbar className="gap-3">
          <div>
            <p className="text-latte-subtext0 text-xs uppercase tracking-[0.5em]">vde-monitor</p>
            <h1 className="font-display text-latte-text text-4xl font-semibold tracking-tight">
              Live Sessions
            </h1>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-3">
              <ConnectionStatusPill connected={connected} />
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
        </Toolbar>
        <FilterToggleGroup
          value={filter}
          onChange={setFilter}
          options={["ALL", "RUNNING", "WAITING_INPUT", "WAITING_PERMISSION", "UNKNOWN"].map(
            (state) => ({
              value: state,
              label: state.replace("_", " "),
            }),
          )}
        />
        {readOnly && (
          <Callout tone="warning" size="sm">
            Read-only mode is active. Actions are disabled.
          </Callout>
        )}
        {connectionIssue && (
          <Callout tone="warning" size="sm">
            {connectionIssue}
          </Callout>
        )}
      </header>

      <div className="flex flex-col gap-6">
        {sessions.length === 0 && (
          <EmptyCard
            icon={<MonitorX className="text-latte-overlay1 h-10 w-10" />}
            title="No Active Sessions"
            description="Start a tmux session with Codex or Claude Code to see it here. Sessions will appear automatically when detected."
            className="py-16"
            iconWrapperClassName="bg-latte-surface1/50 h-20 w-20"
            titleClassName="text-xl"
            descriptionClassName="max-w-sm"
            action={
              <Button variant="ghost" size="sm" onClick={refreshSessions} className="mt-2">
                <RefreshCw className="h-4 w-4" />
                Check Again
              </Button>
            }
          />
        )}
        {sessions.length > 0 && groups.length === 0 && (
          <EmptyCard
            icon={<Search className="text-latte-overlay1 h-8 w-8" />}
            title="No Matching Sessions"
            description="No sessions match the selected filter. Try selecting a different status."
            className="py-12"
            iconWrapperClassName="bg-latte-surface1/50 h-16 w-16"
            titleClassName="text-lg"
            action={
              <Button variant="ghost" size="sm" onClick={() => setFilter("ALL")} className="mt-2">
                Show All Sessions
              </Button>
            }
          />
        )}
        {groups.map((group) => {
          const groupTone = getLastInputTone(group.lastInputAt, nowMs);
          return (
            <GlowCard key={group.repoRoot ?? "no-repo"}>
              <GlassPanel>
                <p className="text-latte-subtext0 text-[10px] uppercase tracking-[0.4em]">
                  Repository
                </p>
                <p className="text-latte-text mt-1 text-base font-semibold">
                  {formatRepoLabel(group.repoRoot)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <TagPill tone="neutral">{group.sessions.length} sessions</TagPill>
                  <LastInputPill
                    tone={groupTone}
                    label={<Clock className="h-3 w-3" />}
                    srLabel="Latest input"
                    value={formatRelativeTime(group.lastInputAt, nowMs)}
                    size="md"
                    showDot={false}
                  />
                </div>
              </GlassPanel>
              <div className="grid gap-4 md:grid-cols-2">
                {group.sessions.map((session) => {
                  const sessionTone = getLastInputTone(session.lastInputAt, nowMs);
                  return (
                    <Link
                      key={session.paneId}
                      to="/sessions/$paneId"
                      params={{ paneId: session.paneId }}
                      className="group"
                    >
                      <Card interactive className="p-6">
                        <div className="flex flex-col gap-2">
                          <Toolbar className="gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={stateTone(session.state)}>{session.state}</Badge>
                              <Badge tone={agentToneFor(session.agent)}>
                                {agentLabelFor(session.agent)}
                              </Badge>
                              <LastInputPill
                                tone={sessionTone}
                                label={<Clock className="h-3 w-3" />}
                                srLabel="Last input"
                                value={formatRelativeTime(session.lastInputAt, nowMs)}
                                size="sm"
                                showDot={false}
                              />
                            </div>
                            {session.pipeConflict && <TagPill tone="danger">Pipe conflict</TagPill>}
                          </Toolbar>
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
                          <TagPill tone="meta">Session {session.sessionName}</TagPill>
                          <TagPill tone="meta">Window {session.windowIndex}</TagPill>
                          <TagPill tone="meta">Pane {session.paneId}</TagPill>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </GlowCard>
          );
        })}
      </div>
    </div>
  );
};
