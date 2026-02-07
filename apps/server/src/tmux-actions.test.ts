import { defaultConfig } from "@vde-monitor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markPaneFocus } from "./activity-suppressor.js";
import { resolveBackendApp } from "./screen/macos-app.js";
import { focusTerminalApp, isAppRunning } from "./screen/macos-applescript.js";
import { focusTmuxPane } from "./screen/tmux-geometry.js";
import { createTmuxActions } from "./tmux-actions.js";

vi.mock("./screen/macos-app.js", () => ({
  resolveBackendApp: vi.fn(),
}));

vi.mock("./screen/macos-applescript.js", () => ({
  isAppRunning: vi.fn(),
  focusTerminalApp: vi.fn(),
}));

vi.mock("./screen/tmux-geometry.js", () => ({
  focusTmuxPane: vi.fn(),
}));

vi.mock("./activity-suppressor.js", () => ({
  markPaneFocus: vi.fn(),
}));

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

const setProcessPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
};

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

describe("createTmuxActions.focusPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProcessPlatform("darwin");
    vi.mocked(resolveBackendApp).mockReturnValue({
      key: "terminal",
      appName: "Terminal",
    });
    vi.mocked(isAppRunning).mockResolvedValue(true);
    vi.mocked(focusTerminalApp).mockResolvedValue();
    vi.mocked(markPaneFocus).mockImplementation(() => undefined);
    vi.mocked(focusTmuxPane).mockResolvedValue();
  });

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  });

  it("rejects focus on non-macOS", async () => {
    setProcessPlatform("linux");
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const tmuxActions = createTmuxActions(adapter, { ...defaultConfig, token: "test-token" });

    const result = await tmuxActions.focusPane("%1");

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
    expect(focusTerminalApp).not.toHaveBeenCalled();
  });

  it("returns TMUX_UNAVAILABLE when backend app is not running", async () => {
    vi.mocked(isAppRunning).mockResolvedValue(false);
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const tmuxActions = createTmuxActions(adapter, { ...defaultConfig, token: "test-token" });

    const result = await tmuxActions.focusPane("%1");

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TMUX_UNAVAILABLE");
    expect(focusTerminalApp).not.toHaveBeenCalled();
    expect(markPaneFocus).not.toHaveBeenCalled();
    expect(focusTmuxPane).not.toHaveBeenCalled();
  });

  it("returns ok even when tmux pane focusing fails", async () => {
    vi.mocked(focusTmuxPane).mockRejectedValue(new Error("failed"));
    const adapter = {
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    };
    const config = { ...defaultConfig, token: "test-token" };
    const tmuxActions = createTmuxActions(adapter, config);

    const result = await tmuxActions.focusPane("%1");

    expect(result.ok).toBe(true);
    expect(resolveBackendApp).toHaveBeenCalledWith(config.screen.image.backend);
    expect(isAppRunning).toHaveBeenCalledWith("Terminal");
    expect(focusTerminalApp).toHaveBeenCalledWith("Terminal");
    expect(markPaneFocus).toHaveBeenCalledWith("%1");
    expect(focusTmuxPane).toHaveBeenCalledWith("%1", config.tmux);
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
