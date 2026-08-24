import type { RepoNote } from "@vde-monitor/shared";
import { BookText, Plus, RefreshCw } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";

import {
  Callout,
  Card,
  EmptyState,
  IconButton,
  LoadingOverlay,
  SectionHeader,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { useTimeout } from "@/lib/use-timeout";

import { useNoteAutoFocus } from "../hooks/useNoteAutoFocus";
import { useNoteAutoSave } from "../hooks/useNoteAutoSave";
import { useNotesPolling } from "../hooks/useNotesPolling";
import {
  type SessionDetailNotesSectionProps,
  useSessionDetailNotesSectionProps,
} from "../SessionDetailNotesProvider";
import { NotesDeleteDialog, NotesSectionList } from "./notes-section-list";

export type NotesSectionProps = SessionDetailNotesSectionProps;

const COPY_FEEDBACK_MS = 1200;
const EMPTY_NOTE_PREVIEW = "(empty note)";

const formatPreviewBody = (body: string) => {
  const firstLine = body.split(/\r?\n/u, 1)[0] ?? "";
  const normalized = firstLine.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : EMPTY_NOTE_PREVIEW;
};

export const NotesSection = memo(({ state, actions }: NotesSectionProps) => {
  const { repoRoot, notes, notesLoading, notesError, creatingNote, savingNoteId, deletingNoteId } =
    state;
  const { onRefresh, onCreate, onSave, onDelete } = actions;

  const [openNoteIdSet, setOpenNoteIdSet] = useState<Set<string>>(() => new Set());
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null);
  const [deleteDialogNoteId, setDeleteDialogNoteId] = useState<string | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const addNoteInFlightRef = useRef(false);

  const copyResetTimer = useTimeout();

  const {
    editingNoteId,
    editingBody,
    changeEditingBody,
    beginEdit: autoSaveBeginEdit,
    finishEdit: autoSaveFinishEdit,
    guardToggleClose,
    discardEditing,
    forceStartEditing,
  } = useNoteAutoSave({ notes, onSave });

  const handleNoteAutoEdit = useCallback(
    (note: RepoNote) => {
      setOpenNoteIdSet((prev) => new Set(prev).add(note.id));
      forceStartEditing(note);
    },
    [forceStartEditing],
  );

  const { editingTextareaRef } = useNoteAutoFocus({
    editingNoteId,
  });

  useNotesPolling({ repoRoot, onRefresh });

  const applyToggleNoteOpen = useCallback((noteId: string) => {
    setOpenNoteIdSet((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  const toggleNoteOpen = useCallback(
    (noteId: string) => {
      void guardToggleClose(noteId, () => applyToggleNoteOpen(noteId));
    },
    [applyToggleNoteOpen, guardToggleClose],
  );

  const beginEdit = useCallback(
    (note: RepoNote) => {
      void autoSaveBeginEdit(note, () => {
        setOpenNoteIdSet((prev) => new Set(prev).add(note.id));
      });
    },
    [autoSaveBeginEdit],
  );

  const finishEdit = useCallback(() => {
    void autoSaveFinishEdit();
  }, [autoSaveFinishEdit]);

  const handleAddNote = useCallback(() => {
    if (addNoteInFlightRef.current) return;
    addNoteInFlightRef.current = true;
    setAddingNote(true);
    void (async () => {
      try {
        const flushed = await autoSaveFinishEdit();
        if (!flushed) {
          return;
        }
        const created = await onCreate({ title: null, body: "" });
        if (created) {
          handleNoteAutoEdit(created);
        }
      } finally {
        addNoteInFlightRef.current = false;
        setAddingNote(false);
      }
    })();
  }, [autoSaveFinishEdit, handleNoteAutoEdit, onCreate]);

  const handleCopyNote = useCallback(
    (note: RepoNote) => {
      void (async () => {
        const copied = await copyToClipboard(note.body);
        if (!copied) {
          return;
        }
        setCopiedNoteId(note.id);
        copyResetTimer.set(() => {
          setCopiedNoteId((prev) => (prev === note.id ? null : prev));
        }, COPY_FEEDBACK_MS);
      })();
    },
    [copyResetTimer],
  );

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      void (async () => {
        const ok = await onDelete(noteId);
        if (!ok) {
          return;
        }
        setDeleteDialogNoteId((prev) => (prev === noteId ? null : prev));
        setOpenNoteIdSet((prev) => {
          if (!prev.has(noteId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
        discardEditing(noteId);
      })();
    },
    [discardEditing, onDelete],
  );

  const openDeleteDialog = useCallback((noteId: string) => {
    setDeleteDialogNoteId(noteId);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogNoteId(null);
  }, []);

  return (
    <Card className="relative flex min-w-0 flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
      <div className="relative pb-1.5 sm:pb-2">
        <SectionHeader title="Notes" />
        <div className="absolute right-0 top-0 z-10 flex items-center gap-1.5">
          <IconButton
            type="button"
            size="sm"
            aria-label="Refresh notes"
            onClick={() => onRefresh()}
            disabled={!repoRoot || notesLoading}
          >
            <RefreshCw className={cn("h-4 w-4", notesLoading && "animate-spin")} />
          </IconButton>
          <IconButton
            type="button"
            size="sm"
            variant="base"
            className="border-latte-lavender/70 bg-latte-lavender text-latte-base shadow-glow hover:border-latte-lavender/80 hover:bg-latte-lavender hover:-translate-y-px"
            aria-label="Add note"
            onClick={handleAddNote}
            disabled={!repoRoot || creatingNote || addingNote}
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div
        data-testid="notes-body"
        className={cn("relative min-w-0 flex-1", notesLoading && "min-h-[120px]")}
      >
        {notesLoading ? <LoadingOverlay label="Loading notes..." blocking={false} /> : null}

        {notesError ? (
          <Callout tone="error" size="xs">
            {notesError}
          </Callout>
        ) : null}

        {!repoRoot ? (
          <Callout tone="warning" size="xs">
            {`Repository root is unavailable for this session.`}
          </Callout>
        ) : (
          <>
            {!notesLoading && !notesError && notes.length === 0 ? (
              <EmptyState
                icon={<BookText className="text-latte-overlay1 h-6 w-6" />}
                message="No notes yet"
                iconWrapperClassName="bg-latte-surface1/50"
              />
            ) : null}
            {notes.length > 0 ? (
              <NotesSectionList
                notes={notes}
                openNoteIdSet={openNoteIdSet}
                editingNoteId={editingNoteId}
                editingBody={editingBody}
                copiedNoteId={copiedNoteId}
                savingNoteId={savingNoteId}
                deletingNoteId={deletingNoteId}
                editingTextareaRef={editingTextareaRef}
                onToggleNoteOpen={toggleNoteOpen}
                onCopyNote={handleCopyNote}
                onOpenDeleteDialog={openDeleteDialog}
                onBeginEdit={beginEdit}
                onSetEditingBody={changeEditingBody}
                onFinishEdit={finishEdit}
                formatPreviewBody={formatPreviewBody}
                emptyNotePreview={EMPTY_NOTE_PREVIEW}
              />
            ) : null}
          </>
        )}
      </div>

      <NotesDeleteDialog
        notes={notes}
        deleteDialogNoteId={deleteDialogNoteId}
        deletingNoteId={deletingNoteId}
        savingNoteId={savingNoteId}
        onCloseDeleteDialog={closeDeleteDialog}
        onDeleteNote={handleDeleteNote}
        emptyNotePreview={EMPTY_NOTE_PREVIEW}
      />
    </Card>
  );
});

NotesSection.displayName = "NotesSection";

export const ConnectedNotesSection = () => {
  const props = useSessionDetailNotesSectionProps();
  return <NotesSection {...props} />;
};
