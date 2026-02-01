import { List, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { agentIconMeta, formatRepoDirLabel, statusIconMeta } from "@/lib/quick-panel-utils";
import type { SessionGroup } from "@/lib/session-group";

import { formatRelativeTime, getLastInputTone } from "../sessionDetailUtils";

type QuickPanelProps = {
  open: boolean;
  sessionGroups: SessionGroup[];
  nowMs: number;
  onOpenLogModal: (paneId: string) => void;
  onClose: () => void;
  onToggle: () => void;
};

export const QuickPanel = ({
  open,
  sessionGroups,
  nowMs,
  onOpenLogModal,
  onClose,
  onToggle,
}: QuickPanelProps) => {
  return (
    <div className="fixed bottom-4 left-6 z-40 flex flex-col items-start gap-3">
      {open && (
        <Card className="font-body animate-panel-enter border-latte-lavender/30 bg-latte-mantle/85 relative max-h-[72vh] w-[calc(100vw-3rem)] max-w-[320px] overflow-hidden rounded-[28px] border-2 p-4 shadow-[0_25px_80px_-20px_rgba(114,135,253,0.4),0_0_0_1px_rgba(114,135,253,0.15)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
          <button
            type="button"
            onClick={onClose}
            className="border-latte-lavender/40 bg-latte-lavender/10 text-latte-lavender hover:border-latte-lavender/60 hover:bg-latte-lavender/20 absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition"
            aria-label="Close quick panel"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="custom-scrollbar mt-2 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            {sessionGroups.length === 0 && (
              <div className="border-latte-lavender/20 bg-latte-crust/50 text-latte-subtext0 rounded-2xl border px-3 py-4 text-center text-xs">
                No sessions available.
              </div>
            )}
            {sessionGroups.map((group) => (
              <div key={group.repoRoot ?? "no-repo"} className="space-y-2">
                <div className="text-latte-lavender/70 px-2 text-[11px] font-semibold uppercase tracking-wider">
                  {formatRepoDirLabel(group.repoRoot)}
                </div>
                <div className="space-y-2">
                  {group.sessions.map((item) => {
                    const displayTitle = item.customTitle ?? item.title ?? item.sessionName;
                    const lastInputTone = getLastInputTone(item.lastInputAt ?? null, nowMs);
                    const statusMeta = statusIconMeta(item.state);
                    const agentMeta = agentIconMeta(item.agent);
                    const StatusIcon = statusMeta.icon;
                    const AgentIcon = agentMeta.icon;
                    return (
                      <button
                        key={item.paneId}
                        type="button"
                        onClick={() => onOpenLogModal(item.paneId)}
                        className="border-latte-surface2/50 bg-latte-crust/60 hover:border-latte-lavender/50 hover:bg-latte-crust/80 w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 hover:shadow-[0_4px_12px_rgba(114,135,253,0.15)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${statusMeta.wrap}`}
                              aria-label={statusMeta.label}
                            >
                              <StatusIcon className={`h-3.5 w-3.5 ${statusMeta.className}`} />
                            </span>
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${agentMeta.wrap}`}
                              aria-label={agentMeta.label}
                            >
                              <AgentIcon className={`h-3.5 w-3.5 ${agentMeta.className}`} />
                            </span>
                            <span className="text-latte-text text-sm font-semibold">
                              {displayTitle}
                            </span>
                          </div>
                          <span
                            className={`${lastInputTone.pill} inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${lastInputTone.dot}`} />
                            <span className="text-[9px] uppercase tracking-[0.2em]">Last</span>
                            <span>{formatRelativeTime(item.lastInputAt, nowMs)}</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="border-latte-lavender/50 bg-latte-lavender/15 text-latte-lavender hover:border-latte-lavender/70 hover:bg-latte-lavender/25 focus-visible:ring-latte-lavender inline-flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-[0_0_0_1px_rgba(114,135,253,0.2)] backdrop-blur-xl transition-all duration-200 hover:shadow-[0_0_20px_rgba(114,135,253,0.4)] focus-visible:outline-none focus-visible:ring-2"
        aria-label="Toggle session quick panel"
      >
        <List className="h-5 w-5" />
      </button>
    </div>
  );
};
