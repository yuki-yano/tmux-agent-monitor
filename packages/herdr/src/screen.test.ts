import { describe, expect, it, vi } from "vitest";
import { createHerdrScreenCapture } from "./screen";
import { HERDR_METHODS } from "./methods";

const makeOptions = (paneId: string) => ({
  paneId,
  lines: 2,
  joinLines: false,
  includeAnsi: false,
  altScreen: "auto" as const,
  alternateOn: false,
});

describe("createHerdrScreenCapture", () => {
  it("converts visible pane.read text to TextCaptureResult", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        type: "pane_read",
        read: {
          pane_id: "wB:p1",
          workspace_id: "wB",
          tab_id: "wB:t1",
          source: "visible",
          format: "text",
          text: "line1\nline2\nline3\n",
          revision: 0,
          truncated: false,
        },
      }),
    };
    const screen = createHerdrScreenCapture(client);

    await expect(
      screen.captureText({
        paneId: "wB:p1",
        lines: 2,
        joinLines: false,
        includeAnsi: false,
        altScreen: "auto",
        alternateOn: false,
      }),
    ).resolves.toEqual({
      screen: "line2\nline3",
      truncated: true,
      alternateOn: false,
    });
    expect(client.request).toHaveBeenCalledWith(HERDR_METHODS.paneRead, {
      pane_id: "wB:p1",
      source: "visible",
      lines: 2,
      format: "text",
      strip_ansi: true,
    });
  });

  it("preserves per-request failures and batch order", async () => {
    const request = vi.fn();
    request.mockImplementation(async (_method: string, params: Record<string, unknown>) => {
      if (params.pane_id === "bad") {
        throw new Error("missing pane");
      }
      const paneId = typeof params.pane_id === "string" ? params.pane_id : "";
      return { read: { text: `screen:${paneId}\n`, truncated: false } };
    });
    const client = { request };
    const screen = createHerdrScreenCapture(client);

    await expect(
      screen.captureTextBatch([
        { requestId: "first", options: makeOptions("1") },
        { requestId: "failed", options: makeOptions("bad") },
        { requestId: "last", options: makeOptions("3") },
      ]),
    ).resolves.toEqual([
      {
        requestId: "first",
        result: { screen: "screen:1", truncated: false, alternateOn: false },
      },
      { requestId: "failed", error: "missing pane" },
      {
        requestId: "last",
        result: { screen: "screen:3", truncated: false, alternateOn: false },
      },
    ]);
    expect(client.request).toHaveBeenCalledTimes(3);
  });

  it("limits batch concurrency to four requests", async () => {
    let active = 0;
    let maxActive = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn();
    request.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return { read: { text: "screen\n", truncated: false } };
    });
    const client = { request };
    const screen = createHerdrScreenCapture(client);
    const resultPromise = screen.captureTextBatch(
      Array.from({ length: 6 }, (_, index) => ({
        requestId: `request-${index}`,
        options: makeOptions(String(index)),
      })),
    );

    await vi.waitFor(() => {
      expect(client.request).toHaveBeenCalledTimes(4);
    });
    expect(maxActive).toBe(4);

    release();
    await expect(resultPromise).resolves.toHaveLength(6);
    expect(client.request).toHaveBeenCalledTimes(6);
    expect(maxActive).toBe(4);
  });

  it("propagates the batch AbortSignal and returns aborts as request failures", async () => {
    const controller = new AbortController();
    const request = vi.fn();
    request.mockImplementation(
      async (
        _method: string,
        _params: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) =>
        await new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    const client = { request };
    const screen = createHerdrScreenCapture(client);
    const resultPromise = screen.captureTextBatch(
      [{ requestId: "aborted", options: makeOptions("1") }],
      { signal: controller.signal },
    );

    await vi.waitFor(() => {
      expect(client.request).toHaveBeenCalledWith(HERDR_METHODS.paneRead, expect.any(Object), {
        signal: controller.signal,
      });
    });
    controller.abort(new Error("capture cancelled"));

    await expect(resultPromise).resolves.toEqual([
      { requestId: "aborted", error: "capture cancelled" },
    ]);
  });
});
