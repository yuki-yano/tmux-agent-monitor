import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "true\n", stderr: "", exitCode: 0 })),
}));

import { execa } from "execa";

import { focusTerminalApp, isAppRunning, runAppleScript } from "./macos-applescript.js";

describe("macos-applescript", () => {
  it("runs AppleScript and trims output", async () => {
    const result = await runAppleScript('return "true"');
    expect(result).toBe("true");
  });

  it("checks if app is running", async () => {
    const result = await isAppRunning("Terminal");
    expect(result).toBe(true);
  });

  it("focuses terminal app", async () => {
    await focusTerminalApp("Terminal");
    expect(execa).toHaveBeenCalledWith(
      "osascript",
      ["-e", 'tell application "Terminal" to activate'],
      undefined,
    );
  });
});
