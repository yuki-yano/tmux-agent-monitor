import {
  BookText,
  Clock,
  FileCheck,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Keyboard,
  X,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";

import { Card, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { readStoredSessionListFilter } from "@/features/shared-session-ui/model/session-list-filters";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { buildSessionDocumentTitle } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { useTimeout } from "@/lib/use-timeout";

import { BranchSection } from "./components/BranchSection";
import { CommitSection } from "./components/CommitSection";
import { DiffSection } from "./components/DiffSection";
import { FileContentModal } from "./components/FileContentModal";
import { FileNavigatorSection } from "./components/FileNavigatorSection";
import { LogFileCandidateModal } from "./components/LogFileCandidateModal";
import { ConnectedNotesSection } from "./components/NotesSection";
import { ScreenPanel } from "./components/ScreenPanel";
import { SessionDetailMissingState } from "./components/SessionDetailMissingState";
import { ConnectedControlsPanel } from "./components/session-shell/ConnectedControlsPanel";
import { ConnectedLogModal } from "./components/session-shell/ConnectedLogModal";
import { ConnectedQuickPanel } from "./components/session-shell/ConnectedQuickPanel";
import { ConnectedSessionHeader } from "./components/session-shell/ConnectedSessionHeader";
import { ConnectedSessionSidebar } from "./components/session-shell/ConnectedSessionSidebar";
import { ConnectedStateTimelineSection } from "./components/StateTimelineSection";
import { WorktreeSection } from "./components/WorktreeSection";
import { useSessionDetailContext } from "./SessionDetailProvider";
import { SessionDetailNotesProvider } from "./SessionDetailNotesProvider";
import { SessionDetailTitleProvider } from "./SessionDetailTitleProvider";
import { SessionDetailTimelineProvider } from "./SessionDetailTimelineProvider";
import {
  CLOSE_DETAIL_TAB_VALUE,
  type DetailSectionTab,
  SECTION_TAB_ICON_ONLY_CLASS,
  SECTION_TAB_TEXT_CLASS,
  useSessionDetailSectionTabs,
} from "./hooks/useSessionDetailSectionTabs";
import { useSessionDetailLayoutState } from "./hooks/useSessionDetailLayoutState";
import { useSessionDetailViewDataSectionProps } from "./hooks/useSessionDetailViewDataSectionProps";
import { useSessionDetailViewExplorerSectionProps } from "./hooks/useSessionDetailViewExplorerSectionProps";
import { useSessionDetailViewWorktreeBranchSectionProps } from "./hooks/useSessionDetailViewWorktreeBranchSectionProps";

const MISSING_SESSION_GRACE_MS = 1600;

type DetailSectionTabDefinition = {
  value: DetailSectionTab;
  ariaLabel: string;
  label: string;
  icon: typeof Clock;
  render: () => ReactNode;
};

const MOBILE_SECTION_TAB_GRID_POSITIONS = [
  "col-start-1 row-start-1",
  "col-start-2 row-start-1",
  "col-start-3 row-start-1",
  "col-start-4 row-start-1",
  "col-start-1 row-start-2",
  "col-start-2 row-start-2",
  "col-start-3 row-start-2",
  "col-start-4 row-start-2",
] as const;

const DESKTOP_INSPECTOR_TAB_VALUES: readonly DetailSectionTab[] = [
  "changes",
  "file",
  "commits",
  "branches",
  "worktrees",
  "notes",
];
const DEFAULT_DESKTOP_INSPECTOR_TAB: DetailSectionTab = "changes";
const CONTROLS_PANEL_ALL_SECTION = <ConnectedControlsPanel />;

const isDesktopInspectorTab = (value: DetailSectionTab | typeof CLOSE_DETAIL_TAB_VALUE) =>
  DESKTOP_INSPECTOR_TAB_VALUES.includes(value as DetailSectionTab);

const CONFIG_VALIDATION_ERROR_PATTERN = /invalid (?:project )?config(?: JSON)?: /i;

const splitConnectionIssueLines = (connectionIssue: string | null) =>
  connectionIssue
    ? connectionIssue
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

const resolveMissingSessionState = (connectionIssue: string | null) => {
  const issueLines = splitConnectionIssueLines(connectionIssue);
  if (issueLines.length === 0) {
    return {
      title: "Session not found.",
      details: [] as string[],
    };
  }

  if (connectionIssue === API_ERROR_MESSAGES.unauthorized) {
    return {
      title: "Authentication error.",
      details: issueLines,
    };
  }

  if (issueLines.some((line) => CONFIG_VALIDATION_ERROR_PATTERN.test(line))) {
    return {
      title: "Configuration error on server.",
      details: issueLines,
    };
  }

  return {
    title: "Session could not be loaded.",
    details: issueLines,
  };
};

const useMissingSessionGrace = (shouldDelayMissingState: boolean) => {
  const [graceState, setGraceState] = useState({
    shouldDelay: shouldDelayMissingState,
    elapsed: false,
  });
  const missingSessionGraceTimer = useTimeout();
  let currentGraceState = graceState;
  if (graceState.shouldDelay !== shouldDelayMissingState) {
    currentGraceState = { shouldDelay: shouldDelayMissingState, elapsed: false };
    setGraceState(currentGraceState);
  }

  useEffect(() => {
    if (!shouldDelayMissingState) {
      return;
    }
    missingSessionGraceTimer.set(() => {
      setGraceState((current) => (current.shouldDelay ? { ...current, elapsed: true } : current));
    }, MISSING_SESSION_GRACE_MS);

    return () => {
      missingSessionGraceTimer.cancel();
    };
  }, [missingSessionGraceTimer, shouldDelayMissingState]);

  return currentGraceState.elapsed;
};

const SessionDetailViewContent = () => {
  const { base } = useSessionDetailContext();
  const { session, connectionIssue, hasLoadedInitialSessions } = base;
  const missingSessionState = resolveMissingSessionState(connectionIssue);
  const sessionDisplayTitle =
    session?.customTitle ?? session?.title ?? session?.sessionName ?? null;
  const documentTitle = buildSessionDocumentTitle(sessionDisplayTitle);
  const backToListSearch = useMemo(() => ({ filter: readStoredSessionListFilter() }), []);
  const {
    is2xlUp,
    isMobile,
    sidebarWidth,
    handleSidebarPointerDown,
    detailSplitRatio,
    detailSplitRef,
    handleDetailSplitPointerDown,
  } = useSessionDetailLayoutState();
  const isMobileDetailLayout = isMobile;
  const {
    selectedSectionTabValue,
    sectionTabsIconOnly,
    setSectionTabsListElement,
    handleSectionTabChange,
  } = useSessionDetailSectionTabs({
    scope: { repoRoot: session?.repoRoot, branch: session?.branch },
  });
  const { diffSectionProps, commitSectionProps } = useSessionDetailViewDataSectionProps();
  const {
    fileNavigatorSectionProps,
    fileContentModalProps,
    screenPanelProps,
    logFileCandidateModalProps,
  } = useSessionDetailViewExplorerSectionProps();
  const { worktreeSectionProps, branchSectionProps } =
    useSessionDetailViewWorktreeBranchSectionProps();
  const hasConnectionIssue = splitConnectionIssueLines(connectionIssue).length > 0;
  const isSessionMissing = !session;
  const isInitialSessionLoading =
    isSessionMissing && !hasLoadedInitialSessions && !hasConnectionIssue;
  const shouldDelayMissingState =
    isSessionMissing && hasLoadedInitialSessions && !hasConnectionIssue;
  const missingSessionGraceElapsed = useMissingSessionGrace(shouldDelayMissingState);

  if (isSessionMissing) {
    const showMissingState = hasConnectionIssue || missingSessionGraceElapsed;
    return (
      <SessionDetailMissingState
        documentTitle={documentTitle}
        backToListSearch={backToListSearch}
        missingSessionState={missingSessionState}
        loading={isInitialSessionLoading || !showMissingState}
        sidebarWidth={sidebarWidth}
        detailSplitRatio={detailSplitRatio}
      />
    );
  }

  const controlsPanelKeysSection = (
    <Card className="p-3 sm:p-4">
      <ConnectedControlsPanel showComposerSection={false} />
    </Card>
  );
  const controlsPanelComposerSection = <ConnectedControlsPanel showKeysSection={false} />;
  const sectionTabs: DetailSectionTabDefinition[] = [
    {
      value: "keys",
      ariaLabel: "Keys panel",
      label: "Keys",
      icon: Keyboard,
      render: () => controlsPanelKeysSection,
    },
    {
      value: "timeline",
      ariaLabel: "Timeline panel",
      label: "Timeline",
      icon: Clock,
      render: () => <ConnectedStateTimelineSection isMobile />,
    },
    {
      value: "file",
      ariaLabel: "Files panel",
      label: "Files",
      icon: FolderOpen,
      render: () => <FileNavigatorSection {...fileNavigatorSectionProps} />,
    },
    {
      value: "notes",
      ariaLabel: "Notes panel",
      label: "Notes",
      icon: BookText,
      render: () => <ConnectedNotesSection />,
    },
    {
      value: "changes",
      ariaLabel: "Changes panel",
      label: "Changes",
      icon: FileCheck,
      render: () => <DiffSection {...diffSectionProps} />,
    },
    {
      value: "commits",
      ariaLabel: "Commits panel",
      label: "Commits",
      icon: GitCommitHorizontal,
      render: () => <CommitSection {...commitSectionProps} />,
    },
    {
      value: "branches",
      ariaLabel: "Branches panel",
      label: "Branches",
      icon: GitFork,
      render: () => <BranchSection {...branchSectionProps} />,
    },
    {
      value: "worktrees",
      ariaLabel: "Worktrees panel",
      label: "Worktrees",
      icon: GitBranch,
      render: () => <WorktreeSection {...worktreeSectionProps} />,
    },
  ];
  const selectedMobileSectionContent =
    sectionTabs.find((tab) => tab.value === selectedSectionTabValue)?.render() ?? null;
  const desktopInspectorTabs = sectionTabs.filter((tab) =>
    DESKTOP_INSPECTOR_TAB_VALUES.includes(tab.value),
  );
  const selectedDesktopInspectorTabValue = isDesktopInspectorTab(selectedSectionTabValue)
    ? selectedSectionTabValue
    : DEFAULT_DESKTOP_INSPECTOR_TAB;
  const selectedDesktopInspectorContent =
    desktopInspectorTabs.find((tab) => tab.value === selectedDesktopInspectorTabValue)?.render() ??
    null;

  return (
    <>
      <title>{documentTitle}</title>
      <div
        className="animate-fade-in-up w-full px-2 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] pt-3 sm:px-4 sm:pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:pt-6 md:pb-6 md:pl-[calc(var(--sidebar-width)+32px)] md:pr-6"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="flex min-w-0 flex-col gap-2.5 sm:gap-4">
          <ConnectedSessionHeader />
          {isMobileDetailLayout ? (
            <>
              <ScreenPanel {...screenPanelProps} controls={controlsPanelComposerSection} />

              <Tabs value={selectedSectionTabValue} onValueChange={handleSectionTabChange}>
                <TabsList
                  ref={setSectionTabsListElement}
                  aria-label="Session detail sections"
                  className="grid w-full grid-cols-[repeat(4,minmax(0,1fr))_auto] grid-rows-2 gap-1 rounded-2xl"
                >
                  {sectionTabs.map((tab, index) => {
                    const Icon = tab.icon;
                    return (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        aria-label={tab.ariaLabel}
                        title={tab.label}
                        className={cn(
                          sectionTabsIconOnly
                            ? SECTION_TAB_ICON_ONLY_CLASS
                            : SECTION_TAB_TEXT_CLASS,
                          MOBILE_SECTION_TAB_GRID_POSITIONS[index] ?? "",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {!sectionTabsIconOnly ? (
                          <span className="truncate">{tab.label}</span>
                        ) : null}
                      </TabsTrigger>
                    );
                  })}
                  <TabsTrigger
                    value={CLOSE_DETAIL_TAB_VALUE}
                    aria-label="Close detail sections"
                    title="Close detail sections"
                    className="col-start-5 row-span-2 row-start-1 inline-flex h-8 w-8 items-center justify-center self-center justify-self-end p-0 sm:h-9 sm:w-9"
                  >
                    <X className="h-3.5 w-3.5" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {selectedMobileSectionContent}
            </>
          ) : (
            <>
              <ConnectedStateTimelineSection isMobile={false} />

              <div
                ref={detailSplitRef}
                className={
                  is2xlUp
                    ? "flex min-w-0 flex-row items-stretch gap-3"
                    : "flex min-w-0 flex-col gap-2.5 sm:gap-4"
                }
              >
                <div
                  className={
                    is2xlUp
                      ? "relative z-20 flex min-w-0 flex-[0_0_auto] flex-col gap-2.5 sm:gap-4"
                      : "flex min-w-0 flex-col gap-2.5 sm:gap-4"
                  }
                  style={is2xlUp ? { flexBasis: `${detailSplitRatio * 100}%` } : undefined}
                >
                  <ScreenPanel {...screenPanelProps} controls={CONTROLS_PANEL_ALL_SECTION} />
                </div>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize panels"
                  className={cn(
                    "group relative h-full w-4 cursor-col-resize touch-none items-center justify-center",
                    is2xlUp ? "flex" : "hidden",
                  )}
                  onPointerDown={is2xlUp ? handleDetailSplitPointerDown : undefined}
                >
                  <span className="bg-latte-surface2/70 group-hover:bg-latte-lavender/60 pointer-events-none absolute inset-y-8 left-1/2 w-[2px] -translate-x-1/2 rounded-full transition-colors duration-200" />
                  <span className="border-latte-surface2/70 bg-latte-crust/60 pointer-events-none flex h-10 w-4 items-center justify-center rounded-full border">
                    <span className="flex flex-col items-center gap-1">
                      <span className="bg-latte-lavender/70 h-1 w-1 rounded-full" />
                      <span className="bg-latte-lavender/70 h-1 w-1 rounded-full" />
                      <span className="bg-latte-lavender/70 h-1 w-1 rounded-full" />
                    </span>
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:gap-4">
                  <Tabs
                    value={selectedDesktopInspectorTabValue}
                    onValueChange={handleSectionTabChange}
                  >
                    <TabsList
                      aria-label="Session inspector sections"
                      className="custom-scrollbar flex w-full max-w-full justify-start gap-1 overflow-x-auto rounded-2xl"
                    >
                      {desktopInspectorTabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            aria-label={tab.ariaLabel}
                            title={tab.label}
                            className="h-9 min-w-[5.5rem] flex-1 gap-1.5 px-2 text-[11px]"
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{tab.label}</span>
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                  {selectedDesktopInspectorContent}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="md:hidden">
        <ConnectedQuickPanel />
      </div>

      <ConnectedLogModal />
      <LogFileCandidateModal {...logFileCandidateModalProps} />
      <FileContentModal {...fileContentModalProps} />
      <div
        className="fixed left-0 top-0 z-40 hidden h-screen md:flex"
        style={{ width: `${sidebarWidth}px` }}
      >
        <ConnectedSessionSidebar sidebarWidth={sidebarWidth} />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none"
          onPointerDown={handleSidebarPointerDown}
        />
      </div>
    </>
  );
};

export const SessionDetailView = () => (
  <SessionDetailNotesProvider>
    <SessionDetailTimelineProvider>
      <SessionDetailTitleProvider>
        <SessionDetailViewContent />
      </SessionDetailTitleProvider>
    </SessionDetailTimelineProvider>
  </SessionDetailNotesProvider>
);
