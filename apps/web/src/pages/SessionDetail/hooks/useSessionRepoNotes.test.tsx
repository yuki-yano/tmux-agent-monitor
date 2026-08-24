import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RepoNote } from "@vde-monitor/shared";
import { type PropsWithChildren, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
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

const createQueryWrapper = (strict = false) => {
  const queryClient = createAppQueryClient();
  const Wrapper = ({ children }: PropsWithChildren) => {
    const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
  return { queryClient, Wrapper };
};

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe("useSessionRepoNotes", () => {
  it("uses the scoped query options and forwards its AbortSignal", async () => {
    let receivedSignal: AbortSignal | undefined;
    const requestRepoNotes = vi.fn(async (_paneId: string, signal?: AbortSignal) => {
      receivedSignal = signal;
      return [];
    });
    const actions = createDefaultActions();
    const { queryClient, Wrapper } = createQueryWrapper();

    renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...actions,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(receivedSignal).toBeInstanceOf(AbortSignal));
    const query = queryClient.getQueryCache().find({
      queryKey: sessionDetailQueryKeys.notes("pane-1", "/repo"),
      exact: true,
    });
    expect(query?.options).toMatchObject({
      staleTime: 0,
      gcTime: 0,
      retry: false,
      networkMode: "online",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: "always",
      refetchInterval: false,
      refetchIntervalInBackground: false,
    });
  });

  it("shows a cold offline error without a spinner and resumes with one request", async () => {
    onlineManager.setOnline(false);
    const requestRepoNotes = vi.fn(async () => [buildNote()]);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.notesError).toBe("Offline: waiting to load notes");
      expect(result.current.notesLoading).toBe(false);
    });
    expect(result.current.notes).toEqual([]);
    expect(requestRepoNotes).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(requestRepoNotes).toHaveBeenCalledTimes(1);
  });

  it("does not treat a fetched empty cache as a cold offline query", async () => {
    const requestRepoNotes = vi.fn(async () => []);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(requestRepoNotes).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.notesLoading).toBe(false));
    act(() => onlineManager.setOnline(false));
    act(() => result.current.refreshNotes({ silent: true }));

    await waitFor(() => expect(result.current.notesError).toBeNull());
    expect(result.current.notes).toEqual([]);
    expect(result.current.notesLoading).toBe(false);
  });

  it("loads immediately but silently when the app reconnects", async () => {
    const deferred = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi.fn(() => deferred.promise);
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ connected }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { initialProps: { connected: false }, wrapper: Wrapper },
    );

    expect(requestRepoNotes).not.toHaveBeenCalled();
    rerender({ connected: true });
    await waitFor(() => expect(requestRepoNotes).toHaveBeenCalledTimes(1));
    expect(result.current.notesLoading).toBe(false);

    act(() => deferred.resolve([buildNote()]));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
  });

  it("drops gcTime zero data when revisiting repository A", async () => {
    const revisit = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote({ id: "a", repoRoot: "/a" })])
      .mockResolvedValueOnce([buildNote({ id: "b", repoRoot: "/b" })])
      .mockImplementationOnce(() => revisit.promise);
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { initialProps: { repoRoot: "/a" }, wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.notes[0]?.id).toBe("a"));
    rerender({ repoRoot: "/b" });
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("b"));
    rerender({ repoRoot: "/a" });
    await waitFor(() => expect(requestRepoNotes).toHaveBeenCalledTimes(3));
    expect(result.current.notes).toEqual([]);
    expect(result.current.notesLoading).toBe(true);

    act(() => revisit.resolve([buildNote({ id: "a-new", repoRoot: "/a" })]));
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("a-new"));
  });

  it("coalesces the actual StrictMode replay into one list request", async () => {
    const requestRepoNotes = vi.fn(async () => [buildNote()]);
    const { Wrapper } = createQueryWrapper(true);
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(requestRepoNotes).toHaveBeenCalledTimes(1);
  });

  it("cancels a cold request and gives the latest interactive refresh priority", async () => {
    const latest = createDeferred<RepoNote[]>();
    let firstSignal: AbortSignal | undefined;
    const requestRepoNotes = vi
      .fn()
      .mockImplementationOnce((_paneId: string, signal?: AbortSignal) => {
        firstSignal = signal;
        return new Promise<RepoNote[]>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      })
      .mockImplementationOnce(() => latest.promise);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(firstSignal).toBeDefined());
    act(() => result.current.refreshNotes());
    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
      expect(requestRepoNotes).toHaveBeenCalledTimes(2);
      expect(result.current.notesLoading).toBe(true);
    });

    act(() => latest.resolve([buildNote({ id: "latest" })]));
    await waitFor(() => {
      expect(result.current.notes[0]?.id).toBe("latest");
      expect(result.current.notesLoading).toBe(false);
    });
  });

  it("aborts a pending initial request when its repository scope changes", async () => {
    let repoASignal: AbortSignal | undefined;
    const requestRepoNotes = vi
      .fn()
      .mockImplementationOnce((_paneId: string, signal?: AbortSignal) => {
        repoASignal = signal;
        return new Promise<RepoNote[]>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      })
      .mockResolvedValueOnce([buildNote({ id: "repo-b", repoRoot: "/b" })]);
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { initialProps: { repoRoot: "/a" }, wrapper: Wrapper },
    );

    await waitFor(() => expect(repoASignal).toBeDefined());
    expect(repoASignal?.aborted).toBe(false);
    rerender({ repoRoot: "/b" });
    await waitFor(() => {
      expect(repoASignal?.aborted).toBe(true);
      expect(result.current.notes[0]?.id).toBe("repo-b");
    });
  });

  it("aborts a pending initial request on unmount", async () => {
    let signal: AbortSignal | undefined;
    const requestRepoNotes = vi.fn((_paneId: string, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return new Promise<RepoNote[]>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    const { Wrapper } = createQueryWrapper();
    const { unmount } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("deduplicates a warm silent refresh without turning on interactive loading", async () => {
    const pending = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote()])
      .mockImplementationOnce(() => pending.promise);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(requestRepoNotes).toHaveBeenCalledTimes(2));
    expect(result.current.notesLoading).toBe(false);
    act(() => result.current.refreshNotes({ silent: true }));
    expect(requestRepoNotes).toHaveBeenCalledTimes(2);

    act(() => pending.resolve([buildNote({ id: "refreshed" })]));
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("refreshed"));
    expect(result.current.notesLoading).toBe(false);
  });

  it("aborts a pending silent polling request on unmount", async () => {
    let pollingSignal: AbortSignal | undefined;
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote()])
      .mockImplementationOnce((_paneId: string, signal?: AbortSignal) => {
        pollingSignal = signal;
        return new Promise<RepoNote[]>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      });
    const { Wrapper } = createQueryWrapper();
    const { result, unmount } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(pollingSignal).toBeDefined());
    expect(pollingSignal?.aborted).toBe(false);

    unmount();
    expect(pollingSignal?.aborted).toBe(true);
  });

  it("does not restore stale interactive state after A to B to A", async () => {
    const cancelGate = createDeferred<void>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote({ id: "repo-a", repoRoot: "/a" })])
      .mockResolvedValueOnce([buildNote({ id: "repo-b", repoRoot: "/b" })])
      .mockRejectedValueOnce(new Error("repo A revisit failed"));
    const { queryClient, Wrapper } = createQueryWrapper();
    vi.spyOn(queryClient, "cancelQueries").mockImplementationOnce(() => cancelGate.promise);
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { initialProps: { repoRoot: "/a" }, wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("repo-a"));
    act(() => result.current.refreshNotes());
    expect(result.current.notesLoading).toBe(true);

    rerender({ repoRoot: "/b" });
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("repo-b"));
    rerender({ repoRoot: "/a" });
    await waitFor(() => {
      expect(result.current.notesLoading).toBe(false);
      expect(result.current.notesError).toBe("repo A revisit failed");
    });

    act(() => cancelGate.resolve());
    await act(async () => Promise.resolve());
    expect(result.current.notesLoading).toBe(false);
    expect(result.current.notesError).toBe("repo A revisit failed");
  });

  it("keeps an automatic retry error visible and hides it only for an interactive retry", async () => {
    const automaticRetry = createDeferred<RepoNote[]>();
    const interactiveRetry = createDeferred<RepoNote[]>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote()])
      .mockRejectedValueOnce(new Error("list failed"))
      .mockImplementationOnce(() => automaticRetry.promise)
      .mockRejectedValueOnce(new Error("list failed again"))
      .mockImplementationOnce(() => interactiveRetry.promise);
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...createDefaultActions(),
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(result.current.notesError).toBe("list failed"));
    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(requestRepoNotes).toHaveBeenCalledTimes(3));
    expect(result.current.notesError).toBe("list failed");
    expect(result.current.notesLoading).toBe(false);
    act(() => automaticRetry.resolve([buildNote({ id: "automatic" })]));
    await waitFor(() => expect(result.current.notesError).toBeNull());

    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(result.current.notesError).toBe("list failed again"));
    act(() => result.current.refreshNotes());
    await waitFor(() => {
      expect(requestRepoNotes).toHaveBeenCalledTimes(5);
      expect(result.current.notesError).toBeNull();
      expect(result.current.notesLoading).toBe(true);
    });
    act(() => interactiveRetry.resolve([buildNote({ id: "interactive" })]));
    await waitFor(() => {
      expect(result.current.notesError).toBeNull();
      expect(result.current.notesLoading).toBe(false);
      expect(result.current.notes[0]?.id).toBe("interactive");
    });
  });

  it("applies create, save, and delete responses to the sorted cache after two cancels", async () => {
    const old = buildNote({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" });
    const created = buildNote({ id: "created", updatedAt: "2026-01-03T00:00:00.000Z" });
    const updated = buildNote({
      id: "old",
      body: "updated",
      updatedAt: "2026-01-04T00:00:00.000Z",
    });
    const requestRepoNotes = vi.fn(async () => [old]);
    const actions = {
      createRepoNote: vi.fn(async () => created),
      updateRepoNote: vi.fn(async () => updated),
      deleteRepoNote: vi.fn(async () => "created"),
    };
    const { queryClient, Wrapper } = createQueryWrapper();
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          ...actions,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("old"));

    await act(() => result.current.createNote({ body: "created" }));
    expect(result.current.notes.map((note) => note.id)).toEqual(["created", "old"]);
    await act(() => result.current.saveNote("old", { body: "updated" }));
    expect(result.current.notes.map((note) => note.id)).toEqual(["old", "created"]);
    await act(() => result.current.removeNote("created"));
    expect(result.current.notes).toEqual([updated]);
    expect(cancelSpy).toHaveBeenCalledTimes(6);
  });

  it("tracks concurrent create, save, and delete operations independently", async () => {
    const createPending = createDeferred<RepoNote>();
    const savePending = createDeferred<RepoNote>();
    const deletePending = createDeferred<string>();
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes: vi.fn(async () => [buildNote()]),
          createRepoNote: vi.fn(() => createPending.promise),
          updateRepoNote: vi.fn(() => savePending.promise),
          deleteRepoNote: vi.fn(() => deletePending.promise),
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    let createResult!: Promise<RepoNote | null>;
    let saveResult!: Promise<boolean>;
    let deleteResult!: Promise<boolean>;
    act(() => {
      createResult = result.current.createNote({ body: "created" });
      saveResult = result.current.saveNote("note-1", { body: "saved" });
      deleteResult = result.current.removeNote("note-1");
    });
    await waitFor(() => {
      expect(result.current.creatingNote).toBe(true);
      expect(result.current.savingNoteId).toBe("note-1");
      expect(result.current.deletingNoteId).toBe("note-1");
    });

    act(() => {
      createPending.resolve(buildNote({ id: "created" }));
      savePending.resolve(buildNote({ id: "note-1", body: "saved" }));
      deletePending.resolve("note-1");
    });
    await expect(Promise.all([createResult, saveResult, deleteResult])).resolves.toEqual([
      expect.objectContaining({ id: "created" }),
      true,
      true,
    ]);
    await waitFor(() => {
      expect(result.current.creatingNote).toBe(false);
      expect(result.current.savingNoteId).toBeNull();
      expect(result.current.deletingNoteId).toBeNull();
    });
  });

  it("does not let an older list response overwrite a completed note update", async () => {
    const initial = buildNote({ body: "initial" });
    const staleList = createDeferred<RepoNote[]>();
    let staleSignal: AbortSignal | undefined;
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([initial])
      .mockImplementationOnce((_paneId: string, signal?: AbortSignal) => {
        staleSignal = signal;
        return staleList.promise;
      });
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          createRepoNote: vi.fn(async () => buildNote()),
          updateRepoNote: vi.fn(async () => buildNote({ body: "updated" })),
          deleteRepoNote: vi.fn(async () => "note-1"),
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes[0]?.body).toBe("initial"));
    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(requestRepoNotes).toHaveBeenCalledTimes(2));

    await act(() => result.current.saveNote("note-1", { body: "updated" }));
    expect(staleSignal?.aborted).toBe(true);
    act(() => staleList.resolve([initial]));
    await act(async () => Promise.resolve());
    expect(result.current.notes[0]?.body).toBe("updated");
  });

  it("keeps old-scope mutation completions out after A to B to A", async () => {
    const staleCreate = createDeferred<RepoNote>();
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote({ id: "a" })])
      .mockResolvedValueOnce([buildNote({ id: "b", repoRoot: "/b" })])
      .mockResolvedValueOnce([buildNote({ id: "a-revisit" })]);
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ repoRoot }) =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot,
          connected: true,
          requestRepoNotes,
          createRepoNote: vi.fn(() => staleCreate.promise),
          updateRepoNote: vi.fn(async () => buildNote()),
          deleteRepoNote: vi.fn(async () => "note-1"),
        }),
      { initialProps: { repoRoot: "/a" }, wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("a"));
    let createResult!: Promise<RepoNote | null>;
    act(() => {
      createResult = result.current.createNote({ body: "stale" });
    });
    await waitFor(() => expect(result.current.creatingNote).toBe(true));

    rerender({ repoRoot: "/b" });
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("b"));
    rerender({ repoRoot: "/a" });
    await waitFor(() => expect(result.current.notes[0]?.id).toBe("a-revisit"));
    act(() => staleCreate.resolve(buildNote({ id: "stale" })));

    await expect(createResult).resolves.toBeNull();
    expect(result.current.notes[0]?.id).toBe("a-revisit");
    expect(result.current.creatingNote).toBe(false);
  });

  it("keeps list data on failure and gives a mutation error precedence", async () => {
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote()])
      .mockRejectedValueOnce(new Error("list failed"));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          createRepoNote: vi.fn().mockRejectedValue(new Error("create failed")),
          updateRepoNote: vi.fn(async () => buildNote()),
          deleteRepoNote: vi.fn(async () => "note-1"),
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => expect(result.current.notesError).toBe("list failed"));
    expect(result.current.notes).toHaveLength(1);

    await act(() => result.current.createNote({ body: "fail" }));
    expect(result.current.notesError).toBe("create failed");
    expect(result.current.notes).toHaveLength(1);
  });

  it("clears a mutation error only after a newer manual or silent list success", async () => {
    const requestRepoNotes = vi
      .fn()
      .mockResolvedValueOnce([buildNote()])
      .mockResolvedValueOnce([buildNote({ id: "manual" })])
      .mockResolvedValueOnce([buildNote({ id: "silent" })]);
    const createRepoNote = vi.fn().mockRejectedValue(new Error("create failed"));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useSessionRepoNotes({
          paneId: "pane-1",
          repoRoot: "/repo",
          connected: true,
          requestRepoNotes,
          createRepoNote,
          updateRepoNote: vi.fn(async () => buildNote()),
          deleteRepoNote: vi.fn(async () => "note-1"),
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    await act(() => result.current.createNote({ body: "fail" }));
    expect(result.current.notesError).toBe("create failed");
    act(() => result.current.refreshNotes());
    await waitFor(() => {
      expect(result.current.notes[0]?.id).toBe("manual");
      expect(result.current.notesError).toBeNull();
    });

    await act(() => result.current.createNote({ body: "fail again" }));
    expect(result.current.notesError).toBe("create failed");
    act(() => result.current.refreshNotes({ silent: true }));
    await waitFor(() => {
      expect(result.current.notes[0]?.id).toBe("silent");
      expect(result.current.notesError).toBeNull();
    });
  });
});
