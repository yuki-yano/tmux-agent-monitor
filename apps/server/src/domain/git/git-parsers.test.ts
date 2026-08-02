import { describe, expect, it } from "vitest";

import { isBinaryPatch, parseNumstat, parseNumstatLine, pickStatus } from "./git-parsers";

describe("parseNumstatLine", () => {
  it("parses numeric additions/deletions", () => {
    const output = "12\t3\tsrc/app.ts\n";
    expect(parseNumstatLine(output)).toEqual({ additions: 12, deletions: 3 });
  });

  it("returns nulls for binary markers", () => {
    const output = "-\t-\tassets/logo.png\n";
    expect(parseNumstatLine(output)).toEqual({ additions: null, deletions: null });
  });

  it("handles no-index numstat output", () => {
    const output = "5\t0\t/tmp/file.txt\n";
    expect(parseNumstatLine(output)).toEqual({ additions: 5, deletions: 0 });
  });

  it("ignores empty output", () => {
    expect(parseNumstatLine("")).toBeNull();
  });
});

describe("parseNumstat", () => {
  it("parses multi-line numstat output", () => {
    const output = ["3\t1\tsrc/app.ts", "0\t2\tsrc/main.ts", ""].join("\n");
    const result = parseNumstat(output);
    expect(result.get("src/app.ts")).toEqual({ additions: 3, deletions: 1 });
    expect(result.get("src/main.ts")).toEqual({ additions: 0, deletions: 2 });
  });

  it("uses nulls for binary entries", () => {
    const output = "-\t-\tassets/logo.png\n";
    const result = parseNumstat(output);
    expect(result.get("assets/logo.png")).toEqual({ additions: null, deletions: null });
  });

  it("uses the destination path for null-delimited rename entries", () => {
    const output = ["4\t2\t", "old-dir/old.ts", "new-dir/new.ts", "1\t0\tplain.ts", ""].join("\0");

    const result = parseNumstat(output);

    expect(result.get("new-dir/new.ts")).toEqual({ additions: 4, deletions: 2 });
    expect(result.get("plain.ts")).toEqual({ additions: 1, deletions: 0 });
    expect(result.has("old-dir/old.ts")).toBe(false);
  });
});

describe("pickStatus", () => {
  it("normalizes to a known status", () => {
    expect(pickStatus("m")).toBe("M");
    expect(pickStatus("A")).toBe("A");
  });

  it("falls back to unknown marker", () => {
    expect(pickStatus("Z")).toBe("?");
  });
});

describe("isBinaryPatch", () => {
  it("detects binary patch markers", () => {
    expect(isBinaryPatch("Binary files a/foo and b/foo differ")).toBe(true);
    expect(isBinaryPatch("GIT binary patch")).toBe(true);
    expect(isBinaryPatch("literal 123")).toBe(true);
    expect(isBinaryPatch("delta 42")).toBe(true);
  });

  it("returns false for text patches", () => {
    expect(isBinaryPatch("diff --git a/foo b/foo\n+hello")).toBe(false);
  });

  it("does not treat literal word usage as binary", () => {
    expect(isBinaryPatch('patch.includes("literal ");')).toBe(false);
  });
});
