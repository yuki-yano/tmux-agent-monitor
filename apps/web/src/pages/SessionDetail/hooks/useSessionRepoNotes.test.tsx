import { act, renderHook, waitFor } from "@testing-library/react";
import type { RepoNote } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { createDeferred } from "../test-helpers";
import { useSessionRepoNotes } from "./useSessionRepoNotes";

const buildNote = (overrides: Partial<RepoNote> = {}): RepoNote => ({
  id: "note-1",
  repoRoot: "/repo",
  title: null,
  body: "body",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...overrides,
});

const createDefaultActions = () => ({
  createRepoNote: vi.fn(async () => buildNote({ id: "created-note" })),
  updateRepoNote: vi.fn(async () => buildNote({ id: "updated-note" })),
  deleteRepoNote: vi.fn(async () => "deleted-note"),
});

describe("useSessionRepoNotes", () => {
  it("returns the created note from createNote", async () => {
    const created = buildNote({ id: "created-note" });
    const requestRepoNotes = vi.fn(async () => []);
    const createRepoNote = vi.fn(async () => created);
    const { updateRepoNote, deleteRepoNote } = createDefaultActions();

    const { result } = renderHook(() =>
      useSessionRepoNotes({
        paneId: "pane-1",
        repoRoot: "/repo",
        connected: true,
        requestRepoNotes,
        createRepoNote,
        updateRepoNote,
        deleteRepoNote,
      }),
    );

    let returned: RepoNote | null = null;
    await act(async () => {
      returned = await result.current.createNote({ title: null, body: "" });
    });

    expect(returned).toEqual(created);
    expect(result.current.notes[0]).toEqual(created);
  });

  it("keeps loading false during silent refresh", async () => {
    const initialNotes = [buildNote({ id: "initial-note" })];
    const silentDeferred = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce(initialNotes)
      .mockImplementationOnce(() => silentDeferred.promise);
    const { createRepoNote, updateRepoNote, deleteRepoNote } = createDefaultActions();

    const { result } = renderHook(() =>
      useSessionRepoNotes({
        paneId: "pane-1",
        repoRoot: "/repo",
        connected: true,
        requestRepoNotes,
        createRepoNote,
        updateRepoNote,
        deleteRepoNote,
      }),
    );

    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(1);
      expect(result.current.notesLoading).toBe(false);
    });

    act(() => {
      result.current.refreshNotes({ silent: true });
    });

    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
      expect(result.current.notesLoading).toBe(false);
    });

    act(() => {
      silentDeferred.resolve([buildNote({ id: "silent-note" })]);
    });

    await waitFor(() => {
      expect(result.current.notes[0]?.id).toBe("silent-note");
    });
  });

  it("clears loading when interactive refresh becomes stale after reconnect refresh", async () => {
    const initialNotes = [buildNote({ id: "initial-note" })];
    const refreshDeferred = createDeferred<RepoNote[]>();
    const reconnectDeferred = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce(initialNotes)
      .mockImplementationOnce(() => refreshDeferred.promise)
      .mockImplementationOnce(() => reconnectDeferred.promise);
    const { createRepoNote, updateRepoNote, deleteRepoNote } = createDefaultActions();

    const { result, rerender } = renderHook(
      ({ connected }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected,
          requestRepoNotes,
          createRepoNote,
          updateRepoNote,
          deleteRepoNote,
        }),
      { initialProps: { connected: false } },
    );

    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(1);
      expect(result.current.notesLoading).toBe(false);
    });

    act(() => {
      result.current.refreshNotes();
    });

    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
      expect(result.current.notesLoading).toBe(true);
    });

    rerender({ connected: true });

    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(3);
    });

    act(() => {
      refreshDeferred.resolve([buildNote({ id: "refresh-note" })]);
    });

    await waitFor(() => {
      expect(result.current.notesLoading).toBe(false);
    });

    act(() => {
      reconnectDeferred.resolve([buildNote({ id: "reconnect-note" })]);
    });

    await waitFor(() => {
      expect(result.current.notes[0]?.id).toBe("reconnect-note");
    });
  });

  it("does not let an older list response overwrite a completed note update", async () => {
    const initialNote = buildNote({ body: "initial" });
    const staleListDeferred = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([initialNote])
      .mockImplementationOnce(() => staleListDeferred.promise);
    const updateRepoNote = vi.fn(async () => buildNote({ body: "updated" }));
    const { createRepoNote, deleteRepoNote } = createDefaultActions();

    const { result } = renderHook(() =>
      useSessionRepoNotes({
        paneId: "pane-1",
        repoRoot: "/repo",
        connected: true,
        requestRepoNotes,
        createRepoNote,
        updateRepoNote,
        deleteRepoNote,
      }),
    );

    await waitFor(() => {
      expect(result.current.notes[0]?.body).toBe("initial");
    });
    act(() => {
      result.current.refreshNotes({ silent: true });
    });
    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await result.current.saveNote("note-1", { title: null, body: "updated" });
    });
    expect(result.current.notes[0]?.body).toBe("updated");

    act(() => {
      staleListDeferred.resolve([initialNote]);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.notes[0]?.body).toBe("updated");
  });

  it("keeps a previous repo load and its finally block out of the current repo scope", async () => {
    const oldRepoLoad = createDeferred<RepoNote[]>();
    const newRepoLoad = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockImplementationOnce(() => oldRepoLoad.promise)
      .mockImplementationOnce(() => newRepoLoad.promise);
    const { createRepoNote, updateRepoNote, deleteRepoNote } = createDefaultActions();
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          createRepoNote,
          updateRepoNote,
          deleteRepoNote,
        }),
      { initialProps: { repoRoot: "/old-repo" } },
    );
    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(1);
      expect(result.current.notesLoading).toBe(true);
    });

    rerender({ repoRoot: "/new-repo" });
    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
      expect(result.current.notesLoading).toBe(true);
    });
    act(() => {
      oldRepoLoad.resolve([buildNote({ id: "old-note", repoRoot: "/old-repo" })]);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.notes).toEqual([]);
    expect(result.current.notesLoading).toBe(true);

    act(() => {
      newRepoLoad.resolve([buildNote({ id: "new-note", repoRoot: "/new-repo" })]);
    });
    await waitFor(() => {
      expect(result.current.notes.map((note) => note.id)).toEqual(["new-note"]);
      expect(result.current.notesLoading).toBe(false);
    });
  });

  it("ignores create, save, and delete completions from a previous repo generation", async () => {
    const oldNote = buildNote({ id: "old-note", repoRoot: "/old-repo" });
    const newNote = buildNote({ id: "new-note", repoRoot: "/new-repo" });
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([oldNote])
      .mockResolvedValueOnce([newNote]);
    const createDeferredNote = createDeferred<RepoNote>();
    const saveDeferredNote = createDeferred<RepoNote>();
    const deleteDeferredNote = createDeferred<string>();
    const createRepoNote = vi.fn(() => createDeferredNote.promise);
    const updateRepoNote = vi.fn(() => saveDeferredNote.promise);
    const deleteRepoNote = vi.fn(() => deleteDeferredNote.promise);
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          createRepoNote,
          updateRepoNote,
          deleteRepoNote,
        }),
      { initialProps: { repoRoot: "/old-repo" } },
    );
    await waitFor(() => expect(result.current.notes.map((note) => note.id)).toEqual(["old-note"]));

    let createResult: Promise<RepoNote | null>;
    let saveResult: Promise<boolean>;
    let deleteResult: Promise<boolean>;
    act(() => {
      createResult = result.current.createNote({ body: "created" });
      saveResult = result.current.saveNote("old-note", { body: "saved" });
      deleteResult = result.current.removeNote("old-note");
    });
    rerender({ repoRoot: "/new-repo" });
    await waitFor(() => expect(result.current.notes.map((note) => note.id)).toEqual(["new-note"]));

    act(() => {
      createDeferredNote.resolve(buildNote({ id: "created-old", repoRoot: "/old-repo" }));
      saveDeferredNote.resolve(buildNote({ id: "saved-old", repoRoot: "/old-repo" }));
      deleteDeferredNote.resolve("old-note");
    });
    await expect(Promise.all([createResult!, saveResult!, deleteResult!])).resolves.toEqual([
      null,
      false,
      false,
    ]);

    expect(result.current.notes.map((note) => note.id)).toEqual(["new-note"]);
    expect(result.current.creatingNote).toBe(false);
    expect(result.current.savingNoteId).toBeNull();
    expect(result.current.deletingNoteId).toBeNull();
    expect(result.current.notesError).toBeNull();
  });

  it("clears notes and shows loading while revisiting a repository", async () => {
    const repoBLoad = createDeferred<RepoNote[]>();
    const repoARevisitLoad = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote({ id: "repo-a-note", repoRoot: "/repo-a" })])
      .mockImplementationOnce(() => repoBLoad.promise)
      .mockImplementationOnce(() => repoARevisitLoad.promise);
    const { createRepoNote, updateRepoNote, deleteRepoNote } = createDefaultActions();

    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          createRepoNote,
          updateRepoNote,
          deleteRepoNote,
        }),
      { initialProps: { repoRoot: "/repo-a" } },
    );

    await waitFor(() => {
      expect(result.current.notes.map((note) => note.id)).toEqual(["repo-a-note"]);
    });

    rerender({ repoRoot: "/repo-b" });
    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
    });
    act(() => {
      repoBLoad.resolve([buildNote({ id: "repo-b-note", repoRoot: "/repo-b" })]);
    });
    await waitFor(() => {
      expect(result.current.notes.map((note) => note.id)).toEqual(["repo-b-note"]);
    });

    rerender({ repoRoot: "/repo-a" });
    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(3);
    });

    expect(result.current.notes).toEqual([]);
    expect(result.current.notesLoading).toBe(true);

    act(() => {
      repoARevisitLoad.resolve([buildNote({ id: "repo-a-note", repoRoot: "/repo-a" })]);
    });
    await waitFor(() => {
      expect(result.current.notes.map((note) => note.id)).toEqual(["repo-a-note"]);
      expect(result.current.notesLoading).toBe(false);
    });
  });

  it("stores a list request rejection as the notes error", async () => {
    const requestRepoNotes = vi.fn().mockRejectedValue(new Error("notes unavailable"));
    const { createRepoNote, updateRepoNote, deleteRepoNote } = createDefaultActions();

    const { result } = renderHook(() =>
      useSessionRepoNotes({
        paneId: "pane-1",
        repoRoot: "/repo",
        connected: true,
        requestRepoNotes,
        createRepoNote,
        updateRepoNote,
        deleteRepoNote,
      }),
    );

    await waitFor(() => {
      expect(result.current.notesError).toBe("notes unavailable");
    });
    expect(result.current.notes).toEqual([]);
    expect(result.current.notesLoading).toBe(false);
  });
});
