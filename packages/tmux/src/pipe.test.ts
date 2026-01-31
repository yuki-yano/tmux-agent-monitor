import { describe, expect, it, vi } from "vitest";

import { createPipeManager } from "./pipe.js";

describe("createPipeManager", () => {
  it("detects conflict when pane has pipe but tag missing", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const pipeManager = createPipeManager(adapter);
    const result = await pipeManager.attachPipe("%1", "/tmp/test.log", {
      panePipe: true,
      pipeTagValue: null,
    });
    expect(result).toEqual({ attached: false, conflict: true });
  });

  it("attaches pipe and tags pane when no conflict", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const pipeManager = createPipeManager(adapter);
    const result = await pipeManager.attachPipe("%2", "/tmp/test.log", {
      panePipe: false,
      pipeTagValue: null,
    });

    expect(result).toEqual({ attached: true, conflict: false });
    expect(adapter.run).toHaveBeenCalledWith([
      "pipe-pane",
      "-o",
      "-t",
      "%2",
      'cat >> "/tmp/test.log"',
    ]);
    expect(adapter.run).toHaveBeenCalledWith([
      "set-option",
      "-t",
      "%2",
      "@tmux-agent-monitor_pipe",
      "1",
    ]);
  });

  it("escapes quotes in log path when attaching", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const pipeManager = createPipeManager(adapter);
    await pipeManager.attachPipe("%4", '/tmp/"weird".log', {
      panePipe: false,
      pipeTagValue: null,
    });

    expect(adapter.run).toHaveBeenCalledWith([
      "pipe-pane",
      "-o",
      "-t",
      "%4",
      'cat >> "/tmp/\\"weird\\".log"',
    ]);
  });

  it("returns not attached when pipe-pane fails", async () => {
    const adapter = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ stdout: "", stderr: "fail", exitCode: 1 })
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const pipeManager = createPipeManager(adapter);
    const result = await pipeManager.attachPipe("%3", "/tmp/test.log", {
      panePipe: false,
      pipeTagValue: "1",
    });

    expect(result).toEqual({ attached: false, conflict: false });
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it("exposes hasConflict helper", () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const pipeManager = createPipeManager(adapter);
    expect(pipeManager.hasConflict({ panePipe: true, pipeTagValue: null })).toBe(true);
    expect(pipeManager.hasConflict({ panePipe: true, pipeTagValue: "1" })).toBe(false);
    expect(pipeManager.hasConflict({ panePipe: false, pipeTagValue: null })).toBe(false);
  });
});
