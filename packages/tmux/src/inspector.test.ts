import { describe, expect, it, vi } from "vitest";

import { createInspector } from "./inspector.js";

describe("createInspector", () => {
  it("parses list-panes output into PaneMeta", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({
        stdout:
          "%1\tsession\t0\t1\t1700000000\t1\tcodex\t/path\t/dev/ttys001\t0\t1\t1\t1234\tTitle\tstart\t1\n",
        stderr: "",
        exitCode: 0,
      }),
    };
    const inspector = createInspector(adapter);
    const panes = await inspector.listPanes();
    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({
      paneId: "%1",
      sessionName: "session",
      windowIndex: 0,
      paneIndex: 1,
      windowActivity: 1700000000,
      paneActive: true,
      currentCommand: "codex",
      currentPath: "/path",
      paneTty: "/dev/ttys001",
      paneDead: false,
      panePipe: true,
      alternateOn: true,
      panePid: 1234,
      paneTitle: "Title",
      paneStartCommand: "start",
      pipeTagValue: "1",
    });
  });

  it("parses window activity and pane active flags", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({
        stdout:
          "%1\tsession\t0\t1\t0\t0\tcmd\t/path\t/dev/ttys001\t0\t0\ton\t1234\tTitle\tstart\t1\n",
        stderr: "",
        exitCode: 0,
      }),
    };
    const inspector = createInspector(adapter);
    const panes = await inspector.listPanes();
    expect(panes[0]).toMatchObject({
      windowActivity: null,
      paneActive: false,
      panePipe: false,
      alternateOn: true,
    });
  });

  it("parses pane flags when boolean is true string", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({
        stdout:
          "%1\tsession\t0\t1\t1700000000\ttrue\tcmd\t/path\t/dev/ttys001\ttrue\ttrue\ttrue\t1234\tTitle\tstart\t1\n",
        stderr: "",
        exitCode: 0,
      }),
    };
    const inspector = createInspector(adapter);
    const panes = await inspector.listPanes();
    expect(panes[0]).toMatchObject({
      paneActive: true,
      paneDead: true,
      panePipe: true,
      alternateOn: true,
    });
  });

  it("ignores malformed lines", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({
        stdout:
          "bad line\n%1\tsession\t0\t1\t1700000000\t1\tcmd\t/path\t/dev/ttys001\t0\t1\t1\t1234\tTitle\tstart\t1\n",
        stderr: "",
        exitCode: 0,
      }),
    };
    const inspector = createInspector(adapter);
    const panes = await inspector.listPanes();
    expect(panes).toHaveLength(1);
    expect(panes[0]?.paneId).toBe("%1");
  });

  it("reads user option and trims output", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: " value \n", stderr: "", exitCode: 0 }),
    };
    const inspector = createInspector(adapter);
    const result = await inspector.readUserOption("%1", "@tmux-agent-monitor");
    expect(result).toBe("value");
  });

  it("returns null for blank user option", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "   \n", stderr: "", exitCode: 0 }),
    };
    const inspector = createInspector(adapter);
    const result = await inspector.readUserOption("%1", "@tmux-agent-monitor");
    expect(result).toBeNull();
  });

  it("returns null when reading user option fails", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "fail", exitCode: 1 }),
    };
    const inspector = createInspector(adapter);
    const result = await inspector.readUserOption("%1", "@tmux-agent-monitor");
    expect(result).toBeNull();
  });

  it("writes and unsets user option", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const inspector = createInspector(adapter);
    await inspector.writeUserOption("%1", "@tmux-agent-monitor", "1");
    await inspector.writeUserOption("%1", "@tmux-agent-monitor", null);

    expect(adapter.run).toHaveBeenCalledWith([
      "set-option",
      "-t",
      "%1",
      "@tmux-agent-monitor",
      "1",
    ]);
    expect(adapter.run).toHaveBeenCalledWith([
      "set-option",
      "-t",
      "%1",
      "-u",
      "@tmux-agent-monitor",
    ]);
  });

  it("throws when list-panes fails", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "fail", exitCode: 1 }),
    };
    const inspector = createInspector(adapter);
    await expect(inspector.listPanes()).rejects.toThrow("fail");
  });
});
