import { describe, expect, it } from "vitest";

import {
  buildNormalRenderNodes,
  buildSearchRenderNodes,
  resolveTreeLoadMoreTarget,
} from "./session-files-tree-utils";

describe("session-files-tree-utils", () => {
  it("preserves ignored metadata for a directly matched directory", () => {
    const nodes = buildSearchRenderNodes({
      searchItems: [
        {
          path: "generated",
          name: "generated",
          kind: "directory",
          score: 1,
          highlights: [],
          isIgnored: true,
        },
      ],
      selectedFilePath: null,
      activeMatchPath: "generated",
      expandedDirSet: new Set(),
    });

    expect(nodes).toEqual([
      expect.objectContaining({
        path: "generated",
        kind: "directory",
        isIgnored: true,
        searchMatched: true,
      }),
    ]);
  });

  it("preserves ignored metadata from a lazily loaded tree page", () => {
    const nodes = buildNormalRenderNodes({
      treePages: {
        ".": {
          basePath: ".",
          entries: [
            {
              path: "generated",
              name: "generated",
              kind: "directory",
              hasChildren: true,
              isIgnored: true,
            },
          ],
        },
      },
      expandedDirSet: new Set(),
      selectedFilePath: null,
    });

    expect(nodes[0]).toEqual(
      expect.objectContaining({
        path: "generated",
        isIgnored: true,
        hasChildren: true,
      }),
    );
  });

  it("offers pagination only for root or currently expanded directories", () => {
    const treePages = {
      ".": { basePath: ".", entries: [], nextCursor: undefined },
      collapsed: { basePath: "collapsed", entries: [], nextCursor: "hidden-tail" },
      expanded: { basePath: "expanded", entries: [], nextCursor: "visible-tail" },
    };

    expect(resolveTreeLoadMoreTarget({ treePages, expandedDirSet: new Set(["expanded"]) })).toEqual(
      { path: "expanded", cursor: "visible-tail" },
    );
    expect(resolveTreeLoadMoreTarget({ treePages, expandedDirSet: new Set() })).toBeNull();
  });

  it("orders pagination by root then visible render traversal", () => {
    const treePages = {
      ".": { basePath: ".", entries: [], nextCursor: undefined },
      first: { basePath: "first", entries: [], nextCursor: "first-tail" },
      second: { basePath: "second", entries: [], nextCursor: "second-tail" },
    };

    expect(
      resolveTreeLoadMoreTarget({
        treePages,
        expandedDirSet: new Set(["second", "first"]),
      }),
    ).toEqual({ path: "second", cursor: "second-tail" });
    expect(
      resolveTreeLoadMoreTarget({
        treePages: { ...treePages, ".": { ...treePages["."], nextCursor: "root-tail" } },
        expandedDirSet: new Set(["second", "first"]),
      }),
    ).toEqual({ path: ".", cursor: "root-tail" });
  });
});
