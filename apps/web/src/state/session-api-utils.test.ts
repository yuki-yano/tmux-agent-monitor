import { describe, expect, it } from "vitest";

import {
  buildCommitFileQuery,
  buildCommitLogQuery,
  buildDiffFileQuery,
  buildForceQuery,
  buildPaneHashParam,
  buildPaneParam,
  buildRefreshFailureResult,
  buildScreenRequestJson,
  buildScreenRequestKeys,
  buildSendKeysJson,
  buildSendRawJson,
  buildSendTextJson,
  buildSessionTitleJson,
  buildTimelineQuery,
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
    expect(buildSendTextJson("echo test", true)).toEqual({ text: "echo test", enter: true });
    expect(buildSendKeysJson(["Enter"])).toEqual({ keys: ["Enter"] });
    expect(buildSendRawJson([{ kind: "text", value: "abc" }], false)).toEqual({
      items: [{ kind: "text", value: "abc" }],
      unsafe: false,
    });
    expect(buildSessionTitleJson("next title")).toEqual({ title: "next title" });

    expect(buildForceQuery()).toEqual({});
    expect(buildForceQuery({ force: true })).toEqual({ force: "1" });

    expect(buildDiffFileQuery("src/a.ts")).toEqual({ path: "src/a.ts" });
    expect(buildDiffFileQuery("src/a.ts", "HEAD~1", { force: true })).toEqual({
      path: "src/a.ts",
      rev: "HEAD~1",
      force: "1",
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
    expect(buildTimelineQuery({ range: "1h" })).toEqual({ range: "1h" });
    expect(buildTimelineQuery({ limit: 9.8 })).toEqual({ limit: "9" });
    expect(buildTimelineQuery({ limit: 0 })).toEqual({ limit: "1" });
  });
});
