import { LayoutPanelTop } from "lucide-react";

import type { WorkspaceTab } from "../model/workspace-tabs";

type WorkspaceOverviewTabProps = {
  tab: WorkspaceTab;
  active: boolean;
  onActivate: (tabId: string) => void;
};

export const WorkspaceOverviewTab = ({ tab, active, onActivate }: WorkspaceOverviewTabProps) => (
  <button
    type="button"
    role="tab"
    style={{ gridColumn: 1, gridRow: 1 }}
    aria-selected={active}
    tabIndex={active ? 0 : -1}
    data-tab-id={tab.id}
    onClick={() => onActivate(tab.id)}
    className={[
      "text-latte-subtext0 hover:text-latte-text hover:border-latte-blue/45 relative inline-flex h-8 min-w-0 items-center gap-1.5 rounded-xl border border-[var(--control-stroke)] bg-[var(--control-track)] px-2 text-[11px] font-semibold transition-[scale,background-color,color,border-color,box-shadow] duration-200 ease-out after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] active:scale-[0.96] active:duration-100",
      "data-[active=true]:border-latte-blue/70 data-[active=true]:bg-latte-blue/16 data-[active=true]:text-latte-text data-[active=true]:shadow-[inset_0_0_0_1px_rgb(var(--ctp-blue)/0.14),0_1px_3px_rgb(var(--ctp-shadow)/0.14)]",
    ].join(" ")}
    data-active={active ? "true" : "false"}
  >
    <span className="bg-latte-blue/85 border-latte-overlay2/60 h-2.5 w-2.5 rounded-full border" />
    <LayoutPanelTop className="h-3.5 w-3.5" />
    <span>S</span>
  </button>
);
