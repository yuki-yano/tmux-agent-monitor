import { describe, expect, it } from "vitest";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

import {
  applyRefreshSessionsFailure,
  buildCommitFileQuery,
  buildCommitLogQuery,
  buildDiffFileQuery,
  buildDiffQuery,
  buildForceQuery,
  buildLaunchAgentJson,
  buildPaneHashParam,
  buildPaneNoteParam,
  buildPaneParam,
  buildRefreshFailureResult,
  buildRepoFileContentQuery,
  buildRepoFileSearchQuery,
  buildRepoFileTreeQuery,
  buildRepoNotePayloadJson,
  buildScreenRequestJson,
  buildScreenRequestKeys,
  buildSendKeysJson,
  buildSendRawJson,
  buildSendTextJson,
  buildSessionTitleJson,
  buildTimelineQuery,
  buildUploadImageForm,
  executeInflightRequest,
  resolveInflightScreenRequest,
} from "./session-api-utils";

describe("session-api-utils", () => {
  it("builds refresh failure flags from status", () => {
    expect(buildRefreshFailureResult(401)).toEqual({
      ok: false,
      status: 401,
      authError: true,
      rateLimited: false,
    });
    expect(buildRefreshFailureResult(429)).toEqual({
      ok: false,
      status: 429,
      authError: false,
      rateLimited: true,
    });
  });

  it("formats refresh 500 errors with explicit error cause", () => {
    const onConnectionIssueCalls: Array<string | null> = [];
    const cause =
      "invalid config: /tmp/.config/vde/monitor/config.yml activity.pollIntervalMs Invalid input: expected number, received string";

    const result = applyRefreshSessionsFailure({
      res: new Response(null, { status: 500 }),
      data: {
        error: { code: "INTERNAL", message: "configuration validation failed" },
        errorCause: cause,
      },
      onConnectionIssue: (message) => {
        onConnectionIssueCalls.push(message);
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      authError: false,
      rateLimited: false,
    });
    expect(onConnectionIssueCalls).toEqual([
      `${API_ERROR_MESSAGES.requestFailed} (500)\nError cause: ${cause}`,
    ]);
  });

  it("builds screen request json without cursor in image mode", () => {
    expect(buildScreenRequestJson({ mode: "text", lines: 30, cursor: "a" }, "text")).toEqual({
      mode: "text",
      lines: 30,
      cursor: "a",
    });
    expect(buildScreenRequestJson({ mode: "image", lines: 30, cursor: "a" }, "image")).toEqual({
      mode: "image",
      lines: 30,
    });
  });

  it("builds request keys and fallback key from cursor", () => {
    expect(
      buildScreenRequestKeys({ paneId: "pane-1", normalizedMode: "text", lines: 50, cursor: "c" }),
    ).toEqual({
      requestKey: "pane-1:text:50:c",
      fallbackKey: "pane-1:text:50:",
    });
    expect(
      buildScreenRequestKeys({ paneId: "pane-1", normalizedMode: "image", lines: 50, cursor: "c" }),
    ).toEqual({
      requestKey: "pane-1:image:50:",
      fallbackKey: null,
    });
  });

  it("resolves inflight request by direct key and fallback key", () => {
    const directPromise = Promise.resolve({ ok: true });
    const fallbackPromise = Promise.resolve({ ok: false });
    const map = new Map<string, Promise<unknown>>([
      ["pane-1:text:50:c", directPromise],
      ["pane-1:text:50:", fallbackPromise],
    ]);

    expect(
      resolveInflightScreenRequest({
        inFlightMap: map,
        requestKey: "pane-1:text:50:c",
        fallbackKey: "pane-1:text:50:",
      }),
    ).toBe(directPromise);
    expect(
      resolveInflightScreenRequest({
        inFlightMap: map,
        requestKey: "missing",
        fallbackKey: "pane-1:text:50:",
      }),
    ).toBe(fallbackPromise);
    expect(
      resolveInflightScreenRequest({
        inFlightMap: map,
        requestKey: "missing",
        fallbackKey: null,
      }),
    ).toBeNull();
  });

  it("executes inflight request once and clears map after completion", async () => {
    const map = new Map<string, Promise<number>>();
    let runCount = 0;
    const execute = async () => {
      runCount += 1;
      return 42;
    };

    const [first, second] = await Promise.all([
      executeInflightRequest({
        inFlightMap: map,
        requestKey: "pane-1:text:50:cursor",
        fallbackKey: "pane-1:text:50:",
        execute,
      }),
      executeInflightRequest({
        inFlightMap: map,
        requestKey: "pane-1:text:50:cursor",
        fallbackKey: "pane-1:text:50:",
        execute,
      }),
    ]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(runCount).toBe(1);
    expect(map.size).toBe(0);
  });

  it("builds query helpers", () => {
    expect(buildPaneParam("pane-1")).toEqual({ paneId: "pane-1" });
    expect(buildPaneHashParam("pane-1", "hash")).toEqual({ paneId: "pane-1", hash: "hash" });
    expect(buildPaneNoteParam("pane-1", "note-1")).toEqual({ paneId: "pane-1", noteId: "note-1" });
    expect(buildSendTextJson("echo test", true)).toEqual({ text: "echo test", enter: true });
    expect(buildSendTextJson("echo test", true, "req-1")).toEqual({
      text: "echo test",
      enter: true,
      requestId: "req-1",
    });
    expect(buildSendKeysJson(["Enter"])).toEqual({ keys: ["Enter"] });
    expect(buildSendRawJson([{ kind: "text", value: "abc" }], false)).toEqual({
      items: [{ kind: "text", value: "abc" }],
      unsafe: false,
    });
    expect(buildSessionTitleJson("next title")).toEqual({ title: "next title" });
    expect(buildRepoNotePayloadJson("note", "body")).toEqual({ title: "note", body: "body" });
    expect(buildRepoNotePayloadJson(undefined, "body")).toEqual({ title: null, body: "body" });
    expect(
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-1",
      }),
    ).toEqual({
      sessionName: "dev-main",
      agent: "codex",
      requestId: "req-1",
    });
    expect(
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "claude",
        requestId: "req-2",
        agentOptions: ["--dangerously-skip-permissions"],
        worktreePath: "/repo/.worktree/feature/x",
        worktreeBranch: "feature/x",
      }),
    ).toEqual({
      sessionName: "dev-main",
      agent: "claude",
      requestId: "req-2",
      agentOptions: ["--dangerously-skip-permissions"],
      worktreePath: "/repo/.worktree/feature/x",
      worktreeBranch: "feature/x",
    });
    expect(
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-2b",
        worktreeBranch: "feature/new-worktree",
        worktreeCreateIfMissing: true,
      }),
    ).toEqual({
      sessionName: "dev-main",
      agent: "codex",
      requestId: "req-2b",
      worktreeBranch: "feature/new-worktree",
      worktreeCreateIfMissing: true,
    });
    expect(
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-2c",
        worktreeBranch: "feature/new-worktree",
        worktreeCreateIfMissing: true,
        resumeFromPaneId: "%12",
        resumePolicy: "best_effort",
        resumeTarget: "window",
      }),
    ).toEqual({
      sessionName: "dev-main",
      agent: "codex",
      requestId: "req-2c",
      worktreeBranch: "feature/new-worktree",
      worktreeCreateIfMissing: true,
      resumeFromPaneId: "%12",
      resumePolicy: "best_effort",
      resumeTarget: "window",
    });
    expect(() =>
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-3",
        cwd: "/tmp",
        worktreeBranch: "feature/x",
      }),
    ).toThrow("cwd cannot be combined with worktreePath/worktreeBranch");
    expect(() =>
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-4",
        worktreeCreateIfMissing: true,
      }),
    ).toThrow("worktreeBranch is required when worktreeCreateIfMissing is true");
    expect(() =>
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-4b",
        resumePolicy: "required",
      }),
    ).toThrow("resumePolicy requires resumeSessionId or resumeFromPaneId");
    expect(() =>
      buildLaunchAgentJson({
        sessionName: "dev-main",
        agent: "codex",
        requestId: "req-4c",
        resumeSessionId: "sess-1",
        resumeTarget: "window",
      }),
    ).toThrow("resumeFromPaneId is required when resumeTarget is window");
    const file = new File([new Uint8Array([1, 2, 3])], "sample.png", { type: "image/png" });
    expect(buildUploadImageForm(file)).toEqual({ image: file });

    expect(buildForceQuery()).toEqual({});
    expect(buildForceQuery({ force: true })).toEqual({ force: "1" });
    expect(
      buildDiffQuery({
        mode: "total",
        force: true,
        worktreePath: "/repo/wt",
      }),
    ).toEqual({ force: "1", worktreePath: "/repo/wt", mode: "total" });

    expect(buildDiffFileQuery("src/a.ts", undefined, { mode: "total" })).toEqual({
      path: "src/a.ts",
      mode: "total",
    });
    expect(buildDiffFileQuery("src/a.ts", "HEAD~1", { force: true, mode: "committed" })).toEqual({
      path: "src/a.ts",
      rev: "HEAD~1",
      force: "1",
      mode: "committed",
    });

    expect(buildCommitLogQuery()).toEqual({});
    expect(buildCommitLogQuery({ limit: 20, skip: 10, force: true })).toEqual({
      limit: "20",
      skip: "10",
      force: "1",
    });

    expect(buildCommitFileQuery("src/a.ts")).toEqual({ path: "src/a.ts" });
    expect(buildCommitFileQuery("src/a.ts", { force: true })).toEqual({
      path: "src/a.ts",
      force: "1",
    });

    expect(buildTimelineQuery()).toEqual({});
    expect(buildTimelineQuery({ scope: "pane" })).toEqual({ scope: "pane" });
    expect(buildTimelineQuery({ scope: "repo" })).toEqual({ scope: "repo" });
    expect(buildTimelineQuery({ range: "1h" })).toEqual({ range: "1h" });
    expect(buildTimelineQuery({ range: "3h" })).toEqual({ range: "3h" });
    expect(buildTimelineQuery({ range: "24h" })).toEqual({ range: "24h" });
    expect(buildTimelineQuery({ limit: 9.8 })).toEqual({ limit: "9" });
    expect(buildTimelineQuery({ limit: 0 })).toEqual({ limit: "1" });

    expect(buildRepoFileTreeQuery()).toEqual({});
    expect(buildRepoFileTreeQuery({ path: "src", cursor: "abc", limit: 99.9 })).toEqual({
      path: "src",
      cursor: "abc",
      limit: "99",
    });

    expect(buildRepoFileSearchQuery("diff")).toEqual({ q: "diff" });
    expect(buildRepoFileSearchQuery("main", { cursor: "abc", limit: 0 })).toEqual({
      q: "main",
      cursor: "abc",
      limit: "1",
    });
    expect(buildRepoFileSearchQuery("docs/notes.md", { exactReference: true })).toEqual({
      q: "docs/notes.md",
      exactReference: "1",
    });

    expect(buildRepoFileContentQuery("README.md")).toEqual({ path: "README.md" });
    expect(buildRepoFileContentQuery("src/index.ts", { maxBytes: 10.8 })).toEqual({
      path: "src/index.ts",
      maxBytes: "10",
    });
    expect(buildRepoFileContentQuery("docs/notes.md")).toEqual({ path: "docs/notes.md" });
  });
});
