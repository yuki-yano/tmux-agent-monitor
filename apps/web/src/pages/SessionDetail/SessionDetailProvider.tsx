import { type ReactNode, createContext, use, useCallback, useMemo } from "react";

import { usePushNotifications } from "@/features/notifications/use-push-notifications";

import { useSessionBranches } from "./hooks/useSessionBranches";
import { useSessionCommits } from "./hooks/useSessionCommits";
import { useSessionDetailScreenControls } from "./hooks/useSessionDetailScreenControls";
import { useSessionDetailTimelineLogsActions } from "./hooks/useSessionDetailTimelineLogsActions";
import { useSessionDoneAcknowledgement } from "./hooks/useSessionDoneAcknowledgement";
import { useSessionDetailVMState } from "./hooks/useSessionDetailVMState";
import { useSessionDiffs } from "./hooks/useSessionDiffs";
import { useSessionFiles } from "./hooks/useSessionFiles";
import { useSessionRepoPins } from "./hooks/useSessionRepoPins";
import { useSessionVirtualBranch } from "./hooks/useSessionVirtualBranch";
import { useSessionVirtualWorktree } from "./hooks/useSessionVirtualWorktree";
import { resolveSessionFileRoot } from "./sessionDetailUtils";

// SessionDetailContext holds the state that genuinely needs to be shared across
// multiple, non-nested SessionDetail sections (ScreenPanel, BranchSection,
// WorktreeSection, DiffSection, CommitSection, FileNavigatorSection, ...), plus
// state whose mutations are entangled with that shared state (e.g. branch
// checkout has to refresh diffs/commits/worktrees together).
// Sections backed by an independent, single-consumer subhook (notes, title)
// call that subhook directly at their point of use instead of storing it here.
type PushNotifications = ReturnType<typeof usePushNotifications>;

const useSessionDetailContextValue = (paneId: string, pushNotifications: PushNotifications) => {
  const base = useSessionDetailVMState(paneId);
  useSessionDoneAcknowledgement({
    paneId,
    session: base.session,
    acknowledgeSessionView: base.acknowledgeSessionView,
  });

  const { getRepoSortAnchorAt, touchRepoSortAnchor, sessionGroups } = useSessionRepoPins({
    sessions: base.sessions,
  });

  const terminal = useSessionDetailScreenControls({
    paneId,
    connected: base.connected,
    connectionIssue: base.connectionIssue,
    resolvedTheme: base.resolvedTheme,
    sessionAgent: base.session?.agent ?? null,
    highlightCorrections: base.highlightCorrections,
    requestScreen: base.requestScreen,
    sendText: base.sendText,
    sendKeys: base.sendKeys,
    sendRaw: base.sendRaw,
    killPane: base.killPane,
    killWindow: base.killWindow,
    uploadImageAttachment: base.uploadImageAttachment,
    apiBaseUrl: base.apiBaseUrl,
    token: base.token,
  });

  const virtualWorktree = useSessionVirtualWorktree({
    paneId,
    session: base.session,
    requestWorktrees: base.requestWorktrees,
  });

  const branches = useSessionBranches({
    paneId,
    connected: base.connected,
    session: base.session,
    requestBranches: base.requestBranches,
    requestBranchCheckout: base.requestBranchCheckout,
    requestBranchCreate: base.requestBranchCreate,
    requestBranchDelete: base.requestBranchDelete,
  });

  const virtualBranch = useSessionVirtualBranch({
    paneId,
    branchList: branches.branchList,
  });

  // A virtual branch and a virtual worktree selection are mutually exclusive.
  const selectVirtualBranch = useCallback(
    (name: string) => {
      virtualWorktree.clearVirtualWorktree();
      virtualBranch.selectVirtualBranch(name);
    },
    [virtualBranch, virtualWorktree],
  );
  const selectVirtualWorktree = useCallback(
    (path: string) => {
      virtualBranch.clearVirtualBranch();
      virtualWorktree.selectVirtualWorktree(path);
    },
    [virtualBranch, virtualWorktree],
  );

  const effectiveBranchScope = virtualBranch.virtualBranch;
  const effectiveWorktreeScope = effectiveBranchScope
    ? null
    : virtualWorktree.effectiveWorktreePath;

  const diffs = useSessionDiffs({
    paneId,
    repoRoot: base.session?.repoRoot ?? null,
    connected: base.connected,
    worktreePath: effectiveWorktreeScope,
    branch: effectiveBranchScope,
    requestDiffSummary: base.requestDiffSummary,
    requestDiffFile: base.requestDiffFile,
  });

  const commits = useSessionCommits({
    paneId,
    connected: base.connected,
    worktreePath: effectiveWorktreeScope,
    branch: effectiveBranchScope,
    requestCommitLog: base.requestCommitLog,
    requestCommitDetail: base.requestCommitDetail,
    requestCommitFile: base.requestCommitFile,
  });

  const checkoutBranch = useCallback(
    async (name: string) => {
      const wasVirtualBranchActive = virtualBranch.virtualBranch != null;
      const ok = await branches.checkoutBranch(name);
      if (ok) {
        virtualBranch.clearVirtualBranch();
        // Clearing an active virtual branch changes the diff/commit scope key,
        // which re-triggers their load effects with the new scope. Explicitly
        // refreshing here would fire the captured stale branch-scoped requests,
        // so only refresh when the scope stays the same.
        if (!wasVirtualBranchActive) {
          void diffs.refreshDiff();
          void commits.refreshCommitLog();
        }
        void virtualWorktree.refreshWorktrees();
      }
      return ok;
    },
    [branches, commits, diffs, virtualBranch, virtualWorktree],
  );

  const createBranch = useCallback(
    async (name: string, base?: string) => {
      const ok = await branches.createBranch(name, base);
      if (ok) {
        void virtualWorktree.refreshWorktrees();
      }
      return ok;
    },
    [branches, virtualWorktree],
  );

  const deleteBranch = useCallback(
    async (name: string, options?: { force?: boolean }) => {
      const ok = await branches.deleteBranch(name, options);
      if (ok) {
        void virtualWorktree.refreshWorktrees();
      }
      return ok;
    },
    [branches, virtualWorktree],
  );

  const fileRoot = resolveSessionFileRoot(base.session, virtualWorktree.effectiveWorktreePath);
  const files = useSessionFiles({
    paneId,
    repoRoot: fileRoot,
    worktreePath: virtualWorktree.effectiveWorktreePath,
    autoExpandMatchLimit: base.fileNavigatorConfig.autoExpandMatchLimit,
    requestRepoFileTree: base.requestRepoFileTree,
    requestRepoFileSearch: base.requestRepoFileSearch,
    requestRepoFileContent: base.requestRepoFileContent,
    revokeRepoFilePreview: base.revokeRepoFilePreview,
  });

  const currentRepoRoot = base.session?.repoRoot ?? null;
  const timelineLogsActions = useSessionDetailTimelineLogsActions({
    paneId,
    connected: base.connected,
    connectionIssue: base.connectionIssue,
    requestScreen: base.requestScreen,
    requestStateTimeline: base.requestStateTimeline,
    sessions: base.sessions,
    resolvedTheme: base.resolvedTheme,
    highlightCorrections: base.highlightCorrections,
    moveSessionToTop: base.moveSessionToTop,
    focusPane: base.focusPane,
    refreshSessions: base.refreshSessions,
    launchAgentInSession: base.launchAgentInSession,
    setScreenError: terminal.screen.setScreenError,
    touchRepoSortAnchor,
    currentRepoRoot,
  });

  // Only the fields consumers actually read are exposed here. The raw
  // checkoutBranch/createBranch/deleteBranch/selectVirtualBranch/
  // selectVirtualWorktree from the underlying subhooks are intentionally
  // omitted: they skip the diff/commit refresh and mutual-exclusivity wiring
  // above, so reaching them by mistake through scope.branches /
  // scope.virtualWorktree / scope.virtualBranch would be a footgun. Callers
  // must use the wrapped scope.checkoutBranch / scope.createBranch /
  // scope.deleteBranch / scope.selectVirtualBranch / scope.selectVirtualWorktree
  // instead.
  const scope = useMemo(
    () => ({
      virtualWorktree: {
        selectorEnabled: virtualWorktree.selectorEnabled,
        loading: virtualWorktree.loading,
        error: virtualWorktree.error,
        entries: virtualWorktree.entries,
        repoRoot: virtualWorktree.repoRoot,
        baseBranch: virtualWorktree.baseBranch,
        actualWorktreePath: virtualWorktree.actualWorktreePath,
        virtualWorktreePath: virtualWorktree.virtualWorktreePath,
        effectiveWorktreePath: virtualWorktree.effectiveWorktreePath,
        effectiveBranch: virtualWorktree.effectiveBranch,
        clearVirtualWorktree: virtualWorktree.clearVirtualWorktree,
        refreshWorktrees: virtualWorktree.refreshWorktrees,
      },
      branches: {
        branches: branches.branches,
        repoRoot: branches.branchList?.repoRoot ?? null,
        defaultBranch: branches.defaultBranch,
        currentBranch: branches.currentBranch,
        branchesLoading: branches.branchesLoading,
        branchesError: branches.branchesError,
        mutating: branches.mutating,
        mutationError: branches.mutationError,
        clearMutationError: branches.clearMutationError,
        refreshBranches: branches.refreshBranches,
      },
      virtualBranch: {
        virtualBranch: virtualBranch.virtualBranch,
        clearVirtualBranch: virtualBranch.clearVirtualBranch,
      },
      effectiveBranchScope,
      effectiveWorktreeScope,
      selectVirtualBranch,
      selectVirtualWorktree,
      checkoutBranch,
      createBranch,
      deleteBranch,
    }),
    [
      virtualWorktree,
      branches,
      virtualBranch,
      effectiveBranchScope,
      effectiveWorktreeScope,
      selectVirtualBranch,
      selectVirtualWorktree,
      checkoutBranch,
      createBranch,
      deleteBranch,
    ],
  );

  const repoPins = useMemo(
    () => ({ getRepoSortAnchorAt, touchRepoSortAnchor, sessionGroups }),
    [getRepoSortAnchorAt, touchRepoSortAnchor, sessionGroups],
  );

  return useMemo(
    () => ({
      base: { ...base, paneId },
      repoPins,
      scope,
      diffs,
      files,
      commits,
      timelineLogsActions,
      terminal,
      pushNotifications,
    }),
    [
      base,
      paneId,
      repoPins,
      scope,
      diffs,
      files,
      commits,
      timelineLogsActions,
      terminal,
      pushNotifications,
    ],
  );
};

export type SessionDetailContextValue = ReturnType<typeof useSessionDetailContextValue>;

const SessionDetailContext = createContext<SessionDetailContextValue | null>(null);

type SessionDetailProviderProps = {
  paneId: string;
  children: ReactNode;
};

type SessionDetailPaneProviderProps = SessionDetailProviderProps & {
  pushNotifications: PushNotifications;
};

const SessionDetailPaneProvider = ({
  paneId,
  children,
  pushNotifications,
}: SessionDetailPaneProviderProps) => {
  const value = useSessionDetailContextValue(paneId, pushNotifications);
  return <SessionDetailContext.Provider value={value}>{children}</SessionDetailContext.Provider>;
};

export const SessionDetailProvider = ({ paneId, children }: SessionDetailProviderProps) => {
  // Push subscription state belongs to the browser/device lifetime. Keep it outside the keyed
  // pane lifetime so navigating A -> B -> A does not repeat settings/subscription reconciliation.
  const pushNotifications = usePushNotifications({ paneId });

  return (
    <SessionDetailPaneProvider key={paneId} paneId={paneId} pushNotifications={pushNotifications}>
      {children}
    </SessionDetailPaneProvider>
  );
};

export const useSessionDetailContext = (): SessionDetailContextValue => {
  const value = use(SessionDetailContext);
  if (!value) {
    throw new Error("useSessionDetailContext must be used within a SessionDetailProvider");
  }
  return value;
};
