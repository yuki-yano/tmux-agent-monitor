import type { BranchListEntry } from "@vde-monitor/shared";
import { Plus, RefreshCw, X } from "lucide-react";
import { memo, useState } from "react";

import { Button, Card, IconButton } from "@/components/ui";

import { BranchCheckoutDialog } from "./branch-section/BranchCheckoutDialog";
import { BranchCreateDialog } from "./branch-section/BranchCreateDialog";
import { BranchDeleteDialog } from "./branch-section/BranchDeleteDialog";
import { BranchEntryList } from "./branch-section/BranchEntryList";
import { WorktreeStatusStack } from "./WorktreeStatusStack";

type BranchSectionState = {
  branches: BranchListEntry[];
  repoRoot: string | null;
  currentBranch: string | null;
  virtualBranch: string | null;
  branchesLoading: boolean;
  branchesError: string | null;
  mutating: { kind: "checkout" | "create" | "delete"; name: string } | null;
  mutationError: string | null;
  nowMs: number;
};

type BranchSectionActions = {
  onRefreshBranches: () => void;
  onSelectVirtualBranch: (name: string) => void;
  onClearVirtualBranch: () => void;
  onCheckoutBranch: (name: string) => Promise<boolean>;
  onCreateBranch: (name: string, base?: string) => Promise<boolean>;
  onDeleteBranch: (name: string, options?: { force?: boolean }) => Promise<boolean>;
  onClearMutationError: () => void;
};

type BranchSectionProps = {
  state: BranchSectionState;
  actions: BranchSectionActions;
};

export const BranchSection = memo(({ state, actions }: BranchSectionProps) => {
  const {
    branches,
    repoRoot,
    currentBranch,
    virtualBranch,
    branchesLoading,
    branchesError,
    mutating,
    mutationError,
    nowMs,
  } = state;
  const [createOpen, setCreateOpen] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState<BranchListEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BranchListEntry | null>(null);
  const isVirtualActive = virtualBranch != null;
  const showBlockingLoading = branchesLoading && branches.length === 0;

  return (
    <Card className="flex flex-col gap-2" data-testid="branch-section">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-latte-text text-base font-semibold tracking-wide">
            Branches
          </h2>
          <p className="text-latte-subtext0 min-w-0 overflow-hidden text-sm">
            {branches.length} branches
            {isVirtualActive ? " · Virtual active" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-start">
          <Button
            variant="ghost"
            size="sm"
            className="text-latte-subtext0 hover:text-latte-text relative h-[30px] w-[30px] p-0 after:absolute after:-inset-y-[7px] after:-inset-x-0.5 after:content-['']"
            onClick={() => {
              actions.onClearMutationError();
              setCreateOpen(true);
            }}
            aria-label="Create branch"
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">Create branch</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-latte-subtext0 hover:text-latte-text relative h-[30px] w-[30px] p-0 after:absolute after:-inset-y-[7px] after:-inset-x-0.5 after:content-['']"
            onClick={actions.onRefreshBranches}
            disabled={branchesLoading}
            aria-label="Refresh branches"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>
      {isVirtualActive ? (
        <div className="-mt-1 flex justify-end">
          <IconButton
            type="button"
            size="xs"
            variant="dangerOutline"
            aria-label="Clear virtual branch"
            title="Clear virtual branch"
            className="shrink-0"
            onClick={actions.onClearVirtualBranch}
          >
            <X className="h-3 w-3" />
          </IconButton>
        </div>
      ) : null}
      {mutationError && !createOpen && checkoutTarget == null && deleteTarget == null ? (
        <p className="text-latte-red-text whitespace-pre-wrap text-xs">{mutationError}</p>
      ) : null}
      <WorktreeStatusStack
        loading={branchesLoading}
        error={branchesError}
        entriesCount={branches.length}
        loadingMessage="Loading branches..."
        emptyMessage="No branches available."
      />
      {!showBlockingLoading && !branchesError ? (
        <div className="space-y-1">
          <BranchEntryList
            entries={branches}
            repoRoot={repoRoot}
            virtualBranch={virtualBranch}
            mutatingBranch={mutating?.name ?? null}
            nowMs={nowMs}
            onSelectVirtualBranch={actions.onSelectVirtualBranch}
            onRequestCheckoutBranch={(entry) => {
              actions.onClearMutationError();
              setCheckoutTarget(entry);
            }}
            onRequestDeleteBranch={(entry) => {
              actions.onClearMutationError();
              setDeleteTarget(entry);
            }}
          />
        </div>
      ) : null}
      <BranchCreateDialog
        open={createOpen}
        branches={branches}
        currentBranch={currentBranch}
        creating={mutating?.kind === "create"}
        error={createOpen ? mutationError : null}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            actions.onClearMutationError();
          }
        }}
        onCreate={(name, base) => {
          void actions.onCreateBranch(name, base).then((ok) => {
            if (ok) {
              setCreateOpen(false);
            }
          });
        }}
      />
      <BranchCheckoutDialog
        entry={checkoutTarget}
        checkingOut={mutating?.kind === "checkout"}
        error={checkoutTarget != null ? mutationError : null}
        onOpenChange={(open) => {
          if (!open) {
            setCheckoutTarget(null);
            actions.onClearMutationError();
          }
        }}
        onCheckout={(name) => {
          void actions.onCheckoutBranch(name).then((ok) => {
            if (ok) {
              setCheckoutTarget(null);
            }
          });
        }}
      />
      <BranchDeleteDialog
        entry={deleteTarget}
        deleting={mutating?.kind === "delete"}
        error={deleteTarget != null ? mutationError : null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            actions.onClearMutationError();
          }
        }}
        onDelete={(name, options) => {
          void actions.onDeleteBranch(name, options).then((ok) => {
            if (ok) {
              setDeleteTarget(null);
            }
          });
        }}
      />
    </Card>
  );
});

BranchSection.displayName = "BranchSection";
