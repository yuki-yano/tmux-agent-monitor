import { defaultConfig } from "@tmux-agent-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { createTmuxActions } from "./tmux-actions.js";

describe("createTmuxActions.sendText", () => {
  it("sends enter key after text when enabled", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const config = {
      ...defaultConfig,
      input: { ...defaultConfig.input, enterKey: "C-m", enterDelayMs: 0 },
    };
    const tmuxActions = createTmuxActions(adapter, config);

    const result = await tmuxActions.sendText("%1", "echo hi", true);

    expect(result.ok).toBe(true);
    expect(adapter.run).toHaveBeenNthCalledWith(1, [
      "if-shell",
      "-t",
      "%1",
      '[ "#{pane_in_mode}" = "1" ]',
      "copy-mode -q -t %1",
    ]);
    expect(adapter.run).toHaveBeenNthCalledWith(2, ["send-keys", "-l", "-t", "%1", "echo hi"]);
    expect(adapter.run).toHaveBeenNthCalledWith(3, ["send-keys", "-t", "%1", "C-m"]);
  });

  it("sends multiline text as a single bracketed paste", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const config = {
      ...defaultConfig,
      input: { ...defaultConfig.input, enterKey: "C-m", enterDelayMs: 0 },
    };
    const tmuxActions = createTmuxActions(adapter, config);

    const result = await tmuxActions.sendText("%1", "echo 1\npwd", true);

    expect(result.ok).toBe(true);
    expect(adapter.run).toHaveBeenNthCalledWith(1, [
      "if-shell",
      "-t",
      "%1",
      '[ "#{pane_in_mode}" = "1" ]',
      "copy-mode -q -t %1",
    ]);
    expect(adapter.run).toHaveBeenNthCalledWith(2, [
      "send-keys",
      "-l",
      "-t",
      "%1",
      "\u001b[200~echo 1\npwd\u001b[201~",
    ]);
    expect(adapter.run).toHaveBeenNthCalledWith(3, ["send-keys", "-t", "%1", "C-m"]);
  });
});
