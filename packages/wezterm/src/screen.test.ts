import { describe, expect, it, vi } from "vitest";

import { createScreenCapture } from "./screen.js";

describe("createScreenCapture", () => {
  it("calls get-text with line range and escapes", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        stdout: "line1\nline2\n",
        stderr: "",
        exitCode: 0,
      })),
    };
    const capture = createScreenCapture(adapter);

    const result = await capture.captureText({
      paneId: "1",
      lines: 10,
      joinLines: false,
      includeAnsi: true,
      altScreen: "auto",
      alternateOn: false,
    });

    expect(adapter.run).toHaveBeenCalledWith([
      "get-text",
      "--pane-id",
      "1",
      "--start-line",
      "-10",
      "--end-line",
      "-1",
      "--escapes",
    ]);
    expect(result).toEqual({
      screen: "line1\nline2",
      truncated: false,
      alternateOn: false,
    });
  });

  it("marks truncated when lines exceed requested count", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        stdout: "1\n2\n3\n4\n",
        stderr: "",
        exitCode: 0,
      })),
    };
    const capture = createScreenCapture(adapter);

    const result = await capture.captureText({
      paneId: "1",
      lines: 2,
      joinLines: false,
      includeAnsi: false,
      altScreen: "auto",
      alternateOn: false,
    });

    expect(result.screen).toBe("3\n4");
    expect(result.truncated).toBe(true);
  });

  it("throws when get-text fails", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        stdout: "",
        stderr: "failed",
        exitCode: 1,
      })),
    };
    const capture = createScreenCapture(adapter);
    await expect(
      capture.captureText({
        paneId: "1",
        lines: 2,
        joinLines: false,
        includeAnsi: false,
        altScreen: "auto",
        alternateOn: false,
      }),
    ).rejects.toThrow("failed");
  });
});
