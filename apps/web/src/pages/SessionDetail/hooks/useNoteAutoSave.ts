import type { RepoNote } from "@vde-monitor/shared";
import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { useLazyRef } from "@/lib/use-lazy-ref";

const AUTO_SAVE_DEBOUNCE_MS = 700;

type UseNoteAutoSaveParams = {
  notes: RepoNote[];
  onSave: (noteId: string, input: { title: string | null; body: string }) => Promise<boolean>;
};

type EditingState = {
  noteId: string | null;
  body: string;
};

type PendingSave = {
  noteId: string;
  body: string;
  generation: number;
  promise: Promise<boolean>;
};

const EMPTY_EDITING_STATE: EditingState = { noteId: null, body: "" };
const replaceEditingState = (_current: EditingState, next: EditingState) => next;

/**
 * Owns the "currently editing note" state machine: debounced auto-save while
 * typing, serialized save requests, flush-on-switch/close, and timer cleanup
 * on unmount.
 */
export const useNoteAutoSave = ({ notes, onSave }: UseNoteAutoSaveParams) => {
  const [editing, dispatchEditing] = useReducer(replaceEditingState, EMPTY_EDITING_STATE);
  const editingNoteExists = editing.noteId
    ? notes.some((note) => note.id === editing.noteId)
    : false;

  const editingRef = useRef<EditingState>(EMPTY_EDITING_STATE);
  const editingSessionGenerationRef = useRef(0);
  const listedEditingNoteIdRef = useRef<string | null>(null);
  const lastSavedBodyRef = useRef("");
  const saveQueueRef = useLazyRef<Promise<boolean>>(() => Promise.resolve(true));
  const pendingSaveRef = useRef<PendingSave | null>(null);

  const runAutoSave = useCallback(
    (noteId: string, body: string, generation = editingSessionGenerationRef.current) => {
      const pendingSave = pendingSaveRef.current;
      if (
        pendingSave?.noteId === noteId &&
        pendingSave.body === body &&
        pendingSave.generation === generation
      ) {
        return pendingSave.promise;
      }
      const queuedSave = saveQueueRef.current.then(async () => {
        if (editingSessionGenerationRef.current !== generation) {
          return true;
        }
        try {
          const ok = await onSave(noteId, { title: null, body });
          if (ok && editingRef.current.noteId === noteId) {
            lastSavedBodyRef.current = body;
          }
          return ok;
        } catch {
          return false;
        }
      });
      saveQueueRef.current = queuedSave;
      pendingSaveRef.current = { noteId, body, generation, promise: queuedSave };
      void queuedSave.then(() => {
        if (pendingSaveRef.current?.promise === queuedSave) pendingSaveRef.current = null;
      });
      return queuedSave;
    },
    [onSave, saveQueueRef],
  );

  const debouncedSave = useDebouncedCallback((noteId: string, body: string) => {
    if (
      editing.noteId !== noteId ||
      editing.body !== body ||
      (listedEditingNoteIdRef.current === noteId && !notes.some((note) => note.id === noteId))
    ) {
      return;
    }
    void runAutoSave(noteId, body);
  }, AUTO_SAVE_DEBOUNCE_MS);

  const applyEditingTransition = useCallback(
    (nextEditing: EditingState, lastSavedBody: string, scheduleSave: boolean) => {
      debouncedSave.cancel();
      if (editingRef.current.noteId !== nextEditing.noteId) {
        editingSessionGenerationRef.current += 1;
        listedEditingNoteIdRef.current =
          nextEditing.noteId != null && notes.some((note) => note.id === nextEditing.noteId)
            ? nextEditing.noteId
            : null;
      }
      editingRef.current = nextEditing;
      lastSavedBodyRef.current = lastSavedBody;
      dispatchEditing(nextEditing);

      if (scheduleSave && nextEditing.noteId && nextEditing.body !== lastSavedBody) {
        debouncedSave.run(nextEditing.noteId, nextEditing.body);
      }
    },
    [debouncedSave, notes],
  );

  const clearEditingState = useCallback(() => {
    applyEditingTransition(EMPTY_EDITING_STATE, "", false);
  }, [applyEditingTransition]);

  useLayoutEffect(() => {
    if (!editing.noteId) return;
    if (editingNoteExists) {
      listedEditingNoteIdRef.current = editing.noteId;
      return;
    }
    if (listedEditingNoteIdRef.current !== editing.noteId) return;
    applyEditingTransition(EMPTY_EDITING_STATE, "", false);
  }, [applyEditingTransition, editing.noteId, editingNoteExists]);

  const flushPendingAutoSave = useCallback(async () => {
    const currentEditing = editingRef.current;
    if (!currentEditing.noteId) {
      return true;
    }
    debouncedSave.cancel();
    if (
      listedEditingNoteIdRef.current === currentEditing.noteId &&
      !notes.some((note) => note.id === currentEditing.noteId)
    ) {
      return true;
    }
    if (currentEditing.body === lastSavedBodyRef.current) {
      return true;
    }
    return runAutoSave(currentEditing.noteId, currentEditing.body);
  }, [debouncedSave, notes, runAutoSave]);

  // Not declared `async`: when no flush is needed (the common case), the
  // state updates and `onSwitched` run synchronously in the caller's tick.
  const beginEdit = useCallback(
    (note: RepoNote, onSwitched?: () => void): Promise<boolean> => {
      const switchToNote = () => {
        applyEditingTransition({ noteId: note.id, body: note.body }, note.body, false);
        onSwitched?.();
      };

      if (editingRef.current.noteId && editingRef.current.noteId !== note.id) {
        return (async () => {
          const ok = await flushPendingAutoSave();
          if (!ok) {
            return false;
          }
          switchToNote();
          return true;
        })();
      }
      switchToNote();
      return Promise.resolve(true);
    },
    [applyEditingTransition, flushPendingAutoSave],
  );

  const changeEditingBody = useCallback(
    (body: string) => {
      const currentEditing = editingRef.current;
      if (!currentEditing.noteId) {
        return;
      }
      applyEditingTransition(
        { noteId: currentEditing.noteId, body },
        lastSavedBodyRef.current,
        true,
      );
    },
    [applyEditingTransition],
  );

  const finishEdit = useCallback(async () => {
    const ok = await flushPendingAutoSave();
    if (!ok) {
      return false;
    }
    clearEditingState();
    return true;
  }, [clearEditingState, flushPendingAutoSave]);

  // This is the pre-toggle guard for collapsing an open note's accordion, not
  // a "close/finish editing" action in its own right.
  const guardToggleClose = useCallback(
    (noteId: string, onGuarded?: () => void): Promise<boolean> => {
      if (editingRef.current.noteId !== noteId) {
        onGuarded?.();
        return Promise.resolve(true);
      }
      return (async () => {
        const ok = await flushPendingAutoSave();
        if (!ok) {
          return false;
        }
        clearEditingState();
        onGuarded?.();
        return true;
      })();
    },
    [clearEditingState, flushPendingAutoSave],
  );

  const discardEditing = useCallback(
    (noteId: string) => {
      if (editingRef.current.noteId === noteId) {
        clearEditingState();
      }
    },
    [clearEditingState],
  );

  // New-note auto-edit intentionally switches immediately without flushing
  // the previous edit, matching the create-note workflow.
  const forceStartEditing = useCallback(
    (note: RepoNote) => {
      applyEditingTransition({ noteId: note.id, body: note.body }, note.body, false);
    },
    [applyEditingTransition],
  );

  return {
    editingNoteId: editing.noteId,
    editingBody: editing.body,
    changeEditingBody,
    beginEdit,
    finishEdit,
    guardToggleClose,
    discardEditing,
    forceStartEditing,
  };
};
