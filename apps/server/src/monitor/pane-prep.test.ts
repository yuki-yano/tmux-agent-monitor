import type { PaneMeta } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { ensurePipeTagValue } from "./pane-prep.js";

describe("ensurePipeTagValue", () => {
  it("returns same pane when pipeTagValue is already set", async () => {
    const pane = { paneId: "%1", pipeTagValue: "1" } as PaneMeta;
    const readUserOption = vi.fn();
    const result = await ensurePipeTagValue(pane, { readUserOption });
    expect(result).toBe(pane);
    expect(readUserOption).not.toHaveBeenCalled();
  });

  it("fills pipeTagValue from user option", async () => {
    const pane = { paneId: "%1", pipeTagValue: null } as PaneMeta;
    const readUserOption = vi.fn(async () => "1");
    const result = await ensurePipeTagValue(pane, { readUserOption });
    expect(result.pipeTagValue).toBe("1");
    expect(readUserOption).toHaveBeenCalledWith("%1", "@vde-monitor_pipe");
  });
});
