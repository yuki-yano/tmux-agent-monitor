import type { WorktreeListEntry } from "@vde-monitor/shared";
import { GitBranch, RefreshCw, X } from "lucide-react";

import { IconButton } from "@/components/ui";

import { WorktreeEntryList } from "./WorktreeEntryList";
import { WorktreeStatusStack } from "./WorktreeStatusStack";

type ScreenPanelWorktreeSelectorPanelProps = {
  entries: WorktreeListEntry[];
  worktreeRepoRoot: string | null;
  worktreeBaseBranch: string | null;
  virtualWorktreePath: string | null;
  actualWorktreePath: string | null;
  worktreeSelectorLoading: boolean;
  worktreeSelectorError: string | null;
  onRefresh: () => void;
  onClose: () => void;
  onSelectVirtualWorktree?: (path: string) => void;
};

export const ScreenPanelWorktreeSelectorPanel = ({
  entries,
  worktreeRepoRoot,
  worktreeBaseBranch,
  virtualWorktreePath,
  actualWorktreePath,
  worktreeSelectorLoading,
  worktreeSelectorError,
  onRefresh,
  onClose,
  onSelectVirtualWorktree,
}: ScreenPanelWorktreeSelectorPanelProps) => {
  const showBlockingWorktreeLoading = worktreeSelectorLoading && entries.length === 0;

  return (
    <div
      data-testid="worktree-selector-panel"
      className="border-latte-surface2/80 bg-latte-base/95 shadow-popover absolute left-0 top-[calc(100%+0.35rem)] z-80 w-[min(88vw,420px)] rounded-xl border p-2 pt-9"
    >
      <div className="absolute right-1.5 top-1.5 flex items-center gap-2">
        <IconButton
          type="button"
          size="xs"
          variant="base"
          aria-label="Reload worktrees"
          title="Reload worktrees"
          onClick={onRefresh}
        >
          <RefreshCw className="h-3 w-3" />
        </IconButton>
        <IconButton
          type="button"
          size="xs"
          variant="base"
          aria-label="Close worktree selector"
          title="Close worktree selector"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </IconButton>
      </div>
      <div className="pointer-events-none absolute inset-x-2 top-1.5 flex h-6 items-center gap-1.5 pr-14">
        <GitBranch className="text-latte-subtext0 h-3 w-3 shrink-0" />
        <span className="text-latte-subtext0 text-[10px] font-semibold uppercase leading-none tracking-[0.14em]">
          Worktrees
        </span>
      </div>
      <div>
        <WorktreeStatusStack
          loading={worktreeSelectorLoading}
          error={worktreeSelectorError}
          entriesCount={entries.length}
        />
        {!showBlockingWorktreeLoading && !worktreeSelectorError ? (
          <div className="custom-scrollbar max-h-[280px] space-y-1 overflow-y-auto pr-0.5">
            <WorktreeEntryList
              entries={entries}
              worktreeRepoRoot={worktreeRepoRoot}
              worktreeBaseBranch={worktreeBaseBranch}
              virtualWorktreePath={virtualWorktreePath}
              actualWorktreePath={actualWorktreePath}
              onSelectVirtualWorktree={onSelectVirtualWorktree}
              onAfterSelect={onClose}
              variant="selector"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};
