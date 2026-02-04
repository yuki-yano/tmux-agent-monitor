import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { CSSProperties } from "react";

import { Card } from "@/components/ui";

import { CommitSection } from "./components/CommitSection";
import { ControlsPanel } from "./components/ControlsPanel";
import { DiffSection } from "./components/DiffSection";
import { LogModal } from "./components/LogModal";
import { QuickPanel } from "./components/QuickPanel";
import { ScreenPanel } from "./components/ScreenPanel";
import { SessionHeader } from "./components/SessionHeader";
import { SessionSidebar } from "./components/SessionSidebar";
import { backLinkClass } from "./sessionDetailUtils";
import type { SessionDetailVM } from "./useSessionDetailVM";

export type SessionDetailViewProps = SessionDetailVM;

export const SessionDetailView = ({
  paneId,
  session,
  sessionGroups,
  nowMs,
  connected,
  connectionIssue,
  readOnly,
  is2xlUp,
  sidebarWidth,
  handleSidebarPointerDown,
  detailSplitRatio,
  detailSplitRef,
  handleDetailSplitPointerDown,
  mode,
  screenLines,
  imageBase64,
  fallbackReason,
  error,
  isScreenLoading,
  isAtBottom,
  handleAtBottomChange,
  handleUserScrollStateChange,
  forceFollow,
  scrollToBottom,
  handleModeChange,
  virtuosoRef,
  scrollerRef,
  handleRefreshScreen,
  textInputRef,
  autoEnter,
  shiftHeld,
  ctrlHeld,
  controlsOpen,
  rawMode,
  allowDangerKeys,
  handleSendKey,
  handleSendText,
  handleRawBeforeInput,
  handleRawInput,
  handleRawKeyDown,
  handleRawCompositionStart,
  handleRawCompositionEnd,
  toggleAutoEnter,
  toggleControls,
  toggleShift,
  toggleCtrl,
  toggleRawMode,
  toggleAllowDangerKeys,
  handleTouchSession,
  diffSummary,
  diffError,
  diffLoading,
  diffFiles,
  diffOpen,
  diffLoadingFiles,
  refreshDiff,
  toggleDiff,
  commitLog,
  commitError,
  commitLoading,
  commitLoadingMore,
  commitHasMore,
  commitDetails,
  commitFileDetails,
  commitFileOpen,
  commitFileLoading,
  commitOpen,
  commitLoadingDetails,
  copiedHash,
  refreshCommitLog,
  loadMoreCommits,
  toggleCommit,
  toggleCommitFile,
  copyHash,
  quickPanelOpen,
  logModalOpen,
  selectedSession,
  selectedLogLines,
  selectedLogLoading,
  selectedLogError,
  openLogModal,
  closeLogModal,
  toggleQuickPanel,
  closeQuickPanel,
  titleDraft,
  titleEditing,
  titleSaving,
  titleError,
  openTitleEditor,
  closeTitleEditor,
  updateTitleDraft,
  saveTitle,
  clearTitle,
  handleOpenHere,
  handleOpenInNewTab,
}: SessionDetailViewProps) => {
  if (!session) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
        <Card>
          <p className="text-latte-subtext0 text-sm">Session not found.</p>
          <Link to="/" className={`${backLinkClass} mt-4`}>
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div
        className="fixed left-0 top-0 z-40 hidden h-screen md:flex"
        style={{ width: `${sidebarWidth}px` }}
      >
        <SessionSidebar
          sessionGroups={sessionGroups}
          nowMs={nowMs}
          currentPaneId={paneId}
          className="border-latte-surface1/80 h-full w-full rounded-none rounded-r-3xl border-r"
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none"
          onPointerDown={handleSidebarPointerDown}
        />
      </div>

      <div
        className="animate-fade-in-up w-full px-4 py-6 md:pl-[calc(var(--sidebar-width)+32px)] md:pr-6"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <SessionHeader
            session={session}
            readOnly={readOnly}
            connectionIssue={connectionIssue}
            nowMs={nowMs}
            titleDraft={titleDraft}
            titleEditing={titleEditing}
            titleSaving={titleSaving}
            titleError={titleError}
            onTitleDraftChange={updateTitleDraft}
            onTitleSave={saveTitle}
            onTitleClear={clearTitle}
            onOpenTitleEditor={openTitleEditor}
            onCloseTitleEditor={closeTitleEditor}
          />

          <div
            ref={detailSplitRef}
            className={
              is2xlUp ? "flex min-w-0 flex-row items-stretch gap-3" : "flex min-w-0 flex-col gap-4"
            }
          >
            <div
              className={is2xlUp ? "min-w-0 flex-[0_0_auto]" : "min-w-0"}
              style={is2xlUp ? { flexBasis: `${detailSplitRatio * 100}%` } : undefined}
            >
              <ScreenPanel
                mode={mode}
                onModeChange={handleModeChange}
                connected={connected}
                onRefresh={handleRefreshScreen}
                fallbackReason={fallbackReason}
                error={error}
                isScreenLoading={isScreenLoading}
                imageBase64={imageBase64}
                screenLines={screenLines}
                virtuosoRef={virtuosoRef}
                scrollerRef={scrollerRef}
                isAtBottom={isAtBottom}
                forceFollow={forceFollow}
                onAtBottomChange={handleAtBottomChange}
                onScrollToBottom={scrollToBottom}
                onUserScrollStateChange={handleUserScrollStateChange}
                rawMode={rawMode}
                allowDangerKeys={allowDangerKeys}
                controls={
                  <ControlsPanel
                    readOnly={readOnly}
                    connected={connected}
                    textInputRef={textInputRef}
                    onSendText={handleSendText}
                    autoEnter={autoEnter}
                    onToggleAutoEnter={toggleAutoEnter}
                    controlsOpen={controlsOpen}
                    onToggleControls={toggleControls}
                    rawMode={rawMode}
                    onToggleRawMode={toggleRawMode}
                    allowDangerKeys={allowDangerKeys}
                    onToggleAllowDangerKeys={toggleAllowDangerKeys}
                    shiftHeld={shiftHeld}
                    onToggleShift={toggleShift}
                    ctrlHeld={ctrlHeld}
                    onToggleCtrl={toggleCtrl}
                    onSendKey={handleSendKey}
                    onRawBeforeInput={handleRawBeforeInput}
                    onRawInput={handleRawInput}
                    onRawKeyDown={handleRawKeyDown}
                    onRawCompositionStart={handleRawCompositionStart}
                    onRawCompositionEnd={handleRawCompositionEnd}
                    onTouchSession={handleTouchSession}
                  />
                }
              />
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panels"
              className={`group relative h-full w-4 cursor-col-resize touch-none items-center justify-center ${
                is2xlUp ? "flex" : "hidden"
              }`}
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
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <DiffSection
                diffSummary={diffSummary}
                diffError={diffError}
                diffLoading={diffLoading}
                diffFiles={diffFiles}
                diffOpen={diffOpen}
                diffLoadingFiles={diffLoadingFiles}
                onRefresh={refreshDiff}
                onToggle={toggleDiff}
              />

              <CommitSection
                commitLog={commitLog}
                commitError={commitError}
                commitLoading={commitLoading}
                commitLoadingMore={commitLoadingMore}
                commitHasMore={commitHasMore}
                commitDetails={commitDetails}
                commitFileDetails={commitFileDetails}
                commitFileOpen={commitFileOpen}
                commitFileLoading={commitFileLoading}
                commitOpen={commitOpen}
                commitLoadingDetails={commitLoadingDetails}
                copiedHash={copiedHash}
                onRefresh={refreshCommitLog}
                onLoadMore={loadMoreCommits}
                onToggleCommit={toggleCommit}
                onToggleCommitFile={toggleCommitFile}
                onCopyHash={copyHash}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <QuickPanel
          open={quickPanelOpen}
          sessionGroups={sessionGroups}
          nowMs={nowMs}
          currentPaneId={paneId}
          onOpenLogModal={openLogModal}
          onClose={closeQuickPanel}
          onToggle={toggleQuickPanel}
        />
      </div>

      <LogModal
        open={logModalOpen}
        session={selectedSession}
        logLines={selectedLogLines}
        loading={selectedLogLoading}
        error={selectedLogError}
        onClose={closeLogModal}
        onOpenHere={handleOpenHere}
        onOpenNewTab={handleOpenInNewTab}
      />
    </>
  );
};
