import { describe, expect, it } from "vitest";

import {
  projectSearchQueryData,
  projectTreeQueryData,
  rootDescriptor,
} from "./session-files-query-projection";

describe("session files Query projection", () => {
  it("projects only a contiguous tree cursor chain and ignores orphan descriptors", () => {
    const projected = projectTreeQueryData({
      descriptorsByPath: {
        ".": [
          rootDescriptor(),
          { cursor: "tail", parentCursor: null, headDataUpdateCount: 0 },
          { cursor: "orphan", parentCursor: "missing", headDataUpdateCount: 0 },
        ],
      },
      headDataUpdateCountByPath: { ".": 0 },
      resultByKey: new Map([
        [".\0", { data: { basePath: ".", entries: [], nextCursor: "tail" } }],
        [".\0tail", { data: { basePath: ".", entries: [], nextCursor: undefined } }],
        [".\0orphan", { data: { basePath: ".", entries: [], nextCursor: undefined } }],
      ]),
    });
    expect([...projected.reachableKeys]).toEqual([".\0", ".\0tail"]);
  });

  it("suppresses has-more when a tree cursor repeats", () => {
    const projected = projectTreeQueryData({
      descriptorsByPath: {
        ".": [rootDescriptor(), { cursor: "repeat", parentCursor: null, headDataUpdateCount: 0 }],
      },
      headDataUpdateCountByPath: { ".": 0 },
      resultByKey: new Map([
        [".\0", { data: { basePath: ".", entries: [], nextCursor: "repeat" } }],
        [".\0repeat", { data: { basePath: ".", entries: [], nextCursor: "repeat" } }],
      ]),
    });
    expect(projected.pages["."]?.nextCursor).toBeUndefined();
  });

  it("prunes tails from dataUpdateCount even when timestamps would be equal", () => {
    const projected = projectTreeQueryData({
      descriptorsByPath: {
        ".": [
          { ...rootDescriptor(), headDataUpdateCount: 1 },
          { cursor: "tail", parentCursor: null, headDataUpdateCount: 1 },
        ],
      },
      headDataUpdateCountByPath: { ".": 2 },
      resultByKey: new Map(),
    });
    expect(projected.nextDescriptors["."]).toEqual([
      { ...rootDescriptor(), headDataUpdateCount: 2 },
    ]);
  });

  it("keeps warm search data while a refetch result is in error state", () => {
    const projected = projectSearchQueryData({
      queries: ["a"],
      descriptorsByQuery: { a: [rootDescriptor()] },
      headDataUpdateCountByQuery: { a: 1 },
      resultByKey: new Map([
        [
          "a\0",
          {
            data: {
              query: "a",
              items: [],
              truncated: false,
              totalMatchedCount: 0,
            },
          },
        ],
      ]),
    });
    expect(projected.pages.get("a")?.query).toBe("a");
  });
});
