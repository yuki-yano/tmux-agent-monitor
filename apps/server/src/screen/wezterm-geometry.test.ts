import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";

import { focusWeztermPane, getWeztermPaneGeometry } from "./wezterm-geometry";

describe("wezterm-geometry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses pane via wezterm cli activate-pane", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    } as never);

    await focusWeztermPane("6", {
      cliPath: "/bin/wezterm",
      target: " dev ",
    });

    expect(execa).toHaveBeenCalledWith(
      "/bin/wezterm",
      ["cli", "--target", "dev", "activate-pane", "--pane-id", "6"],
      { timeout: 2000 },
    );
  });

  it("returns pane geometry from wezterm list output", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([
        {
          window_id: 1,
          tab_id: 3,
          pane_id: 3,
          left_col: 0,
          top_row: 0,
          size: { cols: 60, rows: 15, pixel_width: 480, pixel_height: 240 },
        },
        {
          window_id: 1,
          tab_id: 3,
          pane_id: 6,
          left_col: 0,
          top_row: 15,
          size: { cols: 60, rows: 15, pixel_width: 480, pixel_height: 240 },
        },
        {
          window_id: 1,
          tab_id: 3,
          pane_id: 5,
          left_col: 60,
          top_row: 0,
          size: { cols: 60, rows: 30, pixel_width: 480, pixel_height: 480 },
        },
      ]),
      stderr: "",
      exitCode: 0,
    } as never);

    const result = await getWeztermPaneGeometry("6", {
      target: "dev",
    });

    expect(execa).toHaveBeenCalledWith(
      "wezterm",
      ["cli", "--target", "dev", "list", "--format", "json"],
      { timeout: 2000 },
    );
    expect(result).toEqual({
      left: 0,
      top: 15,
      width: 60,
      height: 15,
      windowWidth: 120,
      windowHeight: 30,
      panePixelWidth: 480,
      panePixelHeight: 240,
    });
  });

  it("returns null when pane id is not found", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify([
        {
          window_id: 1,
          tab_id: 3,
          pane_id: 3,
          left_col: 0,
          top_row: 0,
          size: { cols: 60, rows: 15 },
        },
      ]),
      stderr: "",
      exitCode: 0,
    } as never);

    const result = await getWeztermPaneGeometry("999");

    expect(result).toBeNull();
  });

  it("returns null when wezterm list fails", async () => {
    vi.mocked(execa).mockRejectedValue(new Error("failed"));

    const result = await getWeztermPaneGeometry("6");

    expect(result).toBeNull();
  });
});
