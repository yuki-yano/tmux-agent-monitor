import { Grid2x2 } from "lucide-react";

import { SYSTEM_CHAT_GRID_TAB_ID, type WorkspaceTab } from "../model/workspace-tabs";

export type StaticTabChipProps = {
  tab: WorkspaceTab;
  label: string;
  active: boolean;
  statusClassName: string;
};

export const StaticTabChip = ({ tab, label, active, statusClassName }: StaticTabChipProps) => {
  return (
    <div className="flex items-center gap-1">
      {tab.id === SYSTEM_CHAT_GRID_TAB_ID && (
        <span className="text-latte-overlay1 inline-flex h-4 w-4 items-center justify-center">
          <Grid2x2 className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
      <div
        className={[
          "text-latte-subtext0 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-xl border border-[var(--control-stroke)] bg-[var(--control-track)] pl-2 text-[11px] font-semibold",
          active
            ? "border-latte-blue/70 bg-latte-blue/16 text-latte-text pr-5 shadow-[inset_0_0_0_1px_rgb(var(--ctp-blue)/0.14)]"
            : "pr-2",
        ].join(" ")}
      >
        <span
          className={`border-latte-overlay2/60 h-2.5 w-2.5 shrink-0 rounded-full border ${statusClassName}`}
          aria-hidden="true"
        />
        <span className="max-w-[5.2rem] truncate" title={label}>
          {label}
        </span>
      </div>
    </div>
  );
};
