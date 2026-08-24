import { act, renderHook } from "@testing-library/react";
import type { RepoNote } from "@vde-monitor/shared";
import { type ReactNode, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNoteAutoSave } from "./useNoteAutoSave";

const buildNote = (overrides: Partial<RepoNote> = {}): RepoNote => ({
  id: "note-1",
  repoRoot: "/repo",
  title: null,
  body: "original body",
  createdAt: "2026-02-10T00:00:00.000Z",
  updatedAt: "2026-02-10T00:00:00.000Z",
  ...overrides,
});

describe("useNoteAutoSave", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not save until 700ms after the last body change, then saves once", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });

    act(() => {
      result.current.changeEditingBody("updated");
    });

    await act(async () => {
      vi.advanceTimersByTime(699);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("note-1", { title: null, body: "updated" });
  });

  it("collapses rapid edits into a single save using the latest body", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });

    act(() => {
      result.current.changeEditingBody("first");
      vi.advanceTimersByTime(400);
      result.current.changeEditingBody("second");
      vi.advanceTimersByTime(400);
      result.current.changeEditingBody("third");
    });

    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("note-1", { title: null, body: "third" });
  });

  it("flushes the latest body after multiple changes in the same tick", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });

    act(() => {
      result.current.changeEditingBody("first");
      result.current.changeEditingBody("second");
      result.current.changeEditingBody("latest");
    });

    await act(async () => {
      await result.current.finishEdit();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("note-1", { title: null, body: "latest" });
  });

  it("does not arm a save when the body matches the last saved body", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });

    act(() => {
      result.current.changeEditingBody(note.body);
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flushes a pending save immediately (bypassing the debounce) on finishEdit", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("flushed body");
    });

    await act(async () => {
      await result.current.finishEdit();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("note-1", { title: null, body: "flushed body" });
    expect(result.current.editingNoteId).toBeNull();
    expect(result.current.editingBody).toBe("");
  });

  it("flushes the previous note's pending edit before switching via beginEdit", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const noteA = buildNote({ id: "note-a", body: "a-body" });
    const noteB = buildNote({ id: "note-b", body: "b-body" });
    const { result } = renderHook(() => useNoteAutoSave({ notes: [noteA, noteB], onSave }));

    await act(async () => {
      await result.current.beginEdit(noteA);
    });
    act(() => {
      result.current.changeEditingBody("a-draft");
    });

    await act(async () => {
      await result.current.beginEdit(noteB);
    });

    expect(onSave).toHaveBeenCalledWith("note-a", { title: null, body: "a-draft" });
    expect(result.current.editingNoteId).toBe("note-b");
    expect(result.current.editingBody).toBe("b-body");
  });

  it("flushes the latest body when changing and switching notes in the same tick", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const noteA = buildNote({ id: "note-a", body: "a-body" });
    const noteB = buildNote({ id: "note-b", body: "b-body" });
    const { result } = renderHook(() => useNoteAutoSave({ notes: [noteA, noteB], onSave }));

    await act(async () => {
      await result.current.beginEdit(noteA);
    });

    await act(async () => {
      result.current.changeEditingBody("same-tick draft");
      await result.current.beginEdit(noteB);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("note-a", {
      title: null,
      body: "same-tick draft",
    });
    expect(result.current.editingNoteId).toBe("note-b");
  });

  it("keeps the current draft after a failed switch and retries it on the next switch", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const noteA = buildNote({ id: "note-a", body: "a-body" });
    const noteB = buildNote({ id: "note-b", body: "b-body" });
    const { result } = renderHook(() => useNoteAutoSave({ notes: [noteA, noteB], onSave }));

    await act(async () => {
      await result.current.beginEdit(noteA);
    });
    act(() => {
      result.current.changeEditingBody("a-draft");
    });

    let switched = true;
    await act(async () => {
      switched = await result.current.beginEdit(noteB);
    });

    expect(switched).toBe(false);
    expect(result.current.editingNoteId).toBe("note-a");
    expect(result.current.editingBody).toBe("a-draft");

    await act(async () => {
      switched = await result.current.beginEdit(noteB);
    });

    expect(switched).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, "note-a", { title: null, body: "a-draft" });
    expect(result.current.editingNoteId).toBe("note-b");
  });

  it("serializes auto-save requests while a previous save is in flight", async () => {
    vi.useFakeTimers();
    const createDeferred = () => {
      let resolve: (value: boolean) => void = () => {};
      const promise = new Promise<boolean>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const first = createDeferred();
    const second = createDeferred();
    const onSave =
      vi.fn<(noteId: string, input: { title: string | null; body: string }) => Promise<boolean>>();
    onSave.mockImplementationOnce(() => first.promise);
    onSave.mockImplementationOnce(() => second.promise);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("first");
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.changeEditingBody("second");
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    // Second debounce fired, but the save is queued behind the first (still in flight).
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, "note-1", { title: null, body: "second" });

    await act(async () => {
      second.resolve(true);
      await Promise.resolve();
    });
  });

  it("discards a pending edit without saving when the note is deleted", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("about to be deleted");
    });

    act(() => {
      result.current.discardEditing("note-1");
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editingNoteId).toBeNull();
  });

  it("guardToggleClose flushes and clears editing only when the target note matches", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const noteA = buildNote({ id: "note-a" });
    const noteB = buildNote({ id: "note-b" });
    const { result } = renderHook(() => useNoteAutoSave({ notes: [noteA, noteB], onSave }));

    await act(async () => {
      await result.current.beginEdit(noteA);
    });
    act(() => {
      result.current.changeEditingBody("a-draft");
    });

    let okForOther = false;
    await act(async () => {
      okForOther = await result.current.guardToggleClose("note-b");
    });
    expect(okForOther).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editingNoteId).toBe("note-a");

    let okForCurrent = false;
    await act(async () => {
      okForCurrent = await result.current.guardToggleClose("note-a");
    });
    expect(okForCurrent).toBe(true);
    expect(onSave).toHaveBeenCalledWith("note-a", { title: null, body: "a-draft" });
    expect(result.current.editingNoteId).toBeNull();
  });

  it("forceStartEditing switches directly without flushing a previous pending edit", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const noteA = buildNote({ id: "note-a", body: "a-body" });
    const noteB = buildNote({ id: "note-b", body: "b-body" });
    const { result } = renderHook(() => useNoteAutoSave({ notes: [noteA, noteB], onSave }));

    await act(async () => {
      await result.current.beginEdit(noteA);
    });
    act(() => {
      result.current.changeEditingBody("a-draft");
    });

    act(() => {
      result.current.forceStartEditing(noteB);
    });

    expect(result.current.editingNoteId).toBe("note-b");
    expect(result.current.editingBody).toBe("b-body");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    // The switch happened without flushing note-a's draft.
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears the editing state when the currently edited note disappears from the list", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result, rerender } = renderHook(
      ({ notes }: { notes: RepoNote[] }) => useNoteAutoSave({ notes, onSave }),
      { initialProps: { notes: [note] } },
    );

    await act(async () => {
      await result.current.beginEdit(note);
    });
    expect(result.current.editingNoteId).toBe("note-1");

    act(() => {
      rerender({ notes: [] });
    });

    expect(result.current.editingNoteId).toBeNull();
  });

  it("invalidates a pending save when the edited note disappears during a refetch", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result, rerender } = renderHook(
      ({ notes }: { notes: RepoNote[] }) => useNoteAutoSave({ notes, onSave }),
      { initialProps: { notes: [note] } },
    );

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("removed note draft");
      rerender({ notes: [] });
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(result.current.editingNoteId).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not start a queued save after the edited note disappears", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: boolean) => void = () => {};
    const firstSave = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const onSave = vi
      .fn<(noteId: string, input: { title: string | null; body: string }) => Promise<boolean>>()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(true);
    const note = buildNote();
    const { result, rerender } = renderHook(
      ({ notes }: { notes: RepoNote[] }) => useNoteAutoSave({ notes, onSave }),
      { initialProps: { notes: [note] } },
    );

    await act(async () => result.current.beginEdit(note));
    act(() => result.current.changeEditingBody("first"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => result.current.changeEditingBody("queued"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => rerender({ notes: [] }));
    await act(async () => Promise.resolve());
    expect(result.current.editingNoteId).toBeNull();
    await act(async () => {
      resolveFirst(true);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("invalidates a queued save before a parent layout effect settles the active save", async () => {
    vi.useFakeTimers();
    let currentNotes = [buildNote()];
    let resolveFirst: (value: boolean) => void = () => {};
    const firstSave = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const onSave = vi
      .fn<(noteId: string, input: { title: string | null; body: string }) => Promise<boolean>>()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(true);
    const Wrapper = ({ children }: { children: ReactNode }) => {
      const editedNoteIsMissing = currentNotes.length === 0;
      useLayoutEffect(() => {
        if (editedNoteIsMissing) resolveFirst(true);
      }, [editedNoteIsMissing]);
      return children;
    };
    const { result, rerender } = renderHook(
      () => useNoteAutoSave({ notes: currentNotes, onSave }),
      { wrapper: Wrapper },
    );

    await act(async () => result.current.beginEdit(currentNotes[0]!));
    act(() => result.current.changeEditingBody("first"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.changeEditingBody("queued"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenCalledTimes(1);

    currentNotes = [];
    act(() => rerender());
    await act(async () => Promise.resolve());

    expect(result.current.editingNoteId).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("reuses a queued save when finishEdit flushes the same body", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: boolean) => void = () => {};
    const firstSave = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const onSave = vi
      .fn<(noteId: string, input: { title: string | null; body: string }) => Promise<boolean>>()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(true);
    const note = buildNote();
    const { result } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => result.current.beginEdit(note));
    act(() => result.current.changeEditingBody("first"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.changeEditingBody("queued"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenCalledTimes(1);

    let finishPromise: Promise<boolean> | undefined;
    act(() => {
      finishPromise = result.current.finishEdit();
    });
    resolveFirst(true);
    await act(async () => finishPromise);

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, "note-1", {
      title: null,
      body: "queued",
    });
    expect(result.current.editingNoteId).toBeNull();
  });

  it("flushes an optimistic created note before it appears in the notes list", async () => {
    const onSave = vi.fn(async () => true);
    const note = buildNote({ id: "new-note", body: "" });
    const { result } = renderHook(() => useNoteAutoSave({ notes: [], onSave }));

    act(() => {
      result.current.forceStartEditing(note);
      result.current.changeEditingBody("optimistic draft");
    });
    await act(async () => result.current.finishEdit());

    expect(onSave).toHaveBeenCalledWith("new-note", {
      title: null,
      body: "optimistic draft",
    });
  });

  it("does not restore stale editing state when a deleted note id reappears", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result, rerender } = renderHook(
      ({ notes }: { notes: RepoNote[] }) => useNoteAutoSave({ notes, onSave }),
      { initialProps: { notes: [note] } },
    );

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("stale draft");
    });

    act(() => {
      rerender({ notes: [] });
    });
    expect(result.current.editingNoteId).toBeNull();

    act(() => {
      rerender({ notes: [note] });
    });

    expect(result.current.editingNoteId).toBeNull();
    expect(result.current.editingBody).toBe("");
  });

  it("does not fire a save after unmount", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => true);
    const note = buildNote();
    const { result, unmount } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("never saved");
    });

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not cancel an already-started save on unmount", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: boolean) => void = () => {};
    const firstSave = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const onSave = vi
      .fn<(noteId: string, input: { title: string | null; body: string }) => Promise<boolean>>()
      .mockImplementationOnce(() => firstSave);
    const note = buildNote();
    const { result, unmount } = renderHook(() => useNoteAutoSave({ notes: [note], onSave }));

    await act(async () => {
      await result.current.beginEdit(note);
    });
    act(() => {
      result.current.changeEditingBody("first");
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveFirst(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
