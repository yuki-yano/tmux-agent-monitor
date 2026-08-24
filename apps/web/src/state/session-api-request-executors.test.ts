import type { SessionSummary } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";
import { HttpResponse, http, server } from "@/test/msw/server";

import {
  mutateSession,
  refreshSessions,
  requestCommand,
  requestImageAttachment,
  requestLaunchCommand,
  requestScreenResponse,
  requestSessionField,
} from "./session-api-request-executors";

const API_BASE_URL = "http://127.0.0.1:11081/api";

const pathToUrl = (path: string) => `${API_BASE_URL}${path}`;

const getRequest = (path: string) => fetch(pathToUrl(path));

const postRequest = (path: string, body?: unknown) =>
  fetch(pathToUrl(path), {
    method: "POST",
    headers: body == null ? undefined : { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });

const postRequestWithSignal = (path: string) => (signal?: AbortSignal) =>
  fetch(pathToUrl(path), {
    method: "POST",
    signal,
  });

const createSession = (
  paneId: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
  paneId,
  sessionId: "session-id-1",
  sessionName: "session",
  windowId: "window-id-1",
  windowIndex: 0,
  paneIndex: 0,
  paneActive: true,
  currentCommand: null,
  currentPath: null,
  paneTty: null,
  title: null,
  customTitle: null,
  repoRoot: null,
  agent: "codex",
  state: "RUNNING",
  stateReason: "reason",
  lastMessage: null,
  lastOutputAt: null,
  lastEventAt: null,
  lastInputAt: null,
  lastRunStartedAt: null,
  manualSortAt: null,
  paneDead: false,
  alternateOn: false,
  pipeAttached: false,
  pipeConflict: false,
  completion: null,
  ...overrides,
});

const setupNetworkErrorRoute = (path: string) => {
  server.use(
    http.post(pathToUrl(path), () => {
      return HttpResponse.error();
    }),
  );
};

const expectInternalError = (
  response: { ok: boolean; error?: { code: string; message: string } },
  mocks: {
    onConnectionIssue: ReturnType<typeof vi.fn>;
    handleSessionMissing: ReturnType<typeof vi.fn>;
    onSessionRemoved: ReturnType<typeof vi.fn>;
  },
) => {
  expect(response.ok).toBe(false);
  expect(response.error?.code).toBe("INTERNAL");
  expect(response.error?.message).toEqual(expect.any(String));
  expect(mocks.onConnectionIssue).toHaveBeenCalledWith(response.error?.message);
  expect(mocks.handleSessionMissing).not.toHaveBeenCalled();
  expect(mocks.onSessionRemoved).not.toHaveBeenCalled();
};

describe("session-api-request-executors", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("requestSessionField returns requested field on success", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    server.use(
      http.get(pathToUrl("/tests/session-field-success"), () => {
        return HttpResponse.json({ summary: { rev: "main" } });
      }),
    );

    const summary = await requestSessionField<{ summary?: { rev: string } }, "summary">({
      paneId: "pane-1",
      request: getRequest("/tests/session-field-success"),
      field: "summary",
      fallbackMessage: "failed",
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
    });

    expect(summary).toEqual({ rev: "main" });
    expect(ensureToken).toHaveBeenCalledTimes(1);
    expect(handleSessionMissing).not.toHaveBeenCalled();
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("requestSessionField propagates API errors and marks missing panes", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    server.use(
      http.get(pathToUrl("/tests/session-field-error"), () => {
        return HttpResponse.json(
          { error: { code: "INVALID_PANE", message: "pane not found" } },
          { status: 404 },
        );
      }),
    );

    await expect(
      requestSessionField<{ summary?: { rev: string } }, "summary">({
        paneId: "pane-1",
        request: getRequest("/tests/session-field-error"),
        field: "summary",
        fallbackMessage: "failed",
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
        includeStatus: true,
      }),
    ).rejects.toThrow("pane not found");

    expect(handleSessionMissing).toHaveBeenCalledTimes(1);
    expect(onConnectionIssue).toHaveBeenCalledWith("pane not found");
  });

  it("does not report query cancellation as a connection issue", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const abortError = new DOMException("Aborted", "AbortError");

    await expect(
      requestSessionField<{ summary?: { rev: string } }, "summary">({
        paneId: "pane-1",
        request: Promise.reject(abortError),
        field: "summary",
        fallbackMessage: "failed",
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
      }),
    ).rejects.toBe(abortError);

    expect(ensureToken).toHaveBeenCalledTimes(1);
    expect(onConnectionIssue).not.toHaveBeenCalled();
    expect(handleSessionMissing).not.toHaveBeenCalled();
  });

  it("mutateSession updates session when payload contains session", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionUpdated = vi.fn();
    const refreshSessionsMock = vi.fn(async () => ({ ok: true }));
    const session = createSession("pane-1", { title: "updated" });
    server.use(
      http.post(pathToUrl("/tests/mutate-session-success"), () => {
        return HttpResponse.json({ session });
      }),
    );

    const updated = await mutateSession({
      paneId: "pane-1",
      request: postRequest("/tests/mutate-session-success"),
      fallbackMessage: "failed",
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
      onSessionUpdated,
      refreshSessions: refreshSessionsMock,
    });

    expect(updated).toEqual(session);
    expect(onSessionUpdated).toHaveBeenCalledWith(session);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
    expect(refreshSessionsMock).not.toHaveBeenCalled();
  });

  it("mutateSession refreshes sessions when payload omits session", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionUpdated = vi.fn();
    const refreshSessionsMock = vi.fn(async () => ({ ok: true }));
    server.use(
      http.post(pathToUrl("/tests/mutate-session-refresh"), () => {
        return HttpResponse.json({});
      }),
    );

    const updated = await mutateSession({
      paneId: "pane-1",
      request: postRequest("/tests/mutate-session-refresh"),
      fallbackMessage: "failed",
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
      onSessionUpdated,
      refreshSessions: refreshSessionsMock,
    });

    expect(updated).toBeNull();
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(refreshSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("requestCommand returns command payload and clears connection issue", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/command-success"), () => {
        return HttpResponse.json({ command: { ok: true } });
      }),
    );

    const response = await requestCommand({
      paneId: "pane-1",
      request: postRequestWithSignal("/tests/command-success"),
      fallbackMessage: "failed",
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
      buildApiError: (code, message) => ({ code, message }),
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
    });

    expect(response).toEqual({ ok: true });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
    expect(handleSessionMissing).not.toHaveBeenCalled();
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("requestCommand returns api error response when request fails", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/command-http-error"), () => {
        return HttpResponse.json(
          { error: { code: "INVALID_PANE", message: "pane not found" } },
          { status: 404 },
        );
      }),
    );

    const response = await requestCommand({
      paneId: "pane-1",
      request: postRequestWithSignal("/tests/command-http-error"),
      fallbackMessage: "failed",
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
      buildApiError: (code, message) => ({ code, message }),
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
    });

    expect(response).toEqual({
      ok: false,
      error: { code: "INVALID_PANE", message: "pane not found" },
    });
    expect(onConnectionIssue).toHaveBeenCalledWith("pane not found");
    expect(handleSessionMissing).toHaveBeenCalledTimes(1);
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("requestCommand handles thrown errors as INTERNAL", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    setupNetworkErrorRoute("/tests/command-network-error");

    const response = await requestCommand({
      paneId: "pane-1",
      request: postRequestWithSignal("/tests/command-network-error"),
      fallbackMessage: "failed",
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
      buildApiError: (code, message) => ({ code, message }),
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
    });

    expectInternalError(response, { onConnectionIssue, handleSessionMissing, onSessionRemoved });
  });

  it("requestLaunchCommand returns launch payload on success", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/launch-command-success"), () => {
        return HttpResponse.json({
          command: {
            ok: true,
            result: {
              sessionName: "dev-main",
              agent: "codex",
              windowId: "@42",
              windowIndex: 1,
              windowName: "codex-work",
              paneId: "%11",
              launchedCommand: "codex",
              resolvedOptions: [],
              verification: {
                status: "verified",
                observedCommand: "codex",
                attempts: 1,
              },
            },
            rollback: {
              attempted: false,
              ok: true,
            },
          },
        });
      }),
    );

    const response = await requestLaunchCommand({
      request: postRequestWithSignal("/tests/launch-command-success"),
      fallbackMessage: "launch failed",
      ensureToken,
      onConnectionIssue,
      buildApiError: (code, message) => ({ code, message }),
    });

    expect(response.ok).toBe(true);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
  });

  it("requestLaunchCommand returns INTERNAL response when request fails", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    setupNetworkErrorRoute("/tests/launch-command-network-error");

    const response = await requestLaunchCommand({
      request: postRequestWithSignal("/tests/launch-command-network-error"),
      fallbackMessage: "launch failed",
      ensureToken,
      onConnectionIssue,
      buildApiError: (code, message) => ({ code, message }),
    });

    expect(response.ok).toBe(false);
    if (response.ok) {
      return;
    }
    expect(response.error.code).toBe("INTERNAL");
    expect(response.rollback).toEqual({ attempted: false, ok: true });
  });

  it("requestScreenResponse returns screen payload on success", async () => {
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/screen-success"), () => {
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

    const response = await requestScreenResponse({
      paneId: "pane-1",
      mode: "text",
      request: () => postRequest("/tests/screen-success"),
      fallbackMessage: "screen failed",
      onConnectionIssue,
      handleSessionMissing,
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
      buildApiError: (code, message) => ({ code, message }),
    });

    expect(response).toMatchObject({ ok: true, paneId: "pane-1" });
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
    expect(handleSessionMissing).not.toHaveBeenCalled();
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("requestScreenResponse returns error screen on http errors", async () => {
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/screen-http-error"), () => {
        return HttpResponse.json(
          { error: { code: "RATE_LIMIT", message: "too many requests" } },
          { status: 429 },
        );
      }),
    );

    const response = await requestScreenResponse({
      paneId: "pane-1",
      mode: "image",
      request: () => postRequest("/tests/screen-http-error"),
      fallbackMessage: "screen failed",
      onConnectionIssue,
      handleSessionMissing,
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
      buildApiError: (code, message) => ({ code, message }),
    });

    expect(response.ok).toBe(false);
    expect(response.error).toEqual({ code: "RATE_LIMIT", message: "too many requests" });
    expect(onConnectionIssue).toHaveBeenCalledWith("too many requests");
    expect(handleSessionMissing).toHaveBeenCalledTimes(1);
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("requestScreenResponse returns INTERNAL screen on thrown errors", async () => {
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    setupNetworkErrorRoute("/tests/screen-network-error");

    const response = await requestScreenResponse({
      paneId: "pane-1",
      mode: "text",
      request: () => postRequest("/tests/screen-network-error"),
      fallbackMessage: "screen failed",
      onConnectionIssue,
      handleSessionMissing,
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
      buildApiError: (code, message) => ({ code, message }),
    });

    expectInternalError(response, { onConnectionIssue, handleSessionMissing, onSessionRemoved });
  });

  it("requestScreenResponse stops waiting after the screen request timeout", async () => {
    vi.useFakeTimers();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    const onSessionRemoved = vi.fn();
    const pendingRequest = new Promise<Response>(() => {});
    let requestSignal: AbortSignal | undefined;

    const responsePromise = requestScreenResponse({
      paneId: "pane-1",
      mode: "text",
      request: (signal) => {
        requestSignal = signal;
        return pendingRequest;
      },
      requestTimeoutMs: 1_000,
      fallbackMessage: "screen failed",
      onConnectionIssue,
      handleSessionMissing,
      isPaneMissingError: vi.fn(() => false),
      onSessionRemoved,
      buildApiError: (code, message) => ({ code, message }),
    });
    await vi.advanceTimersByTimeAsync(1_000);

    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INTERNAL", message: API_ERROR_MESSAGES.requestTimeout },
    });
    expect(onConnectionIssue).toHaveBeenCalledWith(API_ERROR_MESSAGES.requestTimeout);
    expect(requestSignal?.aborted).toBe(true);
    expect(handleSessionMissing).not.toHaveBeenCalled();
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it("requestImageAttachment returns parsed attachment payload", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/attachment-success"), () => {
        return HttpResponse.json({
          attachment: {
            path: "/tmp/vde-monitor/attachments/%251/mobile-20260208-000000-abcd1234.png",
            mimeType: "image/png",
            size: 3,
            createdAt: "2026-02-08T00:00:00.000Z",
            insertText: "/tmp/vde-monitor/attachments/%251/mobile-20260208-000000-abcd1234.png ",
          },
        });
      }),
    );

    const attachment = await requestImageAttachment({
      paneId: "pane-1",
      request: postRequest("/tests/attachment-success"),
      ensureToken,
      onConnectionIssue,
      handleSessionMissing,
    });

    expect(attachment).toMatchObject({ mimeType: "image/png", size: 3 });
    expect(ensureToken).toHaveBeenCalledTimes(1);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
    expect(handleSessionMissing).not.toHaveBeenCalled();
  });

  it("requestImageAttachment throws invalid response when schema validation fails", async () => {
    const ensureToken = vi.fn();
    const onConnectionIssue = vi.fn();
    const handleSessionMissing = vi.fn();
    server.use(
      http.post(pathToUrl("/tests/attachment-invalid-schema"), () => {
        return HttpResponse.json({
          attachment: {
            path: "/tmp/vde-monitor/attachments/%251/mobile-20260208-000000-abcd1234.png",
            mimeType: "image/png",
            size: 0,
            createdAt: "2026-02-08T00:00:00.000Z",
            insertText: "/tmp/vde-monitor/attachments/%251/mobile-20260208-000000-abcd1234.png ",
          },
        });
      }),
    );

    await expect(
      requestImageAttachment({
        paneId: "pane-1",
        request: postRequest("/tests/attachment-invalid-schema"),
        ensureToken,
        onConnectionIssue,
        handleSessionMissing,
      }),
    ).rejects.toThrow(API_ERROR_MESSAGES.invalidResponse);

    expect(onConnectionIssue).toHaveBeenCalledWith(API_ERROR_MESSAGES.invalidResponse);
    expect(handleSessionMissing).not.toHaveBeenCalled();
  });

  it("refreshSessions returns auth error without request when token is missing", async () => {
    const onSessions = vi.fn();
    const onConnectionIssue = vi.fn();
    const onHighlightCorrections = vi.fn();
    const onFileNavigatorConfig = vi.fn();

    const result = await refreshSessions({
      token: null,
      request: Promise.resolve(new Response(null, { status: 200 })),
      onSessions,
      onConnectionIssue,
      onHighlightCorrections,
      onFileNavigatorConfig,
    });

    expect(result).toEqual({ ok: false, authError: true });
    expect(onSessions).not.toHaveBeenCalled();
    expect(onConnectionIssue).not.toHaveBeenCalled();
    expect(onHighlightCorrections).not.toHaveBeenCalled();
    expect(onFileNavigatorConfig).not.toHaveBeenCalled();
  });

  it("refreshSessions applies sessions snapshot on success", async () => {
    const onSessions = vi.fn();
    const onConnectionIssue = vi.fn();
    const onHighlightCorrections = vi.fn();
    const onFileNavigatorConfig = vi.fn();
    const onCapabilities = vi.fn();
    const sessions = [createSession("pane-1")];
    server.use(
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.json({
          sessions,
          clientConfig: {
            capabilities: {
              screenImage: false,
              launchAgent: false,
              resumeAgent: false,
            },
            screen: { highlightCorrection: { codex: true, claude: true } },
            fileNavigator: { autoExpandMatchLimit: 100 },
            workspaceTabs: { displayMode: "all" },
            launch: { agents: { codex: { options: [] }, claude: { options: [] } } },
          },
        });
      }),
    );

    const result = await refreshSessions({
      token: "token",
      request: getRequest("/sessions"),
      onSessions,
      onConnectionIssue,
      onHighlightCorrections,
      onFileNavigatorConfig,
      onCapabilities,
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(onSessions).toHaveBeenCalledWith(sessions);
    expect(onConnectionIssue).toHaveBeenCalledWith(null);
    expect(onCapabilities).toHaveBeenCalledWith({
      screenImage: false,
      launchAgent: false,
      resumeAgent: false,
    });
  });

  it("refreshSessions marks auth failures from response status", async () => {
    const onSessions = vi.fn();
    const onConnectionIssue = vi.fn();
    const onHighlightCorrections = vi.fn();
    const onFileNavigatorConfig = vi.fn();
    server.use(
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.json(
          { error: { code: "INVALID_PAYLOAD", message: "unauthorized" } },
          { status: 401 },
        );
      }),
    );

    const result = await refreshSessions({
      token: "token",
      request: getRequest("/sessions"),
      onSessions,
      onConnectionIssue,
      onHighlightCorrections,
      onFileNavigatorConfig,
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      authError: true,
      rateLimited: false,
    });
    expect(onSessions).not.toHaveBeenCalled();
    expect(onConnectionIssue).toHaveBeenCalledWith(API_ERROR_MESSAGES.unauthorized);
    expect(onFileNavigatorConfig).not.toHaveBeenCalled();
  });

  it("refreshSessions reports network fallback error", async () => {
    const onSessions = vi.fn();
    const onConnectionIssue = vi.fn();
    const onHighlightCorrections = vi.fn();
    const onFileNavigatorConfig = vi.fn();
    server.use(
      http.get(pathToUrl("/sessions"), () => {
        return HttpResponse.error();
      }),
    );

    const result = await refreshSessions({
      token: "token",
      request: getRequest("/sessions"),
      onSessions,
      onConnectionIssue,
      onHighlightCorrections,
      onFileNavigatorConfig,
    });

    expect(result).toEqual({ ok: false });
    expect(onSessions).not.toHaveBeenCalled();
    expect(onConnectionIssue).toHaveBeenCalledWith(expect.any(String));
    expect(onFileNavigatorConfig).not.toHaveBeenCalled();
  });
});
