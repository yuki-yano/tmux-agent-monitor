import { RefreshCw } from "lucide-react";

import { Button, Callout, ConnectionStatusPill, FilterToggleGroup, Toolbar } from "@/components/ui";

type SessionListHeaderProps = {
  connectionStatus: "healthy" | "degraded" | "disconnected";
  connectionIssue: string | null;
  filter: string;
  filterOptions: { value: string; label: string }[];
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
};

export const SessionListHeader = ({
  connectionStatus,
  connectionIssue,
  filter,
  filterOptions,
  onFilterChange,
  onRefresh,
}: SessionListHeaderProps) => {
  return (
    <header className="shadow-glass border-latte-surface1/60 bg-latte-base/80 animate-fade-in stagger-1 flex flex-col gap-4 rounded-3xl border p-6 opacity-0 backdrop-blur">
      <Toolbar className="gap-3">
        <div>
          <p className="text-latte-subtext0 text-xs uppercase tracking-[0.5em]">vde-monitor</p>
          <h1 className="font-display text-latte-text text-4xl font-semibold tracking-tight">
            Live Sessions
          </h1>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-3">
            <ConnectionStatusPill status={connectionStatus} />
            <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>
      </Toolbar>
      <FilterToggleGroup
        value={filter}
        onChange={onFilterChange}
        buttonClassName="uppercase tracking-[0.14em] text-[11px] px-3 py-1"
        options={filterOptions}
      />
      {connectionIssue && (
        <Callout tone="warning" size="sm">
          {connectionIssue}
        </Callout>
      )}
    </header>
  );
};
