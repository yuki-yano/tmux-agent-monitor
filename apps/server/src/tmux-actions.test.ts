import { defaultConfig } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { createTmuxActions } from "./tmux-actions.js";

describe("createTmuxActions.sendText", () => {
  it("sends enter key after text when enabled", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const config = {
      ...defaultConfig,
      token: "test-token",
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
      token: "test-token",
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

  it("detects dangerous commands across split sends", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const config = {
      ...defaultConfig,
      token: "test-token",
      input: { ...defaultConfig.input, enterKey: "C-m", enterDelayMs: 0 },
    };
    const tmuxActions = createTmuxActions(adapter, config);

    const first = await tmuxActions.sendText("%1", "rm ", false);
    const second = await tmuxActions.sendText("%1", "-rf /tmp", true);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("DANGEROUS_COMMAND");
    expect(adapter.run).toHaveBeenCalledTimes(2);
  });
});

describe("createTmuxActions.sendKeys", () => {
  it("blocks configured danger keys", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const tmuxActions = createTmuxActions(adapter, { ...defaultConfig, token: "test-token" });

    const result = await tmuxActions.sendKeys("%1", ["C-c"]);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("DANGEROUS_COMMAND");
    expect(adapter.run).not.toHaveBeenCalled();
  });
});

describe("createTmuxActions.sendRaw", () => {
  it("sends raw text and key items in order", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const tmuxActions = createTmuxActions(adapter, { ...defaultConfig, token: "test-token" });

    const result = await tmuxActions.sendRaw(
      "%1",
      [
        { kind: "text", value: "ls" },
        { kind: "key", value: "Enter" },
      ],
      false,
    );

    expect(result.ok).toBe(true);
    expect(adapter.run).toHaveBeenNthCalledWith(1, [
      "if-shell",
      "-t",
      "%1",
      '[ "#{pane_in_mode}" = "1" ]',
      "copy-mode -q -t %1",
    ]);
    expect(adapter.run).toHaveBeenNthCalledWith(2, ["send-keys", "-l", "-t", "%1", "ls"]);
    expect(adapter.run).toHaveBeenNthCalledWith(3, ["send-keys", "-t", "%1", "Enter"]);
  });

  it("blocks dangerous keys when unsafe is false", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const tmuxActions = createTmuxActions(adapter, { ...defaultConfig, token: "test-token" });

    const result = await tmuxActions.sendRaw("%1", [{ kind: "key", value: "C-c" }], false);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("DANGEROUS_COMMAND");
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("allows dangerous keys when unsafe is true", async () => {
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const tmuxActions = createTmuxActions(adapter, { ...defaultConfig, token: "test-token" });

    const result = await tmuxActions.sendRaw("%1", [{ kind: "key", value: "C-c" }], true);

    expect(result.ok).toBe(true);
    expect(adapter.run).toHaveBeenCalledWith(["send-keys", "-t", "%1", "C-c"]);
  });
});
