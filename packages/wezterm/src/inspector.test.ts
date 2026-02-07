import { describe, expect, it, vi } from "vitest";

import { createInspector } from "./inspector.js";

describe("createInspector", () => {
  it("parses list/list-clients into PaneMeta", async () => {
    const adapter = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            {
              pane_id: 1,
              workspace: "main",
              tab_id: 10,
              pane_index: 2,
              cwd: "file:///tmp/project",
              tty_name: "/dev/ttys001",
              pid: 123,
              title: "Editor",
              foreground_process_name: "nvim",
            },
          ]),
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ focused_pane_id: 1 }]),
          stderr: "",
          exitCode: 0,
        }),
    };
    const inspector = createInspector(adapter);

    const panes = await inspector.listPanes();

    expect(panes).toEqual([
      {
        paneId: "1",
        sessionName: "main",
        windowIndex: 10,
        paneIndex: 2,
        windowActivity: null,
        paneActivity: null,
        paneActive: true,
        currentCommand: "nvim",
        currentPath: "/tmp/project",
        paneTty: "/dev/ttys001",
        paneDead: false,
        panePipe: false,
        alternateOn: false,
        panePid: 123,
        paneTitle: "Editor",
        paneStartCommand: null,
        pipeTagValue: null,
      },
    ]);
  });

  it("falls back paneIndex when missing and ignores malformed panes", async () => {
    const adapter = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { pane_id: 1, tab_id: 3 },
            { pane_id: 2, tab_id: 3 },
            { pane_id: null, tab_id: 3 },
          ]),
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([]),
          stderr: "",
          exitCode: 0,
        }),
    };
    const inspector = createInspector(adapter);

    const panes = await inspector.listPanes();

    expect(panes).toHaveLength(2);
    expect(panes[0]?.paneIndex).toBe(0);
    expect(panes[1]?.paneIndex).toBe(1);
  });

  it("derives paneActivity/windowActivity from client idle_time", async () => {
    const adapter = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { pane_id: 1, tab_id: 3 },
            { pane_id: 2, tab_id: 3 },
            { pane_id: 5, tab_id: 8 },
          ]),
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            {
              focused_pane_id: 1,
              idle_time: { secs: 5, nanos: 0 },
            },
            {
              focused_pane_id: 5,
              idle_time: { secs: 10, nanos: 0 },
            },
          ]),
          stderr: "",
          exitCode: 0,
        }),
    };
    const inspector = createInspector(adapter, {
      now: () => new Date("2026-02-08T00:00:00.000Z"),
    });

    const panes = await inspector.listPanes();
    const pane1 = panes.find((pane) => pane.paneId === "1");
    const pane2 = panes.find((pane) => pane.paneId === "2");
    const pane5 = panes.find((pane) => pane.paneId === "5");

    expect(pane1?.paneActivity).toBe(1770508795);
    expect(pane1?.windowActivity).toBe(1770508795);
    expect(pane2?.paneActivity).toBeNull();
    expect(pane2?.windowActivity).toBe(1770508795);
    expect(pane5?.paneActivity).toBe(1770508790);
    expect(pane5?.windowActivity).toBe(1770508790);
  });

  it("returns null for readUserOption", async () => {
    const adapter = {
      run: vi.fn(),
    };
    const inspector = createInspector(adapter);
    await expect(inspector.readUserOption("1", "@vde-monitor_pipe")).resolves.toBeNull();
  });

  it("throws when list command fails", async () => {
    const adapter = {
      run: vi.fn().mockResolvedValueOnce({ stdout: "", stderr: "failed", exitCode: 1 }),
    };
    const inspector = createInspector(adapter);
    await expect(inspector.listPanes()).rejects.toThrow("failed");
  });
});
