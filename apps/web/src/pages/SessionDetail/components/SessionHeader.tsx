import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { ArrowLeft, Clock, Pin, X } from "lucide-react";
import type { KeyboardEvent } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Callout, IconButton, LastInputPill, TagPill, TextButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { readStoredSessionListFilter } from "@/pages/SessionList/sessionListFilters";

import {
  agentLabelFor,
  agentToneFor,
  backLinkClass,
  formatPath,
  formatRelativeTime,
  formatStateLabel,
  getLastInputTone,
  isKnownAgent,
  stateTone,
} from "../sessionDetailUtils";

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
  onTitleClear: () => void;
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
  onOpenTitleEditor: () => void;
};

type SessionHeaderAlertsProps = {
  pipeConflict: boolean;
  connectionIssue: string | null;
};

type SessionTitleAreaProps = {
  titleEditing: boolean;
  titleDraft: string;
  titleSaving: boolean;
  sessionAutoTitle: string;
  sessionDisplayTitle: string;
  sessionCustomTitle: string | null;
  currentPath: string | null;
  titleError: string | null;
  onTitleDraftChange: (value: string) => void;
  onTitleSave: () => void;
  onTitleClear: () => void;
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
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void onTitleSave();
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
      className="border-latte-surface2 text-latte-text focus:border-latte-lavender focus:ring-latte-lavender/30 bg-latte-base/70 min-w-[180px] flex-1 rounded-2xl border px-3 py-1.5 text-xl shadow-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label="Custom session title"
      autoFocus
    />
  );
};

const SessionTitleButton = ({
  sessionDisplayTitle,
  onOpenTitleEditor,
}: SessionTitleButtonProps) => (
  <TextButton
    type="button"
    onClick={onOpenTitleEditor}
    variant="title"
    className={cn("hover:text-latte-lavender cursor-default transition hover:cursor-pointer")}
    aria-label="Edit session title"
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
  titleEditing,
  titleDraft,
  titleSaving,
  sessionAutoTitle,
  sessionDisplayTitle,
  sessionCustomTitle,
  currentPath,
  titleError,
  onTitleDraftChange,
  onTitleSave,
  onTitleClear,
  onOpenTitleEditor,
  onCloseTitleEditor,
}: SessionTitleAreaProps) => {
  const showClearTitle = Boolean(sessionCustomTitle && !titleEditing);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
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
            onOpenTitleEditor={onOpenTitleEditor}
          />
        )}
        {showClearTitle ? (
          <IconButton
            type="button"
            onClick={() => void onTitleClear()}
            disabled={titleSaving}
            variant="dangerOutline"
            size="xs"
            aria-label="Clear custom title"
            title="Clear custom title"
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        <span className="text-latte-subtext0 max-w-full truncate text-xs sm:max-w-[360px] sm:text-sm">
          {formatPath(currentPath)}
        </span>
      </div>
      {titleError ? <p className="text-latte-red text-xs">{titleError}</p> : null}
    </>
  );
};

export const SessionHeader = ({ state, actions }: SessionHeaderProps) => {
  const { session, connectionIssue, nowMs, titleDraft, titleEditing, titleSaving, titleError } =
    state;
  const {
    onTitleDraftChange,
    onTitleSave,
    onTitleClear,
    onOpenTitleEditor,
    onCloseTitleEditor,
    onTouchSession,
  } = actions;

  const sessionCustomTitle = session.customTitle ?? null;
  const sessionAutoTitle = session.title ?? session.sessionName ?? "";
  const sessionDisplayTitle = sessionCustomTitle ?? sessionAutoTitle;
  const lastInputTone = getLastInputTone(session.lastInputAt ?? null, nowMs);
  const backToListSearch = { filter: readStoredSessionListFilter() };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link to="/" search={backToListSearch} className={backLinkClass}>
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Link>
        <ThemeToggle />
      </div>
      <header className="shadow-glass border-latte-surface1/60 bg-latte-base/80 flex flex-col gap-3 rounded-3xl border p-4 backdrop-blur">
        <div className="flex flex-col gap-2">
          <SessionTitleArea
            titleEditing={titleEditing}
            titleDraft={titleDraft}
            titleSaving={titleSaving}
            sessionAutoTitle={sessionAutoTitle}
            sessionDisplayTitle={sessionDisplayTitle}
            sessionCustomTitle={sessionCustomTitle}
            currentPath={session.currentPath}
            titleError={titleError}
            onTitleDraftChange={onTitleDraftChange}
            onTitleSave={onTitleSave}
            onTitleClear={onTitleClear}
            onOpenTitleEditor={onOpenTitleEditor}
            onCloseTitleEditor={onCloseTitleEditor}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stateTone(session.state)} size="sm">
              {formatStateLabel(session.state)}
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TagPill tone="meta">Session {session.sessionName}</TagPill>
            <TagPill tone="meta">Window {session.windowIndex}</TagPill>
            <TagPill tone="meta">Pane {session.paneId}</TagPill>
            <IconButton
              type="button"
              size="xs"
              onClick={onTouchSession}
              className="ml-auto"
              aria-label="Pin session to top"
              title="Pin session to top"
            >
              <Pin className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
        <SessionHeaderAlerts
          pipeConflict={session.pipeConflict}
          connectionIssue={connectionIssue}
        />
      </header>
    </>
  );
};
