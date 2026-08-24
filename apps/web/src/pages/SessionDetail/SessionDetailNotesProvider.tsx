import type { RepoNote } from "@vde-monitor/shared";
import { type ReactNode, createContext, use, useMemo } from "react";

import { useSessionRepoNotes } from "./hooks/useSessionRepoNotes";
import { useSessionDetailContext } from "./SessionDetailProvider";

export type SessionDetailNotesSectionProps = {
  state: {
    repoRoot: string | null;
    notes: RepoNote[];
    notesLoading: boolean;
    notesError: string | null;
    creatingNote: boolean;
    savingNoteId: string | null;
    deletingNoteId: string | null;
  };
  actions: {
    onRefresh: (options?: { silent?: boolean }) => void;
    onCreate: (input: { title?: string | null; body: string }) => Promise<RepoNote | null>;
    onSave: (noteId: string, input: { title?: string | null; body: string }) => Promise<boolean>;
    onDelete: (noteId: string) => Promise<boolean>;
  };
};

const SessionDetailNotesContext = createContext<SessionDetailNotesSectionProps | null>(null);

export const SessionDetailNotesProvider = ({ children }: { children: ReactNode }) => {
  const { base } = useSessionDetailContext();
  const {
    notes,
    notesLoading,
    notesError,
    creatingNote,
    savingNoteId,
    deletingNoteId,
    refreshNotes,
    createNote,
    saveNote,
    removeNote,
  } = useSessionRepoNotes({
    paneId: base.paneId,
    repoRoot: base.session?.repoRoot ?? null,
    connected: base.connected,
    requestRepoNotes: base.requestRepoNotes,
    createRepoNote: base.createRepoNote,
    updateRepoNote: base.updateRepoNote,
    deleteRepoNote: base.deleteRepoNote,
  });
  const repoRoot = base.session?.repoRoot ?? null;
  const value = useMemo<SessionDetailNotesSectionProps>(
    () => ({
      state: {
        repoRoot,
        notes,
        notesLoading,
        notesError,
        creatingNote,
        savingNoteId,
        deletingNoteId,
      },
      actions: {
        onRefresh: refreshNotes,
        onCreate: createNote,
        onSave: saveNote,
        onDelete: removeNote,
      },
    }),
    [
      createNote,
      creatingNote,
      deletingNoteId,
      notes,
      notesError,
      notesLoading,
      refreshNotes,
      removeNote,
      repoRoot,
      saveNote,
      savingNoteId,
    ],
  );

  return (
    <SessionDetailNotesContext.Provider value={value}>
      {children}
    </SessionDetailNotesContext.Provider>
  );
};

export const useSessionDetailNotesSectionProps = (): SessionDetailNotesSectionProps => {
  const value = use(SessionDetailNotesContext);
  if (!value) {
    throw new Error(
      "useSessionDetailNotesSectionProps must be used within a SessionDetailNotesProvider",
    );
  }
  return value;
};
