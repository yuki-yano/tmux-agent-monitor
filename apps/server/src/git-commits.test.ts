import { describe, expect, it } from "vitest";

import { parseCommitLogOutput, parseNameStatusOutput } from "./git-commits.js";

const RS = "\u001e";
const FS = "\u001f";

describe("parseCommitLogOutput", () => {
  it("parses commit log records", () => {
    const output = [
      `${RS}hash1${FS}h1${FS}Alice${FS}alice@example.com${FS}2024-01-01T00:00:00Z${FS}Subject one${FS}Body line 1\nBody line 2`,
      `${RS}hash2${FS}h2${FS}Bob${FS}${FS}2024-01-02T00:00:00Z${FS}Subject two${FS}`,
    ].join("");

    const commits = parseCommitLogOutput(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: "hash1",
      shortHash: "h1",
      authorName: "Alice",
      authorEmail: "alice@example.com",
      subject: "Subject one",
    });
    expect(commits[0]?.body).toContain("Body line 2");
    expect(commits[1]).toMatchObject({
      hash: "hash2",
      shortHash: "h2",
      authorName: "Bob",
      authorEmail: null,
      subject: "Subject two",
      body: null,
    });
  });

  it("returns empty array for empty output", () => {
    expect(parseCommitLogOutput("")).toEqual([]);
  });
});

describe("parseNameStatusOutput", () => {
  it("parses name-status entries", () => {
    const output = ["M\tfile-a.txt", "R100\told.txt\tnew.txt", "A\tfile-b.txt"].join("\n");
    const files = parseNameStatusOutput(output);
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ status: "M", path: "file-a.txt" });
    expect(files[1]).toMatchObject({
      status: "R",
      path: "new.txt",
      renamedFrom: "old.txt",
    });
    expect(files[2]).toMatchObject({ status: "A", path: "file-b.txt" });
  });

  it("normalizes unknown status to ?", () => {
    const output = ["X\tweird.txt"].join("\n");
    const files = parseNameStatusOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ status: "?", path: "weird.txt" });
  });
});
