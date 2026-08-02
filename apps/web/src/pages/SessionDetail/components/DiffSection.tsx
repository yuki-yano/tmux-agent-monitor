import { type DiffFile, type DiffMode, type DiffSummary } from "@vde-monitor/shared";
import { useAtom } from "jotai";
import { FileCheck, RefreshCw, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";

import {
  Button,
  Callout,
  EmptyState,
  IconButton,
  LoadingOverlay,
  Tabs,
  TabsList,
  TabsTrigger,
  TagPill,
  TruncatedSegmentText,
} from "@/components/ui";
import { PaneSectionShell } from "@/features/shared-session-ui/components/PaneSectionShell";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { cn } from "@/lib/cn";
import { formatBranchLabel, formatPath } from "@/lib/session-format";

import { diffExpandedAtom } from "../atoms/diffAtoms";
import { sumFileStats } from "../sessionDetailUtils";
import { DiffFileList } from "./diff-section-file-list";
import { buildRenderedPatches, updateExpandedDiffs } from "./diff-section-file-list-utils";

export type DiffScope =
  | {
      kind: "workingTree";
      mode: DiffMode;
      baseBranch: string | null;
      branch: string | null;
      path: string | null;
      selected: boolean;
    }
  | {
      kind: "branchComparison";
      mode: "committed";
      baseBranch: string | null;
      branch: string;
    };

type DiffSectionState = {
  diffSummary: DiffSummary | null;
  diffError: string | null;
  diffLoading: boolean;
  diffFiles: Record<string, DiffFile>;
  diffOpen: Record<string, boolean>;
  diffLoadingFiles: Record<string, boolean>;
  diffScope: DiffScope;
};

type DiffSectionActions = {
  onRefresh: () => void;
  onToggle: (path: string) => void;
  onPreviewFile: (path: string) => void;
  onClearScope: () => void;
  onModeChange: (mode: DiffMode) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

type DiffSectionProps = {
  state: DiffSectionState;
  actions: DiffSectionActions;
};

const toFileCountLabel = (fileCount: number) => `${fileCount} file${fileCount === 1 ? "" : "s"}`;

const buildVisibleFileChangeCategories = (files: DiffSummary["files"] | null | undefined) => {
  const counts = (files ?? []).reduce(
    (result, file) => {
      if (file.status === "A" || file.status === "?") {
        result.add += 1;
        return result;
      }
      if (file.status === "D") {
        result.d += 1;
        return result;
      }
      result.m += 1;
      return result;
    },
    { add: 0, m: 0, d: 0 },
  );
  return [
    { key: "add", label: "A", value: counts.add, className: "text-latte-green-text" },
    { key: "m", label: "M", value: counts.m, className: "text-latte-yellow-text" },
    { key: "d", label: "D", value: counts.d, className: "text-latte-red-text" },
  ].filter((item) => item.value > 0);
};

const shouldShowCleanState = (diffSummary: DiffSummary | null) =>
  Boolean(diffSummary && diffSummary.files.length === 0 && !diffSummary.reason);

const filterExpandedDiffs = (
  expandedDiffs: Record<string, boolean>,
  files: DiffSummary["files"],
) => {
  const fileSet = new Set(files.map((file) => file.path));
  const next: Record<string, boolean> = {};
  Object.entries(expandedDiffs).forEach(([path, isExpanded]) => {
    if (fileSet.has(path)) {
      next[path] = isExpanded;
    }
  });
  return next;
};

const syncExpandedDiffs = (
  diffSummary: DiffSummary | null,
  setExpandedDiffs: (
    next: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void,
) => {
  if (!diffSummary?.files.length) {
    setExpandedDiffs({});
    return;
  }
  setExpandedDiffs((prev) => filterExpandedDiffs(prev, diffSummary.files));
};

const buildDiffBodyClassName = (diffLoading: boolean) =>
  `relative ${diffLoading ? "min-h-[120px]" : ""}`;

const DiffLoadingOverlay = memo(({ visible }: { visible: boolean }) =>
  visible ? <LoadingOverlay label="Loading changes..." blocking={false} /> : null,
);

DiffLoadingOverlay.displayName = "DiffLoadingOverlay";

const buildCleanStateMessage = (scope: DiffScope) => {
  if (scope.kind === "workingTree" && scope.mode === "uncommitted") {
    return "Working tree is clean";
  }
  if (scope.kind === "workingTree" && scope.mode === "total") {
    return scope.baseBranch == null
      ? "No total changes in the working tree"
      : `No changes from ${formatBranchLabel(scope.baseBranch)} through the working tree`;
  }
  const branch = scope.branch == null ? "HEAD" : formatBranchLabel(scope.branch);
  if (scope.baseBranch == null) {
    return `No committed changes on ${branch}`;
  }
  if (scope.branch === scope.baseBranch) {
    return `No committed changes beyond ${branch}`;
  }
  return `No committed changes on ${branch} since it diverged from ${formatBranchLabel(scope.baseBranch)}`;
};

const DiffCleanState = memo(({ visible, scope }: { visible: boolean; scope: DiffScope }) =>
  visible ? (
    <EmptyState
      icon={<FileCheck className="text-latte-green-text h-6 w-6" />}
      message={buildCleanStateMessage(scope)}
      iconWrapperClassName="bg-latte-green/10"
    />
  ) : null,
);

DiffCleanState.displayName = "DiffCleanState";

const buildDiffScopeLabel = (scope: DiffScope) => {
  const branch = scope.branch == null ? "HEAD" : formatBranchLabel(scope.branch);
  const baseBranch = scope.baseBranch == null ? null : formatBranchLabel(scope.baseBranch);
  const committedRange = baseBranch == null ? branch : `${baseBranch}...${branch}`;
  if (scope.kind === "branchComparison" || scope.mode === "committed") {
    return committedRange;
  }
  if (scope.mode === "uncommitted") {
    return `${branch} → working tree`;
  }
  const totalStart = baseBranch === branch ? branch : committedRange;
  return `${totalStart} → working tree`;
};

const getScopeNoticeLabel = (scope: DiffScope) => {
  if (scope.kind === "branchComparison") {
    return "Branch changes";
  }
  if (scope.mode === "total") {
    return "Total changes";
  }
  if (scope.mode === "committed") {
    return "Committed changes";
  }
  return "Uncommitted changes";
};

const DiffModeSelector = memo(
  ({ mode, onModeChange }: { mode: DiffMode; onModeChange: (mode: DiffMode) => void }) => (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (value === "total" || value === "committed" || value === "uncommitted") {
          onModeChange(value);
        }
      }}
    >
      <TabsList aria-label="Change layer" className="my-1">
        <TabsTrigger
          value="total"
          title="Changes from the base branch through the working tree"
          className="min-h-8"
        >
          Total
        </TabsTrigger>
        <TabsTrigger
          value="committed"
          title="Committed changes from the base branch to HEAD"
          className="min-h-8"
        >
          Committed
        </TabsTrigger>
        <TabsTrigger
          value="uncommitted"
          title="Uncommitted changes from HEAD to the working tree"
          className="min-h-8"
        >
          Uncommitted
        </TabsTrigger>
      </TabsList>
    </Tabs>
  ),
);

DiffModeSelector.displayName = "DiffModeSelector";

const DiffScopeNotice = memo(({ scope, onClear }: { scope: DiffScope; onClear: () => void }) => {
  if (scope.kind === "workingTree" && !scope.selected) {
    return null;
  }
  const isBranchComparison = scope.kind === "branchComparison";
  const scopeLabel = buildDiffScopeLabel(scope);
  const visibleDetail =
    scope.kind === "workingTree" && scope.path != null
      ? `${scopeLabel ?? "No branch"} · ${formatPath(scope.path)}`
      : (scopeLabel ?? "No branch");
  const detailTitle =
    scope.kind === "workingTree" && scope.path != null
      ? `${scopeLabel ?? "No branch"} · ${scope.path}`
      : visibleDetail;
  const clearLabel = isBranchComparison
    ? "Return to current working tree"
    : "Return to session worktree";

  return (
    <div
      className="-mt-1 flex min-w-0 items-center justify-between gap-2"
      data-testid="diff-scope-notice"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <TagPill
          tone="meta"
          className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
        >
          {getScopeNoticeLabel(scope)}
        </TagPill>
        <span
          className="text-latte-subtext0 min-w-0 truncate font-mono text-[11px]"
          title={detailTitle}
        >
          {visibleDetail}
        </span>
      </div>
      <IconButton
        type="button"
        size="xs"
        variant="dangerOutline"
        aria-label={clearLabel}
        title={clearLabel}
        className="shrink-0"
        onClick={onClear}
      >
        <X className="h-3 w-3" />
      </IconButton>
    </div>
  );
});

DiffScopeNotice.displayName = "DiffScopeNotice";

const DiffRepoRoot = memo(({ repoRoot }: { repoRoot: string | null | undefined }) =>
  repoRoot ? <p className="text-latte-subtext0 text-xs">Repo: {formatPath(repoRoot)}</p> : null,
);

DiffRepoRoot.displayName = "DiffRepoRoot";

const DiffSummaryReasonCallout = memo(
  ({ reason }: { reason: DiffSummary["reason"] | undefined }) => {
    if (reason === "cwd_unknown") {
      return (
        <Callout tone="warning" size="xs">
          Working directory is unknown for this session.
        </Callout>
      );
    }
    if (reason === "not_git") {
      return (
        <Callout tone="warning" size="xs">
          Current directory is not a git repository.
        </Callout>
      );
    }
    if (reason === "default_branch_unavailable") {
      return (
        <Callout tone="warning" size="xs">
          A default branch is required for Total and Committed changes. Uncommitted changes are
          still available.
        </Callout>
      );
    }
    if (reason === "error") {
      return (
        <Callout tone="error" size="xs">
          {API_ERROR_MESSAGES.diffSummary}.
        </Callout>
      );
    }
    return null;
  },
);

DiffSummaryReasonCallout.displayName = "DiffSummaryReasonCallout";

const DiffErrorCallout = memo(({ diffError }: { diffError: string | null }) => {
  if (!diffError) {
    return null;
  }
  return (
    <Callout tone="error" size="xs">
      {diffError}
    </Callout>
  );
});

DiffErrorCallout.displayName = "DiffErrorCallout";

const DiffSummaryDescription = memo(
  ({
    fileCount,
    diffScope,
    showTotals,
    totals,
    fileChangeCategories,
  }: {
    fileCount: number;
    diffScope: DiffScope;
    showTotals: boolean;
    totals: ReturnType<typeof sumFileStats>;
    fileChangeCategories: ReturnType<typeof buildVisibleFileChangeCategories>;
  }) => {
    const scopeLabel = buildDiffScopeLabel(diffScope);
    return (
      <span
        data-testid="diff-summary-line"
        className="flex w-full min-w-0 items-center gap-1.5 whitespace-nowrap"
      >
        <span className="shrink-0">{toFileCountLabel(fileCount)}</span>
        {showTotals ? (
          <span className="flex min-w-0 shrink items-center gap-2 text-xs">
            {fileChangeCategories.map((item) => (
              <TagPill
                key={item.key}
                tone="meta"
                className={cn(
                  item.className,
                  "px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em]",
                )}
              >
                {item.label} {item.value}
              </TagPill>
            ))}
            <span className="text-latte-green-text tabular-nums">+{totals?.additions ?? "—"}</span>
            <span className="text-latte-red-text tabular-nums">-{totals?.deletions ?? "—"}</span>
          </span>
        ) : null}
        {scopeLabel ? (
          <span className="text-latte-subtext0 flex min-w-0 flex-1 items-center gap-1 font-mono text-[11px]">
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <TruncatedSegmentText
              data-testid="diff-scope-text"
              text={scopeLabel}
              reservePx={6}
              minVisibleSegments={2}
              className="min-w-0 flex-1 pr-0.5 text-left"
            />
          </span>
        ) : null}
      </span>
    );
  },
);

DiffSummaryDescription.displayName = "DiffSummaryDescription";

export const DiffSection = memo(({ state, actions }: DiffSectionProps) => {
  const { diffSummary, diffError, diffLoading, diffFiles, diffOpen, diffLoadingFiles, diffScope } =
    state;
  const {
    onRefresh,
    onToggle,
    onPreviewFile,
    onClearScope,
    onModeChange,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  } = actions;
  const [expandedDiffs, setExpandedDiffs] = useAtom(diffExpandedAtom);
  const totals = useMemo(() => sumFileStats(diffSummary?.files), [diffSummary]);
  const fileChangeCategories = useMemo(
    () => buildVisibleFileChangeCategories(diffSummary?.files),
    [diffSummary],
  );
  const files = diffSummary?.files ?? [];
  const fileCount = files.length;
  const showCleanState = shouldShowCleanState(diffSummary);
  const showTotals = Boolean(diffSummary);

  useEffect(() => {
    syncExpandedDiffs(diffSummary, setExpandedDiffs);
  }, [diffSummary, setExpandedDiffs]);

  const handleExpandDiff = useCallback(
    (path: string) => {
      setExpandedDiffs((prev) => updateExpandedDiffs(prev, path));
    },
    [setExpandedDiffs],
  );

  const renderedPatches = useMemo(
    () => buildRenderedPatches(diffOpen, diffFiles, expandedDiffs),
    [diffOpen, diffFiles, expandedDiffs],
  );
  const sectionDescription = useMemo(
    () => (
      <DiffSummaryDescription
        fileCount={fileCount}
        diffScope={diffScope}
        showTotals={showTotals}
        totals={totals}
        fileChangeCategories={fileChangeCategories}
      />
    ),
    [diffScope, fileChangeCategories, fileCount, showTotals, totals],
  );
  const sectionAction = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        className="text-latte-subtext0 hover:text-latte-text relative h-[30px] w-[30px] shrink-0 self-start p-0 after:absolute after:-inset-[7px] after:content-['']"
        onClick={onRefresh}
        disabled={diffLoading}
        aria-label="Refresh changes"
      >
        <RefreshCw className="h-4 w-4" />
        <span className="sr-only">Refresh</span>
      </Button>
    ),
    [diffLoading, onRefresh],
  );
  const sectionStatus = useMemo(
    () => (
      <>
        {diffScope.kind === "workingTree" ? (
          <DiffModeSelector mode={diffScope.mode} onModeChange={onModeChange} />
        ) : null}
        <DiffScopeNotice scope={diffScope} onClear={onClearScope} />
        <DiffRepoRoot repoRoot={diffSummary?.repoRoot} />
        <DiffSummaryReasonCallout reason={diffSummary?.reason} />
        <DiffErrorCallout diffError={diffError} />
      </>
    ),
    [diffError, diffScope, diffSummary?.reason, diffSummary?.repoRoot, onClearScope, onModeChange],
  );

  return (
    <PaneSectionShell
      title="Changes"
      description={sectionDescription}
      action={sectionAction}
      status={sectionStatus}
      headerTestId="changes-header"
    >
      <div className={buildDiffBodyClassName(diffLoading)}>
        <DiffLoadingOverlay visible={diffLoading} />
        <DiffCleanState visible={showCleanState} scope={diffScope} />
        <DiffFileList
          files={files}
          diffOpen={diffOpen}
          diffLoadingFiles={diffLoadingFiles}
          diffFiles={diffFiles}
          renderedPatches={renderedPatches}
          previewEnabled={diffScope.kind === "workingTree" && diffScope.mode !== "committed"}
          onToggle={onToggle}
          onPreviewFile={onPreviewFile}
          onExpandDiff={handleExpandDiff}
          onResolveFileReference={onResolveFileReference}
          onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
        />
      </div>
    </PaneSectionShell>
  );
});

DiffSection.displayName = "DiffSection";
