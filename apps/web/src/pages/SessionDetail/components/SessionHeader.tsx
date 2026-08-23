import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { ArrowLeft, ChevronDown, ChevronUp, Clock, GitBranch, Pin, X } from "lucide-react";
import { type KeyboardEvent, memo, useEffect, useId, useRef, useState } from "react";

import { GitHubIcon } from "@/components/icons/GitHubIcon";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Badge,
  Button,
  Callout,
  IconButton,
  LastInputPill,
  TagPill,
  TextButton,
  TruncatedPathText,
} from "@/components/ui";
import { resolveSessionDetailTitleTextClass } from "@/features/shared-session-ui/model/session-title-font";
import { readStoredSessionListFilter } from "@/features/shared-session-ui/model/session-list-filters";
import { cn } from "@/lib/cn";
import { buildGitHubRepoUrl } from "@/lib/github-repo-url";

import { backLinkClass } from "@/features/shared-session-ui/model/navigation-style";
import {
  agentLabelFor,
  agentToneFor,
  formatBranchLabel,
  formatPath,
  formatRelativeTime,
  formatStateLabel,
  getLastInputTone,
  isEditorCommand,
  isKnownAgent,
  stateTone,
} from "@/lib/session-format";

const resolveBackToListSearch = () => ({ filter: readStoredSessionListFilter() });

type SessionHeaderState = {
  session: SessionSummary;
  connectionIssue: string | null;
  nowMs: number;
  titleDraft: string;
  titleEditing: boolean;
  titleSaving: boolean;
  titleError: string | null;
};

type SessionHeaderActions = {
  onTitleDraftChange: (value: string) => void;
  onTitleSave: () => void;
  onTitleReset: () => void;
  onOpenTitleEditor: () => void;
  onCloseTitleEditor: () => void;
  onTouchSession: () => void;
};

type SessionHeaderProps = {
  state: SessionHeaderState;
  actions: SessionHeaderActions;
};

type SessionTitleInputProps = {
  titleDraft: string;
  titleSaving: boolean;
  sessionAutoTitle: string;
  onTitleDraftChange: (value: string) => void;
  onTitleSave: () => void;
  onCloseTitleEditor: () => void;
};

type SessionTitleButtonProps = {
  sessionDisplayTitle: string;
  titleClassName: string;
  onOpenTitleEditor: () => void;
};

type SessionHeaderAlertsProps = {
  pipeConflict: boolean;
  connectionIssue: string | null;
};

type SessionTitleAreaProps = {
  canResetTitle: boolean;
  titleEditing: boolean;
  titleDraft: string;
  titleSaving: boolean;
  sessionAutoTitle: string;
  sessionDisplayTitle: string;
  currentPath: string | null;
  titleError: string | null;
  onTitleDraftChange: (value: string) => void;
  onTitleSave: () => void;
  onTitleReset: () => void;
  onOpenTitleEditor: () => void;
  onCloseTitleEditor: () => void;
};

type SessionAgentBadgeProps = {
  agent: SessionSummary["agent"];
};

const SessionTitleInput = ({
  titleDraft,
  titleSaving,
  sessionAutoTitle,
  onTitleDraftChange,
  onTitleSave,
  onCloseTitleEditor,
}: SessionTitleInputProps) => {
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = titleInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onTitleSave();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseTitleEditor();
    }
  };

  const handleBlur = () => {
    if (titleSaving) {
      return;
    }
    onCloseTitleEditor();
  };

  return (
    <input
      ref={titleInputRef}
      type="text"
      value={titleDraft}
      onChange={(event) => {
        onTitleDraftChange(event.target.value);
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      placeholder={sessionAutoTitle || "Untitled session"}
      maxLength={80}
      enterKeyHint="done"
      disabled={titleSaving}
      className="font-ident border-latte-surface2 text-latte-text focus:border-latte-blue focus:ring-latte-blue/25 bg-latte-crust/28 min-w-[180px] flex-1 rounded-xl border px-2.5 py-1 text-xl tracking-normal shadow-[0_1px_3px_rgb(var(--ctp-shadow)/0.08)] outline-hidden transition-[border-color,box-shadow,background-color] duration-200 focus:bg-latte-base/78 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:py-1.5"
      aria-label="Custom session title"
    />
  );
};

const SessionTitleButton = ({
  sessionDisplayTitle,
  titleClassName,
  onOpenTitleEditor,
}: SessionTitleButtonProps) => (
  <TextButton
    type="button"
    onClick={onOpenTitleEditor}
    variant="title"
    className={cn(
      "font-ident hover:text-latte-blue-text min-w-0 flex-1 cursor-default truncate text-left tracking-normal transition-colors duration-200 hover:cursor-pointer",
      titleClassName,
    )}
    aria-label="Edit session title"
    title={sessionDisplayTitle}
  >
    {sessionDisplayTitle}
  </TextButton>
);

const SessionHeaderAlerts = ({ pipeConflict, connectionIssue }: SessionHeaderAlertsProps) => (
  <>
    {pipeConflict ? (
      <Callout tone="error" size="sm">
        Another pipe-pane is attached. Screen is capture-only.
      </Callout>
    ) : null}
    {connectionIssue ? (
      <Callout tone="warning" size="sm">
        {connectionIssue}
      </Callout>
    ) : null}
  </>
);

const SessionAgentBadge = ({ agent }: SessionAgentBadgeProps) => {
  if (!isKnownAgent(agent)) {
    return null;
  }
  return (
    <Badge tone={agentToneFor(agent)} size="sm">
      {agentLabelFor(agent)}
    </Badge>
  );
};

const SessionTitleArea = ({
  canResetTitle,
  titleEditing,
  titleDraft,
  titleSaving,
  sessionAutoTitle,
  sessionDisplayTitle,
  currentPath,
  titleError,
  onTitleDraftChange,
  onTitleSave,
  onTitleReset,
  onOpenTitleEditor,
  onCloseTitleEditor,
}: SessionTitleAreaProps) => {
  const showResetTitle = canResetTitle && !titleEditing;
  const formattedCurrentPath = formatPath(currentPath);
  const sessionTitleClassName = resolveSessionDetailTitleTextClass(sessionDisplayTitle);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <h1 className="contents">
          {titleEditing ? (
            <SessionTitleInput
              titleDraft={titleDraft}
              titleSaving={titleSaving}
              sessionAutoTitle={sessionAutoTitle}
              onTitleDraftChange={onTitleDraftChange}
              onTitleSave={onTitleSave}
              onCloseTitleEditor={onCloseTitleEditor}
            />
          ) : (
            <SessionTitleButton
              sessionDisplayTitle={sessionDisplayTitle}
              titleClassName={sessionTitleClassName}
              onOpenTitleEditor={onOpenTitleEditor}
            />
          )}
        </h1>
        {showResetTitle ? (
          <IconButton
            type="button"
            onClick={onTitleReset}
            disabled={titleSaving}
            variant="dangerOutline"
            size="xs"
            aria-label="Reset session title"
            title="Reset session title"
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        <TruncatedPathText
          data-testid="session-header-current-path"
          path={formattedCurrentPath}
          reservePx={12}
          minVisibleSegments={2}
          className="text-latte-subtext0 min-w-0 basis-full font-mono text-xs tracking-tight sm:max-w-[360px] sm:flex-1 sm:basis-auto sm:text-sm"
        />
      </div>
      {titleError ? <p className="text-latte-red-text text-xs">{titleError}</p> : null}
    </>
  );
};

export const SessionHeader = memo(({ state, actions }: SessionHeaderProps) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsSectionId = useId();
  const { session, connectionIssue, nowMs, titleDraft, titleEditing, titleSaving, titleError } =
    state;
  const {
    onTitleDraftChange,
    onTitleSave,
    onTitleReset,
    onOpenTitleEditor,
    onCloseTitleEditor,
    onTouchSession,
  } = actions;

  const sessionCustomTitle = session.customTitle ?? null;
  const canResetTitle = sessionCustomTitle != null || session.title != null;
  const sessionAutoTitle = session.title ?? session.sessionName ?? "";
  const sessionDisplayTitle = sessionCustomTitle ?? sessionAutoTitle;
  const lastInputTone = getLastInputTone(session.lastInputAt ?? null, nowMs);
  const showEditorState = session.state === "UNKNOWN" && isEditorCommand(session.currentCommand);
  const stateBadgeTone = showEditorState ? "editor" : stateTone(session.state);
  const stateBadgeLabel = showEditorState ? "EDITOR" : formatStateLabel(session.state);
  const backToListSearch = resolveBackToListSearch();
  const repoGitHubUrl = buildGitHubRepoUrl(session.repoRoot ?? session.currentPath);

  return (
    <>
      <div className="flex items-center justify-between gap-2.5 sm:gap-3">
        <Link to="/" search={backToListSearch} className={backLinkClass}>
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Link>
        <ThemeToggle />
      </div>
      <header className="flex flex-col gap-2.5 rounded-3xl border border-[var(--material-stroke)] bg-[var(--material-canvas)] p-3 shadow-[var(--material-shadow)] backdrop-blur-2xl sm:gap-3 sm:p-4">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <SessionTitleArea
            canResetTitle={canResetTitle}
            titleEditing={titleEditing}
            titleDraft={titleDraft}
            titleSaving={titleSaving}
            sessionAutoTitle={sessionAutoTitle}
            sessionDisplayTitle={sessionDisplayTitle}
            currentPath={session.currentPath}
            titleError={titleError}
            onTitleDraftChange={onTitleDraftChange}
            onTitleSave={onTitleSave}
            onTitleReset={onTitleReset}
            onOpenTitleEditor={onOpenTitleEditor}
            onCloseTitleEditor={onCloseTitleEditor}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stateBadgeTone} size="sm">
              {stateBadgeLabel}
            </Badge>
            <SessionAgentBadge agent={session.agent} />
            <LastInputPill
              tone={lastInputTone}
              label={<Clock className="h-2.5 w-2.5" />}
              srLabel="Last input"
              value={formatRelativeTime(session.lastInputAt, nowMs)}
              size="xs"
              showDot={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDetailsOpen((previous) => !previous);
              }}
              aria-expanded={detailsOpen}
              aria-controls={detailsOpen ? detailsSectionId : undefined}
              aria-label={detailsOpen ? "Hide header details" : "Show header details"}
              className="text-latte-subtext0 relative ml-auto flex h-7 w-7 items-center gap-1.5 p-0 text-[10px] uppercase tracking-[0.12em] after:absolute after:-inset-1.5 after:content-[''] sm:h-8 sm:w-8"
            >
              {detailsOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
          {detailsOpen ? (
            <div id={detailsSectionId} className="flex flex-col gap-1.5 sm:gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <TagPill tone="neutral" className="inline-flex max-w-full items-center gap-1.5">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="max-w-[min(320px,60vw)] truncate font-mono text-[11px]">
                    {formatBranchLabel(session.branch)}
                  </span>
                </TagPill>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TagPill tone="meta">Session {session.sessionName}</TagPill>
                <TagPill tone="meta">Window {session.windowIndex}</TagPill>
                <TagPill tone="meta">Pane {session.paneId}</TagPill>
                {repoGitHubUrl ? (
                  <IconButton
                    type="button"
                    size="xs"
                    onClick={() => {
                      window.open(repoGitHubUrl, "_blank", "noopener,noreferrer");
                    }}
                    className="ml-auto"
                    aria-label="Open repository on GitHub"
                    title="Open repository on GitHub"
                  >
                    <GitHubIcon className="h-3.5 w-3.5" />
                  </IconButton>
                ) : null}
                <IconButton
                  type="button"
                  size="xs"
                  onClick={onTouchSession}
                  className={repoGitHubUrl ? undefined : "ml-auto"}
                  aria-label="Move pane to top"
                  title="Move pane to top"
                >
                  <Pin className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <SessionHeaderAlerts
                pipeConflict={session.pipeConflict}
                connectionIssue={connectionIssue}
              />
            </div>
          ) : null}
        </div>
      </header>
    </>
  );
});

SessionHeader.displayName = "SessionHeader";
