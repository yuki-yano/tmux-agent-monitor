import type { TmuxAdapter } from "@vde-monitor/tmux";
import { describe, expect, it } from "vitest";

import { createFingerprintCapture } from "./fingerprint.js";

describe("createFingerprintCapture", () => {
  it("captures and normalizes fingerprint", async () => {
    const adapter: TmuxAdapter = {
      run: async () => ({ exitCode: 0, stdout: "a  \n b\n", stderr: "" }),
    };
    const capture = createFingerprintCapture(adapter);
    const result = await capture("%1", false);
    expect(result).toBe("a\n b");
  });

  it("returns null when capture fails", async () => {
    const adapter: TmuxAdapter = {
      run: async () => ({ exitCode: 1, stdout: "", stderr: "error" }),
    };
    const capture = createFingerprintCapture(adapter);
    const result = await capture("%1", false);
    expect(result).toBeNull();
  });
});
