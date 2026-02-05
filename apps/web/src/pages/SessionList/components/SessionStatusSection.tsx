import type { SessionStateValue } from "@vde-monitor/shared";

import { Badge, GlassPanel, TagPill } from "@/components/ui";
import { statusIconMeta } from "@/lib/quick-panel-utils";
import { stateTone } from "@/lib/session-format";
import type { SessionGroup } from "@/lib/session-group";

import { SessionGroupSection } from "./SessionGroupSection";

type SessionStatusSectionProps = {
  state: SessionStateValue;
  groups: SessionGroup[];
  count: number;
  nowMs: number;
};

const statusDescriptions: Record<SessionStateValue, string> = {
  RUNNING: "アクティブに処理中のセッション",
  WAITING_INPUT: "入力待ちのセッション",
  WAITING_PERMISSION: "許可待ちのセッション",
  SHELL: "シェルのセッション",
  UNKNOWN: "その他のプロセス",
};

const formatStatusLabel = (state: SessionStateValue) => state.replace(/_/g, " ");

export const SessionStatusSection = ({
  state,
  groups,
  count,
  nowMs,
}: SessionStatusSectionProps) => {
  const statusMeta = statusIconMeta(state);
  const StatusIcon = statusMeta.icon;

  return (
    <section className="space-y-4">
      <GlassPanel
        className="px-4 py-3 sm:px-5 sm:py-4"
        contentClassName="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border ${statusMeta.wrap}`}
            aria-label={statusMeta.label}
          >
            <StatusIcon className={`h-5 w-5 ${statusMeta.className}`} />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={stateTone(state)} size="sm">
                {formatStatusLabel(state)}
              </Badge>
              <TagPill tone="neutral" className="text-[11px]">
                {count} sessions
              </TagPill>
            </div>
            <p className="text-latte-subtext0 text-xs">{statusDescriptions[state]}</p>
          </div>
        </div>
      </GlassPanel>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <SessionGroupSection key={group.repoRoot ?? "no-repo"} group={group} nowMs={nowMs} />
        ))}
      </div>
    </section>
  );
};
