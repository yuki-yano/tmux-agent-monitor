// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import type { CommitLog, DiffSummary, SessionStateTimeline } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { requestJson } from "@/lib/api-utils";

import { useSessionApi } from "./use-session-api";

const mockPost = vi.fn(() => Promise.resolve(new Response()));
const mockGet = vi.fn(() => Promise.resolve(new Response()));
const mockPut = vi.fn(() => Promise.resolve(new Response()));
const mockApiClient = {
  sessions: {
    $get: mockGet,
    ":paneId": {
      screen: { $post: mockPost },
      focus: { $post: mockPost },
      attachments: { image: { $post: mockPost } },
      title: { $put: mockPut },
      touch: { $post: mockPost },
      diff: {
        $get: mockGet,
        file: { $get: mockGet },
      },
      commits: {
        $get: mockGet,
        ":hash": { $get: mockGet, file: { $get: mockGet } },
      },
      timeline: { $get: mockGet },
    },
  },
};

vi.mock("hono/client", () => ({
  hc: () => mockApiClient,
}));

vi.mock("@/lib/api-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-utils")>("@/lib/api-utils");
  return {
    ...actual,
    requestJson: vi.fn(),
  };
});

describe("useSessionApi", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("dedupes in-flight screen requests", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    let resolveRequest: ((value: { res: Response; data: unknown }) => void) | undefined;
    const deferred = new Promise<{ res: Response; data: unknown }>((resolve) => {
      resolveRequest = resolve;
    });
    requestJsonMock.mockReturnValue(deferred as Promise<never>);

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    const promise1 = result.current.requestScreen("pane-1", { mode: "text" });
    const promise2 = result.current.requestScreen("pane-1", { mode: "text" });

    expect(requestJsonMock).toHaveBeenCalledTimes(1);

    resolveRequest?.({
      res: new Response(null, { status: 200 }),
      data: {
        screen: {
          ok: true,
          paneId: "pane-1",
          mode: "text",
          capturedAt: new Date(0).toISOString(),
          screen: "ok",
        },
      },
    });

    await expect(promise1).resolves.toMatchObject({ ok: true, paneId: "pane-1" });
    await expect(promise2).resolves.toMatchObject({ ok: true, paneId: "pane-1" });
  });

  it("updates connectionIssue on diff summary errors and clears on success", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    const summary: DiffSummary = {
      repoRoot: "/repo",
      rev: "main",
      generatedAt: new Date(0).toISOString(),
      files: [],
    };
    requestJsonMock
      .mockResolvedValueOnce({
        res: new Response(null, { status: 500 }),
        data: { error: { code: "INTERNAL", message: "boom" } },
      })
      .mockResolvedValueOnce({
        res: new Response(null, { status: 200 }),
        data: { summary },
      });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.requestDiffSummary("pane-1")).rejects.toThrow("boom");
    expect(onConnectionIssue).toHaveBeenCalledWith("boom");

    await expect(result.current.requestDiffSummary("pane-1")).resolves.toEqual(summary);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("loads state timeline and clears connection issue", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    const timeline: SessionStateTimeline = {
      paneId: "pane-1",
      now: new Date(0).toISOString(),
      range: "15m",
      items: [],
      totalsMs: {
        RUNNING: 1000,
        WAITING_INPUT: 0,
        WAITING_PERMISSION: 0,
        SHELL: 0,
        UNKNOWN: 0,
      },
      current: null,
    };
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 200 }),
      data: { timeline },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(
      result.current.requestStateTimeline("pane-1", { range: "15m", limit: 50 }),
    ).resolves.toEqual(timeline);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("updates connectionIssue on commit log errors and clears on success", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    const log: CommitLog = {
      repoRoot: "/repo",
      rev: "main",
      generatedAt: new Date(0).toISOString(),
      commits: [],
    };
    requestJsonMock
      .mockResolvedValueOnce({
        res: new Response(null, { status: 502 }),
        data: { error: { code: "INTERNAL", message: "bad" } },
      })
      .mockResolvedValueOnce({
        res: new Response(null, { status: 200 }),
        data: { log },
      });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.requestCommitLog("pane-1")).rejects.toThrow("bad");
    expect(onConnectionIssue).toHaveBeenCalledWith("bad");

    await expect(result.current.requestCommitLog("pane-1")).resolves.toEqual(log);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("does not remove session when commit detail is missing", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onSessionRemoved = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 404 }),
      data: { error: { code: "NOT_FOUND", message: "commit not found" } },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved,
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.requestCommitDetail("pane-1", "hash")).rejects.toThrow(
      "commit not found",
    );
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("removes session when pane is invalid", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onSessionRemoved = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 404 }),
      data: { error: { code: "INVALID_PANE", message: "pane not found" } },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved,
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.requestCommitDetail("pane-1", "hash")).rejects.toThrow(
      "pane not found",
    );
    expect(onSessionRemoved).toHaveBeenCalledWith("pane-1");
  });

  it("removes session when diff summary endpoint returns 410", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onSessionRemoved = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 410 }),
      data: null,
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue: vi.fn(),
        onSessionUpdated: vi.fn(),
        onSessionRemoved,
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.requestDiffSummary("pane-1")).rejects.toThrow(
      `${API_ERROR_MESSAGES.diffSummary} (410)`,
    );
    expect(onSessionRemoved).toHaveBeenCalledWith("pane-1");
  });

  it("refreshes sessions when touch response has no session payload", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onSessions = vi.fn();
    const onSessionUpdated = vi.fn();
    requestJsonMock
      .mockResolvedValueOnce({
        res: new Response(null, { status: 200 }),
        data: {},
      })
      .mockResolvedValueOnce({
        res: new Response(null, { status: 200 }),
        data: { sessions: [] },
      });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions,
        onConnectionIssue: vi.fn(),
        onSessionUpdated,
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.touchSession("pane-1")).resolves.toBeUndefined();
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(onSessions).toHaveBeenCalledWith([]);
  });

  it("refreshes sessions when title update response has no session payload", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onSessions = vi.fn();
    const onSessionUpdated = vi.fn();
    requestJsonMock
      .mockResolvedValueOnce({
        res: new Response(null, { status: 200 }),
        data: {},
      })
      .mockResolvedValueOnce({
        res: new Response(null, { status: 200 }),
        data: { sessions: [] },
      });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions,
        onConnectionIssue: vi.fn(),
        onSessionUpdated,
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.updateSessionTitle("pane-1", "next")).resolves.toBeUndefined();
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(onSessions).toHaveBeenCalledWith([]);
  });

  it("uploads image attachment and clears connection issue on success", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 200 }),
      data: {
        attachment: {
          path: "/tmp/vde-monitor/attachments/%251/mobile-20260206-000000-abcd1234.png",
          mimeType: "image/png",
          size: 3,
          createdAt: "2026-02-06T00:00:00.000Z",
          insertText: "/tmp/vde-monitor/attachments/%251/mobile-20260206-000000-abcd1234.png ",
        },
      },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    const file = new File([new Uint8Array([1, 2, 3])], "sample.png", { type: "image/png" });
    await expect(result.current.uploadImageAttachment("pane-1", file)).resolves.toMatchObject({
      mimeType: "image/png",
      size: 3,
    });
    expect(mockPost).toHaveBeenCalledWith({ param: { paneId: "pane-1" }, form: { image: file } });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("throws upload errors and reports connection issue", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 400 }),
      data: {
        error: {
          code: "INVALID_PAYLOAD",
          message: "unsupported image MIME type",
        },
      },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    const file = new File([new Uint8Array([1, 2, 3])], "sample.gif", { type: "image/gif" });
    await expect(result.current.uploadImageAttachment("pane-1", file)).rejects.toThrow(
      "unsupported image MIME type",
    );
    expect(onConnectionIssue).toHaveBeenCalledWith("unsupported image MIME type");
  });

  it("throws invalid response when upload attachment payload does not match schema", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 200 }),
      data: {
        attachment: {
          path: "/tmp/vde-monitor/attachments/%251/mobile-20260206-000000-abcd1234.png",
          mimeType: "image/png",
          size: 0,
          createdAt: "2026-02-06T00:00:00.000Z",
          insertText: "/tmp/vde-monitor/attachments/%251/mobile-20260206-000000-abcd1234.png ",
        },
      },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    const file = new File([new Uint8Array([1, 2, 3])], "sample.png", { type: "image/png" });
    await expect(result.current.uploadImageAttachment("pane-1", file)).rejects.toThrow(
      API_ERROR_MESSAGES.invalidResponse,
    );
    expect(onConnectionIssue).toHaveBeenCalledWith(API_ERROR_MESSAGES.invalidResponse);
  });

  it("focuses pane and clears connection issue on success", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 200 }),
      data: { command: { ok: true } },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.focusPane("pane-1")).resolves.toEqual({ ok: true });
    expect(mockPost).toHaveBeenCalledWith({ param: { paneId: "pane-1" } });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("returns command response when focus endpoint returns logical error", async () => {
    const requestJsonMock = vi.mocked(requestJson);
    const onConnectionIssue = vi.fn();
    requestJsonMock.mockResolvedValueOnce({
      res: new Response(null, { status: 200 }),
      data: {
        command: {
          ok: false,
          error: { code: "RATE_LIMIT", message: "rate limited" },
        },
      },
    });

    const { result } = renderHook(() =>
      useSessionApi({
        token: "token",
        onSessions: vi.fn(),
        onConnectionIssue,
        onSessionUpdated: vi.fn(),
        onSessionRemoved: vi.fn(),
        onHighlightCorrections: vi.fn(),
      }),
    );

    await expect(result.current.focusPane("pane-1")).resolves.toMatchObject({
      ok: false,
      error: { code: "RATE_LIMIT", message: "rate limited" },
    });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });
});
