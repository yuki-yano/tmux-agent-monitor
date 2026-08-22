import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@vde-monitor/shared";
import { ArrowRight, Clock, GitBranch, X } from "lucide-react";
import {
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildImagePathInsertText,
  insertIntoTextarea,
} from "@/features/shared-session-ui/lib/textarea-insert";

import {
  Badge,
  Callout,
  Card,
  IconButton,
  LastInputPill,
  TagPill,
  TextButton,
} from "@/components/ui";
import {
  AnsiVirtualizedViewport,
  type VirtualizedViewportHandle,
} from "@/features/shared-session-ui/components/AnsiVirtualizedViewport";
import { PaneTextComposer } from "@/features/shared-session-ui/components/PaneTextComposer";
import { usePaneSendText } from "@/features/shared-session-ui/hooks/usePaneSendText";
import { useTerminalControls } from "@/features/shared-session-ui/hooks/useTerminalControls";
import { useTitleEditor } from "@/features/shared-session-ui/hooks/useTitleEditor";
import { confirmDangerousText } from "@/features/shared-session-ui/model/danger-confirm";
import { useRawInputHandlers } from "@/features/shared-session-ui/hooks/useRawInputHandlers";
import { useUserScrollState } from "@/features/shared-session-ui/hooks/useUserScrollState";
import {
  linkifyLogLineFileReferences,
  linkifyLogLineHttpUrls,
} from "@/features/shared-session-ui/lib/log-file-reference";
import { buildPaneTextDraftStorageKey } from "@/features/shared-session-ui/lib/pane-text-draft-storage";
import {
  resolveSessionStateLabel,
  resolveSessionStateTone,
} from "@/features/shared-session-ui/model/session-display";
import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { resolveUnknownErrorMessage } from "@/lib/api-utils";
import {
  agentLabelFor,
  agentToneFor,
  formatBranchLabel,
  formatRelativeTime,
  getLastInputTone,
  isKnownAgent,
} from "@/lib/session-format";
import { useSessionCoreApi, useSessionFilesApi } from "@/state/session-context";

type ChatGridTileProps = {
  session: SessionSummary;
  nowMs: number;
  connected: boolean;
  screenLines: string[];
  screenLoading: boolean;
  screenError: string | null;
  onTouchSession?: (paneId: string) => Promise<void> | void;
  onRemoveFromGrid?: (paneId: string) => void;
};

type ScreenSnapshot = {
  paneId: string;
  lines: string[];
};

type ChatGridTileHeaderProps = {
  session: SessionSummary;
  nowMs: number;
  sessionTone: ReturnType<typeof getLastInputTone>;
  sessionAutoTitle: string;
  sessionDisplayTitle: string;
  canResetTitle: boolean;
  titleDraft: string;
  titleEditing: boolean;
  titleSaving: boolean;
  titleError: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onOpenTitleEditor: () => void;
  onUpdateTitleDraft: (value: string) => void;
  onResetTitle: () => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onTitleBlur: () => void;
  onRemoveFromGrid: () => void;
};

const ChatGridTileHeader = ({
  session,
  nowMs,
  sessionTone,
  sessionAutoTitle,
  sessionDisplayTitle,
  canResetTitle,
  titleDraft,
  titleEditing,
  titleSaving,
  titleError,
  titleInputRef,
  onOpenTitleEditor,
  onUpdateTitleDraft,
  onResetTitle,
  onTitleKeyDown,
  onTitleBlur,
  onRemoveFromGrid,
}: ChatGridTileHeaderProps) => (
  <header className="min-w-0 space-y-1">
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1">
          {titleEditing ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleDraft}
              onChange={(event) => {
                onUpdateTitleDraft(event.target.value);
              }}
              onKeyDown={onTitleKeyDown}
              onBlur={onTitleBlur}
              placeholder={sessionAutoTitle || "Untitled session"}
              maxLength={80}
              enterKeyHint="done"
              disabled={titleSaving}
              className="font-ident border-latte-surface2 text-latte-text focus:border-latte-blue focus:ring-latte-blue/25 bg-latte-base/70 w-full min-w-[160px] rounded-xl border px-2.5 py-1 text-[15px] font-medium leading-snug tracking-normal shadow-[inset_0_1px_0_var(--material-highlight),0_1px_2px_rgb(var(--ctp-shadow)/0.08)] outline-hidden transition-[background-color,border-color,box-shadow] duration-200 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Custom session title"
            />
          ) : (
            <TextButton
              type="button"
              onClick={onOpenTitleEditor}
              variant="title"
              className="font-ident hover:text-latte-blue-text mr-1 block min-w-0 max-w-full truncate text-[15px] font-medium leading-snug tracking-normal transition-colors duration-200"
              aria-label="Edit session title"
              title={sessionDisplayTitle}
            >
              {sessionDisplayTitle}
            </TextButton>
          )}
          {canResetTitle && !titleEditing ? (
            <IconButton
              type="button"
              onClick={onResetTitle}
              disabled={titleSaving}
              variant="dangerOutline"
              size="xs"
              aria-label="Reset session title"
              title="Reset session title"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>
        {titleError ? <p className="text-latte-red-text text-xs">{titleError}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          to="/sessions/$paneId"
          params={{ paneId: session.paneId }}
          aria-label="Open detail"
          className="border-latte-surface2 bg-latte-base/80 text-latte-subtext0 hover:border-latte-blue/60 hover:text-latte-blue-text focus-visible:ring-latte-blue relative inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-[0_1px_3px_rgb(var(--ctp-shadow)/0.12)] transition-[scale,background-color,color,border-color,box-shadow] duration-200 ease-out after:absolute after:-inset-1.5 after:content-[''] active:scale-[0.96] active:duration-100 focus-visible:outline-hidden focus-visible:ring-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <IconButton
          type="button"
          onClick={onRemoveFromGrid}
          variant="dangerOutline"
          size="xs"
          aria-label="Remove from Chat Grid"
          title="Remove from Chat Grid"
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={resolveSessionStateTone(session)} size="sm">
        {resolveSessionStateLabel(session)}
      </Badge>
      {isKnownAgent(session.agent) ? (
        <Badge tone={agentToneFor(session.agent)} size="sm">
          {agentLabelFor(session.agent)}
        </Badge>
      ) : null}
      <LastInputPill
        tone={sessionTone}
        label={<Clock className="h-2.5 w-2.5" />}
        value={formatRelativeTime(session.lastInputAt, nowMs)}
        srLabel="Last input"
        size="xs"
        showDot={false}
      />
    </div>
    <div className="text-latte-subtext0 flex flex-wrap items-center gap-1.5 text-[11px]">
      <TagPill tone="meta" className="inline-flex max-w-[180px] items-center">
        <span className="truncate font-mono">{session.sessionName}</span>
      </TagPill>
      <TagPill tone="meta" className="inline-flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        <span>{formatBranchLabel(session.branch)}</span>
      </TagPill>
      <TagPill tone="meta">Window {session.windowIndex}</TagPill>
      <TagPill tone="meta">Pane {session.paneId}</TagPill>
    </div>
  </header>
);

const useChatGridScreenViewport = ({
  paneId,
  screenLines,
  screenLoading,
}: {
  paneId: string;
  screenLines: string[];
  screenLoading: boolean;
}) => {
  const renderedScreenLines = useMemo(() => {
    if (screenLines.length > 0) {
      return screenLines.map((line) => {
        let linkified = linkifyLogLineFileReferences(line, {
          isLinkableToken: (rawToken) => rawToken.includes("/") || rawToken.includes("\\"),
        });
        if (linkified.includes("http://") || linkified.includes("https://")) {
          linkified = linkifyLogLineHttpUrls(linkified);
        }
        return linkified;
      });
    }
    return screenLoading ? [] : ["No screen data yet."];
  }, [screenLines, screenLoading]);
  const [displaySnapshot, setDisplaySnapshot] = useState<ScreenSnapshot>(() => ({
    paneId,
    lines: renderedScreenLines,
  }));
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [forceFollow, setForceFollow] = useState(true);
  const activePaneIdRef = useRef(paneId);
  const snappedPaneIdRef = useRef<string | null>(null);
  const pendingSnapshotRef = useRef<ScreenSnapshot | null>(null);
  const isUserScrollingRef = useRef(false);
  const viewportRef = useRef<VirtualizedViewportHandle | null>(null);
  const displayLines = displaySnapshot.paneId === paneId ? displaySnapshot.lines : [];
  const effectiveIsAtBottom = displayLines.length === 0 ? true : isAtBottom;

  useLayoutEffect(() => {
    const snapshot = { paneId, lines: renderedScreenLines };
    if (activePaneIdRef.current !== paneId) {
      activePaneIdRef.current = paneId;
      pendingSnapshotRef.current = null;
      isUserScrollingRef.current = false;
      setIsAtBottom(true);
      setForceFollow(true);
    }
    if (isUserScrollingRef.current) {
      pendingSnapshotRef.current = snapshot;
      return;
    }
    pendingSnapshotRef.current = null;
    setDisplaySnapshot(snapshot);
  }, [paneId, renderedScreenLines]);

  const handleUserScrollStateChange = useCallback(
    (value: boolean) => {
      if (activePaneIdRef.current !== paneId) {
        return;
      }
      isUserScrollingRef.current = value;
      if (value) {
        setForceFollow(false);
        return;
      }
      const pendingSnapshot = pendingSnapshotRef.current;
      if (pendingSnapshot?.paneId === paneId) {
        pendingSnapshotRef.current = null;
        setDisplaySnapshot(pendingSnapshot);
      }
    },
    [paneId],
  );
  const { scrollerRef } = useUserScrollState({
    onUserScrollStateChange: handleUserScrollStateChange,
  });
  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "smooth") => {
    setForceFollow(true);
    viewportRef.current?.scrollToEnd({ behavior });
  }, []);

  useLayoutEffect(() => {
    if (displayLines.length === 0 || snappedPaneIdRef.current === paneId) {
      return;
    }
    viewportRef.current?.scrollToEnd({ behavior: "auto" });
    snappedPaneIdRef.current = paneId;
  }, [displayLines.length, paneId]);

  return {
    displayLines,
    effectiveIsAtBottom,
    forceFollow,
    setIsAtBottom,
    viewportRef,
    scrollerRef,
    scrollToBottom,
  };
};

export const ChatGridTile = ({
  session,
  nowMs,
  connected,
  screenLines,
  screenLoading,
  screenError,
  onTouchSession,
  onRemoveFromGrid,
}: ChatGridTileProps) => {
  const {
    sendText,
    sendKeys,
    sendRaw,
    updateSessionTitle,
    resetSessionTitle,
    uploadImageAttachment,
    requestPromptCompletions,
  } = useSessionCoreApi();
  const { requestRepoFileSearch } = useSessionFilesApi();
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [autoEnter, setAutoEnter] = useState(true);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [allowDangerKeys, setAllowDangerKeys] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const sessionTone = getLastInputTone(session.lastInputAt, nowMs);
  const sessionCustomTitle = session.customTitle ?? null;
  const canResetTitle = sessionCustomTitle != null || session.title != null;
  const sessionAutoTitle = session.title ?? session.sessionName ?? "";
  const sessionDisplayTitle = sessionCustomTitle ?? sessionAutoTitle;
  const {
    titleDraft,
    titleEditing,
    titleSaving,
    titleError,
    openTitleEditor,
    updateTitleDraft,
    resetTitle,
    handleTitleKeyDown,
    handleTitleBlur,
  } = useTitleEditor({
    paneId: session.paneId,
    customTitle: sessionCustomTitle,
    updateSessionTitle,
    resetSessionTitle,
    skipSaveIfUnchanged: true,
  });
  const {
    displayLines,
    effectiveIsAtBottom,
    forceFollow,
    setIsAtBottom,
    viewportRef,
    scrollerRef,
    scrollToBottom,
  } = useChatGridScreenViewport({
    paneId: session.paneId,
    screenLines,
    screenLoading,
  });

  const {
    send,
    isSending,
    error: sendError,
  } = usePaneSendText({
    paneId: session.paneId,
    mode: "text",
    sendText,
    setScreenError: setComposerError,
    scrollToBottom,
  });

  const {
    handleRawBeforeInput,
    handleRawInput,
    handleRawKeyDown,
    handleRawCompositionStart,
    handleRawCompositionEnd,
  } = useRawInputHandlers({
    paneId: session.paneId,
    rawMode,
    allowDangerKeys,
    ctrlHeld,
    shiftHeld,
    sendRaw,
    setScreenError: setComposerError,
  });

  const handleSendText = useCallback(async () => {
    const value = textInputRef.current?.value ?? "";
    const sent = await send({
      text: value,
      enter: autoEnter,
      skip: rawMode,
      confirm: () => confirmDangerousText(value),
      onSuccess: () => {
        if (textInputRef.current) {
          textInputRef.current.value = "";
        }
        // usePaneSendText only clears its own internal error state on
        // success, not the setScreenError callback it was given (that
        // callback fires on failure only) — so composerError has to be
        // cleared here explicitly, matching SessionDetail's handleSendText.
        setComposerError(null);
        void onTouchSession?.(session.paneId);
      },
    });
    return sent;
  }, [autoEnter, onTouchSession, rawMode, send, session.paneId]);

  const handlePickImage = useCallback(
    async (file: File) => {
      const textarea = textInputRef.current;
      if (!textarea) {
        return;
      }
      if (!uploadImageAttachment) {
        setComposerError(API_ERROR_MESSAGES.uploadImage);
        return;
      }
      try {
        const attachment = await uploadImageAttachment(session.paneId, file);
        insertIntoTextarea(textarea, buildImagePathInsertText(textarea, attachment.path));
        setComposerError(null);
      } catch (error) {
        setComposerError(resolveUnknownErrorMessage(error, API_ERROR_MESSAGES.uploadImage));
      }
    },
    [session.paneId, uploadImageAttachment],
  );

  // useTerminalControls clears the (locally scoped) composer error after
  // every successful send by default; ChatGridTile additionally touches the
  // session (to bump list recency) after a successful permission shortcut,
  // which SessionDetail has no equivalent for.
  const { handleSendKey, handleSendPermissionShortcut, toggleRawMode } = useTerminalControls({
    paneId: session.paneId,
    ctrlHeld,
    shiftHeld,
    rawMode,
    allowDangerKeys,
    autoEnter,
    sendKeys,
    sendRaw,
    setAutoEnter,
    setRawMode,
    setAllowDangerKeys,
    setSendError: setComposerError,
    onSendPermissionShortcutSuccess: (touchedPaneId) => {
      void onTouchSession?.(touchedPaneId);
    },
  });

  const handleRemoveFromGrid = useCallback(() => {
    onRemoveFromGrid?.(session.paneId);
  }, [onRemoveFromGrid, session.paneId]);

  useEffect(() => {
    if (!titleEditing) {
      return;
    }
    const input = titleInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [titleEditing]);

  const currentComposerError = composerError ?? sendError;
  const callout =
    currentComposerError != null
      ? { tone: "error" as const, message: currentComposerError }
      : screenError != null
        ? { tone: "warning" as const, message: screenError }
        : !connected
          ? { tone: "warning" as const, message: "Disconnected. Reconnecting..." }
          : null;

  return (
    <Card className="grid h-full min-h-[420px] grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-3 sm:p-3.5">
      <ChatGridTileHeader
        session={session}
        nowMs={nowMs}
        sessionTone={sessionTone}
        sessionAutoTitle={sessionAutoTitle}
        sessionDisplayTitle={sessionDisplayTitle}
        canResetTitle={canResetTitle}
        titleDraft={titleDraft}
        titleEditing={titleEditing}
        titleSaving={titleSaving}
        titleError={titleError}
        titleInputRef={titleInputRef}
        onOpenTitleEditor={openTitleEditor}
        onUpdateTitleDraft={updateTitleDraft}
        onResetTitle={() => void resetTitle()}
        onTitleKeyDown={handleTitleKeyDown}
        onTitleBlur={handleTitleBlur}
        onRemoveFromGrid={handleRemoveFromGrid}
      />

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
        <div className="flex min-h-0 flex-col gap-2">
          {callout ? (
            <Callout tone={callout.tone} size="xs">
              {callout.message}
            </Callout>
          ) : null}

          <AnsiVirtualizedViewport
            lines={displayLines}
            scrollContextKey={session.paneId}
            loading={screenLoading}
            loadingLabel="Loading screen..."
            isAtBottom={effectiveIsAtBottom}
            shouldFollowOutput={effectiveIsAtBottom || forceFollow}
            onAtBottomChange={setIsAtBottom}
            viewportRef={viewportRef}
            scrollerRef={scrollerRef}
            onScrollToBottom={scrollToBottom}
            className="border-latte-surface2/80 bg-latte-crust/95 shadow-inner-soft relative min-h-[180px] w-full min-w-0 flex-1 rounded-2xl border"
            viewportClassName="h-full w-full min-w-0 px-1.5 py-1 sm:px-2 sm:py-1.5"
            listClassName="text-latte-text w-max min-w-full font-mono text-xs"
            lineClassName="min-h-4 whitespace-pre leading-4"
            height="100%"
          />
        </div>

        <PaneTextComposer
          state={{
            interactive: connected,
            isSendingText: isSending,
            textInputRef,
            draftStorageKey: buildPaneTextDraftStorageKey(session.paneId),
            autoEnter,
            rawMode,
            allowDangerKeys,
            showPermissionShortcuts: session.state === "WAITING_PERMISSION",
            completion: {
              agent: session.agent,
              paneId: session.paneId,
              requestPromptCompletions,
              requestRepoFileSearch,
            },
            keyPanel: {
              shiftHeld,
              ctrlHeld,
            },
          }}
          actions={{
            onSendText: handleSendText,
            onSendPermissionShortcut: handleSendPermissionShortcut,
            onPickImage: handlePickImage,
            onToggleAutoEnter: () => setAutoEnter((prev) => !prev),
            onToggleRawMode: toggleRawMode,
            onToggleAllowDangerKeys: () => setAllowDangerKeys((prev) => !prev),
            keyPanel: {
              onToggleShift: () => setShiftHeld((prev) => !prev),
              onToggleCtrl: () => setCtrlHeld((prev) => !prev),
              onSendKey: (key: string) => {
                void handleSendKey(key);
              },
            },
            onRawBeforeInput: (event: FormEvent<HTMLTextAreaElement>) => {
              handleRawBeforeInput(event);
            },
            onRawInput: (event: FormEvent<HTMLTextAreaElement>) => {
              handleRawInput(event);
            },
            onRawKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
              handleRawKeyDown(event);
            },
            onRawCompositionStart: () => {
              handleRawCompositionStart();
            },
            onRawCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
              handleRawCompositionEnd(event);
            },
          }}
        />
      </div>
    </Card>
  );
};
