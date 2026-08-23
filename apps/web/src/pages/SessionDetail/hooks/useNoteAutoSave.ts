import type { RepoNote } from "@vde-monitor/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { useLazyRef } from "@/lib/use-lazy-ref";

const AUTO_SAVE_DEBOUNCE_MS = 700;

type UseNoteAutoSaveParams = {
  notes: RepoNote[];
  onSave: (noteId: string, input: { title: string | null; body: string }) => Promise<boolean>;
};

/**
 * Owns the "currently editing note" state machine: debounced auto-save while
 * typing, serialized save requests, and flush-on-switch/close/unmount so a
 * pending edit is never silently dropped when the user moves away from it.
 */
export const useNoteAutoSave = ({ notes, onSave }: UseNoteAutoSaveParams) => {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const editingNoteExists = editingNoteId ? notes.some((note) => note.id === editingNoteId) : false;

  // Mirrors of the state above so timer callbacks (armed against a stale
  // closure) can always read the latest editing target/body.
  const editingNoteIdRef = useRef<string | null>(null);
  const editingBodyRef = useRef("");
  const lastSavedBodyRef = useRef("");
  const [listedEditingNoteId, setListedEditingNoteId] = useState<string | null>(null);
  const saveQueueRef = useLazyRef<Promise<boolean>>(() => Promise.resolve(true));

  useEffect(() => {
    editingNoteIdRef.current = editingNoteId;
  }, [editingNoteId]);

  useEffect(() => {
    editingBodyRef.current = editingBody;
  }, [editingBody]);

  // Resets the editing target back to "nothing being edited". Shared by every
  // call site that clears editing state outright (as opposed to switching to
  // a different note), so the same three fields never drift out of sync.
  const clearEditingState = useCallback(() => {
    setEditingNoteId(null);
    setEditingBody("");
    lastSavedBodyRef.current = "";
    setListedEditingNoteId(null);
  }, []);

  const runAutoSave = useCallback(
    (noteId: string, body: string) => {
      const queuedSave = saveQueueRef.current.then(async () => {
        try {
          const ok = await onSave(noteId, { title: null, body });
          if (ok && editingNoteIdRef.current === noteId) {
            lastSavedBodyRef.current = body;
          }
          return ok;
        } catch {
          return false;
        }
      });
      saveQueueRef.current = queuedSave;
      return queuedSave;
    },
    [onSave, saveQueueRef],
  );

  const debouncedSave = useDebouncedCallback((noteId: string, body: string) => {
    void runAutoSave(noteId, body);
  }, AUTO_SAVE_DEBOUNCE_MS);

  if (editingNoteId && editingNoteExists && listedEditingNoteId !== editingNoteId) {
    setListedEditingNoteId(editingNoteId);
  } else if (editingNoteId && !editingNoteExists && listedEditingNoteId === editingNoteId) {
    setEditingNoteId(null);
    setEditingBody("");
    setListedEditingNoteId(null);
  }

  useEffect(() => {
    if (!editingNoteId) {
      debouncedSave.cancel();
      return;
    }
    if (editingBody === lastSavedBodyRef.current) {
      debouncedSave.cancel();
      return;
    }
    debouncedSave.run(editingNoteId, editingBody);
    return debouncedSave.cancel;
  }, [debouncedSave, editingBody, editingNoteId]);

  const flushPendingAutoSave = useCallback(async () => {
    const noteId = editingNoteIdRef.current;
    if (!noteId) {
      return true;
    }
    debouncedSave.cancel();
    const currentBody = editingBodyRef.current;
    if (currentBody === lastSavedBodyRef.current) {
      return true;
    }
    return runAutoSave(noteId, currentBody);
  }, [debouncedSave, runAutoSave]);

  // Not declared `async`: when no flush is needed (the common case), the
  // state updates and `onSwitched` run synchronously in the caller's tick,
  // matching the pre-split behavior where `beginEdit` only awaited when it
  // actually had a previous note's edit to flush.
  const beginEdit = useCallback(
    (note: RepoNote, onSwitched?: () => void): Promise<boolean> => {
      if (editingNoteIdRef.current && editingNoteIdRef.current !== note.id) {
        return (async () => {
          const ok = await flushPendingAutoSave();
          if (!ok) {
            return false;
          }
          setEditingNoteId(note.id);
          setEditingBody(note.body);
          lastSavedBodyRef.current = note.body;
          onSwitched?.();
          return true;
        })();
      }
      setEditingNoteId(note.id);
      setEditingBody(note.body);
      lastSavedBodyRef.current = note.body;
      onSwitched?.();
      return Promise.resolve(true);
    },
    [flushPendingAutoSave],
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
  // a "close/finish editing" action in its own right: when the target note
  // isn't the one being edited, it just waves the toggle through immediately;
  // only when it matches does it flush the pending edit before allowing the
  // collapse. Same non-`async` shape as `beginEdit` so the common (no-flush)
  // case calls `onGuarded` synchronously in the caller's tick.
  const guardToggleClose = useCallback(
    (noteId: string, onGuarded?: () => void): Promise<boolean> => {
      if (editingNoteIdRef.current !== noteId) {
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
      if (editingNoteIdRef.current !== noteId) {
        return;
      }
      debouncedSave.cancel();
      clearEditingState();
    },
    [clearEditingState, debouncedSave],
  );

  // New-note auto-edit intentionally skips flushPendingAutoSave: unlike
  // beginEdit, it switches the editing target immediately without trying to
  // save whatever was being edited before (matches the pre-split behavior).
  const forceStartEditing = useCallback((note: RepoNote) => {
    setEditingNoteId(note.id);
    setEditingBody(note.body);
    lastSavedBodyRef.current = note.body;
    setListedEditingNoteId(null);
  }, []);

  return {
    editingNoteId,
    editingBody,
    setEditingBody,
    beginEdit,
    finishEdit,
    guardToggleClose,
    discardEditing,
    forceStartEditing,
  };
};
