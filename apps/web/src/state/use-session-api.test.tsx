import { renderHook, waitFor } from "@testing-library/react";
import type { CommitLog, DiffSummary, RepoNote, SessionStateTimeline } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { HttpResponse, http, server } from "@/test/msw/server";

import { useSessionApi } from "./use-session-api";

const API_BASE_URL = "http://127.0.0.1:11081/api";

const pathToUrl = (path: string) => `${API_BASE_URL}${path}`;

const createDeferred = <T = void,>() => {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
};

describe("useSessionApi", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses apiBaseUrl when provided", async () => {
    let requestedAuthorization: string | null = null;
    server.use(
      http.get(pathToUrl("/sessions"), ({ request }) => {
        requestedAuthorization = request.headers.get("authorization");
        return HttpResponse.json({ sessions: [] });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.refreshSessions()).resolves.toMatchObject({ ok: true });
    expect(requestedAuthorization).toBe("Bearer token");
  });

  it("forwards read cancellation to fetch without reporting a connection issue", async () => {
    const requestStarted = createDeferred<void>();
    const onConnectionIssue = vi.fn();
    let receivedSignal: AbortSignal | null = null;
    server.use(
      http.get(pathToUrl("/sessions/:paneId/branches"), async ({ request }) => {
        receivedSignal = request.signal;
        requestStarted.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return HttpResponse.json({ branches: { entries: [] } });
      }),
    );
    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );
    const controller = new AbortController();

    const request = result.current.branches.requestBranches("pane-1", undefined, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await requestStarted.promise;
    controller.abort();

    await assertion;
    expect((receivedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(onConnectionIssue).not.toHaveBeenCalled();
  });

  it("dedupes in-flight screen requests", async () => {
    const deferred = createDeferred<void>();
    let requestCount = 0;
    server.use(
      http.post(pathToUrl("/sessions/:paneId/screen"), async () => {
        requestCount += 1;
        await deferred.promise;
        return HttpResponse.json({
          screen: {
            ok: true,
            paneId: "pane-1",
            mode: "text",
            capturedAt: new Date(0).toISOString(),
            screen: "ok",
          },
        });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    const promise1 = result.current.core.requestScreen("pane-1", { mode: "text" });
    const promise2 = result.current.core.requestScreen("pane-1", { mode: "text" });

    await waitFor(() => {
      expect(requestCount).toBe(1);
    });

    deferred.resolve();

    await expect(promise1).resolves.toMatchObject({ ok: true, paneId: "pane-1" });
    await expect(promise2).resolves.toMatchObject({ ok: true, paneId: "pane-1" });
  });

  it("updates connectionIssue on diff summary errors and clears on success", async () => {
    const onConnectionIssue = vi.fn();
    const summary: DiffSummary = {
      repoRoot: "/repo",
      rev: "main",
      generatedAt: new Date(0).toISOString(),
      files: [],
    };
    let requestCount = 0;
    server.use(
      http.get(pathToUrl("/sessions/:paneId/diff"), () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            { error: { code: "INTERNAL", message: "boom" } },
            { status: 500 },
          );
        }
        return HttpResponse.json({ summary });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(
      result.current.branches.requestDiffSummary("pane-1", { mode: "total" }),
    ).rejects.toThrow("boom");
    expect(onConnectionIssue).toHaveBeenCalledWith("boom");

    await expect(
      result.current.branches.requestDiffSummary("pane-1", { mode: "total" }),
    ).resolves.toEqual(summary);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("loads state timeline and clears connection issue", async () => {
    const onConnectionIssue = vi.fn();
    const timeline: SessionStateTimeline = {
      paneId: "pane-1",
      now: new Date(0).toISOString(),
      range: "15m",
      items: [],
      totalsMs: {
        RUNNING: 1000,
        DONE: 0,
        WAITING_INPUT: 0,
        WAITING_PERMISSION: 0,
        SHELL: 0,
        UNKNOWN: 0,
      },
      current: null,
    };
    server.use(
      http.get(pathToUrl("/sessions/:paneId/timeline"), () => {
        return HttpResponse.json({ timeline });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(
      result.current.core.requestStateTimeline("pane-1", { range: "15m", limit: 50 }),
    ).resolves.toEqual(timeline);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("loads repository notes and handles note mutations", async () => {
    const onConnectionIssue = vi.fn();
    const notes: RepoNote[] = [
      {
        id: "note-1",
        repoRoot: "/repo",
        title: "todo",
        body: "write tests",
        createdAt: "2026-02-10T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
    ];

    server.use(
      http.get(pathToUrl("/sessions/:paneId/notes"), () =>
        HttpResponse.json({ repoRoot: "/repo", notes }),
      ),
      http.post(pathToUrl("/sessions/:paneId/notes"), async ({ request }) => {
        const payload = (await request.json()) as { title?: string | null; body: string };
        return HttpResponse.json({
          note: {
            ...notes[0],
            id: "note-2",
            title: payload.title ?? null,
            body: payload.body,
          },
        });
      }),
      http.put(pathToUrl("/sessions/:paneId/notes/:noteId"), async ({ request, params }) => {
        const payload = (await request.json()) as { title?: string | null; body: string };
        return HttpResponse.json({
          note: {
            ...notes[0],
            id: String(params.noteId),
            title: payload.title ?? null,
            body: payload.body,
          },
        });
      }),
      http.delete(pathToUrl("/sessions/:paneId/notes/:noteId"), ({ params }) => {
        return HttpResponse.json({ noteId: String(params.noteId) });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.notes.requestRepoNotes("pane-1")).resolves.toEqual(notes);
    await expect(
      result.current.notes.createRepoNote("pane-1", { title: "new", body: "memo" }),
    ).resolves.toMatchObject({ id: "note-2", title: "new", body: "memo" });
    await expect(
      result.current.notes.updateRepoNote("pane-1", "note-1", { title: null, body: "updated" }),
    ).resolves.toMatchObject({ id: "note-1", title: null, body: "updated" });
    await expect(result.current.notes.deleteRepoNote("pane-1", "note-1")).resolves.toBe("note-1");
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("updates connectionIssue on commit log errors and clears on success", async () => {
    const onConnectionIssue = vi.fn();
    const log: CommitLog = {
      repoRoot: "/repo",
      rev: "main",
      generatedAt: new Date(0).toISOString(),
      commits: [],
    };
    let requestCount = 0;
    server.use(
      http.get(pathToUrl("/sessions/:paneId/commits"), () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json(
            { error: { code: "INTERNAL", message: "bad" } },
            { status: 502 },
          );
        }
        return HttpResponse.json({ log });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.branches.requestCommitLog("pane-1")).rejects.toThrow("bad");
    expect(onConnectionIssue).toHaveBeenCalledWith("bad");

    await expect(result.current.branches.requestCommitLog("pane-1")).resolves.toEqual(log);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("does not remove session when commit detail is missing", async () => {
    const onSessionRemoved = vi.fn();
    server.use(
      http.get(pathToUrl("/sessions/:paneId/commits/:hash"), () => {
        return HttpResponse.json(
          { error: { code: "NOT_FOUND", message: "commit not found" } },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved,
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.branches.requestCommitDetail("pane-1", "hash")).rejects.toThrow(
      "commit not found",
    );
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("removes session when pane is invalid", async () => {
    const onSessionRemoved = vi.fn();
    server.use(
      http.get(pathToUrl("/sessions/:paneId/commits/:hash"), () => {
        return HttpResponse.json(
          { error: { code: "INVALID_PANE", message: "pane not found" } },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved,
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.branches.requestCommitDetail("pane-1", "hash")).rejects.toThrow(
      "pane not found",
    );
    expect(onSessionRemoved).toHaveBeenCalledWith("pane-1");
  });

  it("removes session when diff summary endpoint returns 410", async () => {
    const onSessionRemoved = vi.fn();
    server.use(
      http.get(pathToUrl("/sessions/:paneId/diff"), () => {
        return new HttpResponse(null, { status: 410 });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved,
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(
      result.current.branches.requestDiffSummary("pane-1", { mode: "total" }),
    ).rejects.toThrow(`${API_ERROR_MESSAGES.diffSummary} (410)`);
    expect(onSessionRemoved).toHaveBeenCalledWith("pane-1");
  });

  it("refreshes sessions when touch response has no session payload", async () => {
    const onSessions = vi.fn();
    const onSessionUpdated = vi.fn();
    server.use(
      http.post(pathToUrl("/sessions/:paneId/touch"), () => {
        return HttpResponse.json({});
      }),
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.json({ sessions: [] });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions,
        onConnectionIssue: vi.fn(),
        onSessionUpdated,
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.touchSession("pane-1")).resolves.toBeUndefined();
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(onSessions).toHaveBeenCalledWith([]);
  });

  it("refreshes sessions when move-to-top response has no session payload", async () => {
    const onSessions = vi.fn();
    const onSessionUpdated = vi.fn();
    server.use(
      http.post(pathToUrl("/sessions/:paneId/move-to-top"), () => {
        return HttpResponse.json({});
      }),
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.json({ sessions: [] });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions,
        onConnectionIssue: vi.fn(),
        onSessionUpdated,
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.moveSessionToTop("pane-1")).resolves.toBeUndefined();
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(onSessions).toHaveBeenCalledWith([]);
  });

  it("refreshes sessions when title update response has no session payload", async () => {
    const onSessions = vi.fn();
    const onSessionUpdated = vi.fn();
    server.use(
      http.put(pathToUrl("/sessions/:paneId/title"), () => {
        return HttpResponse.json({});
      }),
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.json({ sessions: [] });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions,
        onConnectionIssue: vi.fn(),
        onSessionUpdated,
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.updateSessionTitle("pane-1", "next")).resolves.toBeUndefined();
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(onSessions).toHaveBeenCalledWith([]);
  });

  it("refreshes sessions when title reset response has no session payload", async () => {
    const onSessions = vi.fn();
    const onSessionUpdated = vi.fn();
    server.use(
      http.post(pathToUrl("/sessions/:paneId/title/reset"), () => {
        return HttpResponse.json({});
      }),
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.json({ sessions: [] });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions,
        onConnectionIssue: vi.fn(),
        onSessionUpdated,
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.resetSessionTitle("pane-1")).resolves.toBeUndefined();
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(onSessions).toHaveBeenCalledWith([]);
  });

  it("sends text command successfully", async () => {
    const onConnectionIssue = vi.fn();
    let payload: unknown = null;
    server.use(
      http.post(pathToUrl("/sessions/:paneId/send/text"), async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ command: { ok: true } });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.sendText("pane-1", "echo hello")).resolves.toEqual({
      ok: true,
    });
    expect(payload).toMatchObject({ text: "echo hello", enter: true });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("returns command response when focus endpoint returns logical error", async () => {
    const onConnectionIssue = vi.fn();
    server.use(
      http.post(pathToUrl("/sessions/:paneId/focus"), () => {
        return HttpResponse.json({
          command: {
            ok: false,
            error: { code: "RATE_LIMIT", message: "rate limited" },
          },
        });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.focusPane("pane-1")).resolves.toMatchObject({
      ok: false,
      error: { code: "RATE_LIMIT", message: "rate limited" },
    });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("sends kill pane command successfully", async () => {
    const onConnectionIssue = vi.fn();
    server.use(
      http.post(pathToUrl("/sessions/:paneId/kill/pane"), () => {
        return HttpResponse.json({ command: { ok: true } });
      }),
    );

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        apiBaseUrl: API_BASE_URL,
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
        onFileNavigatorConfig: vi.fn(),
      }),
    );

    await expect(result.current.core.killPane("pane-1")).resolves.toEqual({ ok: true });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });
});
