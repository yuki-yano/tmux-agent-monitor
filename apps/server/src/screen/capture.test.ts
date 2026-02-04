import { describe, expect, it, vi } from "vitest";

vi.mock("./capture-macos.js", () => ({
  captureTerminalScreenMacos: vi.fn(async () => ({ imageBase64: "x", cropped: false })),
}));

import { captureTerminalScreen } from "./capture.js";
import { captureTerminalScreenMacos } from "./capture-macos.js";

describe("captureTerminalScreen", () => {
  it("returns null on non-mac platforms", async () => {
    const result = await captureTerminalScreen("tty1", {}, "linux");
    expect(result).toBeNull();
    expect(captureTerminalScreenMacos).not.toHaveBeenCalled();
  });

  it("delegates to macos capture on darwin", async () => {
    const result = await captureTerminalScreen("tty1", {}, "darwin");
    expect(result).toEqual({ imageBase64: "x", cropped: false });
    expect(captureTerminalScreenMacos).toHaveBeenCalled();
  });
});
