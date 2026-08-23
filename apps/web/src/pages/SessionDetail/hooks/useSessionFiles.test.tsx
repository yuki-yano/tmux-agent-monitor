import { act, renderHook, waitFor } from "@testing-library/react";
import type { RepoFileContent, RepoFileSearchPage, RepoFileTreePage } from "@vde-monitor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionFiles as useSessionFilesHook } from "./useSessionFiles";

const revokeRepoFilePreview = vi.fn(async () => undefined);
type UseSessionFilesParams = Parameters<typeof useSessionFilesHook>[0];
const useSessionFiles = (
  params: Omit<UseSessionFilesParams, "revokeRepoFilePreview"> &
    Partial<Pick<UseSessionFilesParams, "revokeRepoFilePreview">>,
) => useSessionFilesHook({ revokeRepoFilePreview, ...params });

const createTreePage = (overrides: Partial<RepoFileTreePage>): RepoFileTreePage => ({
  basePath: ".",
  entries: [],
  ...overrides,
});

const createSearchPage = (overrides: Partial<RepoFileSearchPage>): RepoFileSearchPage => ({
  query: "index",
  items: [],
  truncated: false,
  totalMatchedCount: 0,
  ...overrides,
});

const requestRepoFileContent = vi.fn(
  async (_paneId: string, targetPath: string): Promise<RepoFileContent> => ({
    path: targetPath,
    sizeBytes: 12,
    isBinary: false,
    truncated: false,
    languageHint: "typescript",
    content: "export {};",
  }),
);

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolve) {
        resolve(value);
      }
    },
  };
};

describe("useSessionFiles", () => {
  afterEach(() => {
    vi.useRealTimers();
    requestRepoFileContent.mockClear();
    revokeRepoFilePreview.mockClear();
  });

  it("loads root tree and expands directories", async () => {
    const requestRepoFileTree = vi.fn(async (_paneId: string, options?: { path?: string }) => {
      if (!options?.path) {
        return createTreePage({
          basePath: ".",
          entries: [
            { path: "src", name: "src", kind: "directory", hasChildren: true },
            { path: "README.md", name: "README.md", kind: "file" },
          ],
        });
      }
      if (options.path === "src") {
        return createTreePage({
          basePath: "src",
          entries: [{ path: "src/index.ts", name: "index.ts", kind: "file" }],
        });
      }
      return createTreePage({ basePath: options.path });
    });
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src")).toBe(true);
    });

    act(() => {
      result.current.onToggleDirectory("src");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/index.ts")).toBe(true);
    });
  });

  it("refreshes root tree even when search is inactive", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    await waitFor(() => {
      expect(requestRepoFileTree).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.onRefresh();
    });

    await waitFor(() => {
      expect(requestRepoFileTree).toHaveBeenCalledTimes(2);
    });
    expect(requestRepoFileSearch).not.toHaveBeenCalled();
  });

  it("refreshes active search result with current query", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) =>
      createSearchPage({
        query,
        items: [
          { path: `src/${query}.ts`, name: `${query}.ts`, kind: "file", score: 1, highlights: [0] },
        ],
        totalMatchedCount: 1,
      }),
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onSearchQueryChange("index");
    });

    await waitFor(() => {
      expect(result.current.searchResult?.query).toBe("index");
    });
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onRefresh();
    });

    await waitFor(() => {
      expect(requestRepoFileSearch).toHaveBeenCalledTimes(2);
    });
    expect(requestRepoFileSearch).toHaveBeenLastCalledWith("pane-1", "index", {
      cursor: undefined,
      limit: 100,
    });
  });

  it("applies search results to tree nodes and confirms active selection", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) =>
      createSearchPage({
        query,
        items:
          query === "index"
            ? [
                {
                  path: "src/app/index.ts",
                  name: "index.ts",
                  kind: "file" as const,
                  score: 0.8,
                  highlights: [0, 1],
                },
                {
                  path: "src/lib/index.test.ts",
                  name: "index.test.ts",
                  kind: "file" as const,
                  score: 0.6,
                  highlights: [0, 1],
                },
              ]
            : [
                {
                  path: `src/${query}.ts`,
                  name: `${query}.ts`,
                  kind: "file" as const,
                  score: 1,
                  highlights: [0],
                },
              ],
        totalMatchedCount: query === "index" ? 2 : 1,
      }),
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onSearchQueryChange("index");
    });

    await waitFor(() => {
      expect(result.current.searchResult?.items.length).toBe(2);
    });
    expect(result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(true);

    act(() => {
      result.current.onSearchMove(1);
    });
    await waitFor(() => {
      expect(result.current.searchActiveIndex).toBe(1);
    });
    act(() => {
      result.current.onSearchConfirm();
    });

    expect(result.current.selectedFilePath).toBe("src/lib/index.test.ts");

    act(() => {
      result.current.onSearchQueryChange("other");
    });
    await waitFor(() => {
      expect(result.current.searchResult?.query).toBe("other");
    });
    expect(result.current.searchActiveIndex).toBe(0);
  });

  it("on search confirm does not open file modal for directory matches", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async () =>
      createSearchPage({
        query: "src",
        items: [{ path: "src", name: "src", kind: "directory", score: 1, highlights: [0, 1, 2] }],
        totalMatchedCount: 1,
      }),
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onSearchQueryChange("src");
    });

    await waitFor(() => {
      expect(result.current.searchResult?.items.length).toBe(1);
    });

    act(() => {
      result.current.onSearchConfirm();
    });

    expect(result.current.selectedFilePath).toBeNull();
    expect(result.current.fileModalOpen).toBe(false);
  });

  it("resets local state when paneId changes", async () => {
    const requestRepoFileTree = vi.fn(async () =>
      createTreePage({
        basePath: ".",
        entries: [{ path: "src/file.ts", name: "file.ts", kind: "file" }],
      }),
    );
    const requestRepoFileSearch = vi.fn(async () =>
      createSearchPage({
        query: "file",
        items: [{ path: "src/file.ts", name: "file.ts", kind: "file", score: 1, highlights: [0] }],
        totalMatchedCount: 1,
      }),
    );

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionFiles({
          paneId,
          repoRoot: "/repo",
          autoExpandMatchLimit: 100,
          requestRepoFileTree,
          requestRepoFileSearch,
          requestRepoFileContent,
        }),
      { initialProps: { paneId: "pane-1" } },
    );

    act(() => {
      result.current.onSelectFile("src/file.ts");
      result.current.onSearchQueryChange("file");
    });

    await waitFor(() => {
      expect(result.current.searchResult?.query).toBe("file");
    });
    expect(result.current.selectedFilePath).toBe("src/file.ts");

    rerender({ paneId: "pane-2" });

    await waitFor(() => {
      expect(result.current.searchQuery).toBe("");
    });
    expect(result.current.selectedFilePath).toBeNull();
  });

  it("loads non-root directory incrementally via load more action", async () => {
    const requestRepoFileTree = vi.fn(
      async (
        _paneId: string,
        options?: {
          path?: string;
          cursor?: string;
        },
      ) => {
        if (!options?.path) {
          return createTreePage({
            basePath: ".",
            entries: [{ path: "src", name: "src", kind: "directory", hasChildren: true }],
          });
        }
        if (options.path === "src" && !options.cursor) {
          return createTreePage({
            basePath: "src",
            entries: [{ path: "src/a.ts", name: "a.ts", kind: "file" }],
            nextCursor: "cursor-1",
          });
        }
        if (options.path === "src" && options.cursor === "cursor-1") {
          return createTreePage({
            basePath: "src",
            entries: [{ path: "src/b.ts", name: "b.ts", kind: "file" }],
          });
        }
        return createTreePage({ basePath: options?.path ?? "." });
      },
    );
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src")).toBe(true);
    });

    act(() => {
      result.current.onToggleDirectory("src");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/a.ts")).toBe(true);
    });
    expect(result.current.treeNodes.some((node) => node.path === "src/b.ts")).toBe(false);
    expect(result.current.rootTreeHasMore).toBe(true);

    act(() => {
      result.current.onLoadMoreTreeRoot();
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/b.ts")).toBe(true);
    });

    expect(requestRepoFileTree).toHaveBeenCalledWith("pane-1", {
      path: "src",
      cursor: undefined,
      limit: 200,
    });
    expect(requestRepoFileTree).toHaveBeenCalledWith("pane-1", {
      path: "src",
      cursor: "cursor-1",
      limit: 200,
    });
  });

  it("loads remaining ancestor pages when selecting a file under partially loaded directory", async () => {
    const requestRepoFileTree = vi.fn(
      async (
        _paneId: string,
        options?: {
          path?: string;
          cursor?: string;
        },
      ) => {
        if (!options?.path) {
          return createTreePage({
            basePath: ".",
            entries: [{ path: "src", name: "src", kind: "directory", hasChildren: true }],
          });
        }
        if (options.path === "src" && !options.cursor) {
          return createTreePage({
            basePath: "src",
            entries: [{ path: "src/a.ts", name: "a.ts", kind: "file" }],
            nextCursor: "cursor-1",
          });
        }
        if (options.path === "src" && options.cursor === "cursor-1") {
          return createTreePage({
            basePath: "src",
            entries: [{ path: "src/b.ts", name: "b.ts", kind: "file" }],
          });
        }
        return createTreePage({ basePath: options?.path ?? "." });
      },
    );
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src")).toBe(true);
    });

    act(() => {
      result.current.onToggleDirectory("src");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/a.ts")).toBe(true);
    });
    expect(result.current.treeNodes.some((node) => node.path === "src/b.ts")).toBe(false);

    act(() => {
      result.current.onSelectFile("src/b.ts");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/b.ts")).toBe(true);
    });
  });

  it("ignores stale tree responses after paneId changes", async () => {
    const pane1Root = createDeferred<RepoFileTreePage>();
    const pane2Root = createDeferred<RepoFileTreePage>();

    const requestRepoFileTree = vi.fn((paneId: string, options?: { path?: string }) => {
      if (options?.path) {
        return Promise.resolve(createTreePage({ basePath: options.path, entries: [] }));
      }
      if (paneId === "pane-1") {
        return pane1Root.promise;
      }
      return pane2Root.promise;
    });
    const requestRepoFileSearch = vi.fn();

    const { result, rerender } = renderHook(
      ({ paneId }) =>
        useSessionFiles({
          paneId,
          repoRoot: "/repo",
          autoExpandMatchLimit: 100,
          requestRepoFileTree,
          requestRepoFileSearch,
          requestRepoFileContent,
        }),
      { initialProps: { paneId: "pane-1" } },
    );

    await waitFor(() => {
      expect(requestRepoFileTree).toHaveBeenCalledWith("pane-1", {
        path: undefined,
        cursor: undefined,
        limit: 200,
      });
    });

    rerender({ paneId: "pane-2" });

    await waitFor(() => {
      expect(requestRepoFileTree).toHaveBeenCalledWith("pane-2", {
        path: undefined,
        cursor: undefined,
        limit: 200,
      });
    });

    await act(async () => {
      pane1Root.resolve(
        createTreePage({
          basePath: ".",
          entries: [{ path: "stale.ts", name: "stale.ts", kind: "file" }],
        }),
      );
      pane2Root.resolve(
        createTreePage({
          basePath: ".",
          entries: [{ path: "fresh.ts", name: "fresh.ts", kind: "file" }],
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "fresh.ts")).toBe(true);
    });
    expect(result.current.treeNodes.some((node) => node.path === "stale.ts")).toBe(false);
  });

  it("applies manual collapse/expand on directories in search mode", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async () =>
      createSearchPage({
        query: "index",
        items: [
          {
            path: "src/app/index.ts",
            name: "index.ts",
            kind: "file",
            score: 0.9,
            highlights: [0, 1],
          },
        ],
        totalMatchedCount: 1,
      }),
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onSearchQueryChange("index");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(true);
    });

    act(() => {
      result.current.onToggleDirectory("src/app");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(false);
    });

    act(() => {
      result.current.onToggleDirectory("src/app");
    });

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(true);
    });
  });

  it("ignores stale search response while waiting for next debounce", async () => {
    vi.useFakeTimers();

    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const aDeferred = createDeferred<RepoFileSearchPage>();
    const abDeferred = createDeferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn((_: string, query: string) => {
      if (query === "a") {
        return aDeferred.promise;
      }
      return abDeferred.promise;
    });

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onSearchQueryChange("a");
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    act(() => {
      result.current.onSearchQueryChange("ab");
    });

    await act(async () => {
      aDeferred.resolve(
        createSearchPage({
          query: "a",
          items: [{ path: "a.ts", name: "a.ts", kind: "file", score: 0.5, highlights: [0] }],
          totalMatchedCount: 1,
        }),
      );
      await Promise.resolve();
    });

    expect(result.current.searchResult).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    await act(async () => {
      abDeferred.resolve(
        createSearchPage({
          query: "ab",
          items: [{ path: "ab.ts", name: "ab.ts", kind: "file", score: 0.9, highlights: [0, 1] }],
          totalMatchedCount: 1,
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.searchResult?.query).toBe("ab");
    expect(result.current.treeNodes.some((node) => node.path === "ab.ts")).toBe(true);
    expect(result.current.treeNodes.some((node) => node.path === "a.ts")).toBe(false);
  });

  it("does not duplicate items when load more search is triggered multiple times", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const secondPage = createDeferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn(
      async (
        _paneId: string,
        query: string,
        options?: {
          cursor?: string;
          limit?: number;
        },
      ) => {
        if (query === "index" && !options?.cursor) {
          return createSearchPage({
            query: "index",
            items: [
              {
                path: "src/index.ts",
                name: "index.ts",
                kind: "file",
                score: 1,
                highlights: [0, 1],
              },
            ],
            totalMatchedCount: 2,
            truncated: true,
            nextCursor: "cursor-1",
          });
        }
        return secondPage.promise;
      },
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onSearchQueryChange("index");
    });

    await waitFor(() => {
      expect(result.current.searchResult?.items.length).toBe(1);
      expect(result.current.searchHasMore).toBe(true);
    });

    act(() => {
      result.current.onLoadMoreSearch();
      result.current.onLoadMoreSearch();
    });

    await act(async () => {
      secondPage.resolve(
        createSearchPage({
          query: "index",
          items: [
            {
              path: "src/index.test.ts",
              name: "index.test.ts",
              kind: "file",
              score: 0.8,
              highlights: [0],
            },
          ],
          totalMatchedCount: 2,
          truncated: false,
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.searchResult?.items.length).toBe(2);
    });
    expect(
      result.current.searchResult?.items.filter((item) => item.path === "src/index.test.ts").length,
    ).toBe(1);
  });

  it("opens file modal and loads file content", async () => {
    const requestRepoFileTree = vi.fn(async () =>
      createTreePage({
        basePath: ".",
        entries: [{ path: "README.md", name: "README.md", kind: "file" }],
      }),
    );
    const requestRepoFileSearch = vi.fn();
    const requestRepoFileContentLocal = vi.fn(async () => ({
      path: "README.md",
      sizeBytes: 42,
      isBinary: false,
      truncated: false,
      languageHint: "markdown" as const,
      content: "# hello\n",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await waitFor(() => {
      expect(result.current.treeNodes.some((node) => node.path === "README.md")).toBe(true);
    });

    act(() => {
      result.current.onSelectFile("README.md");
      result.current.onOpenFileModal("README.md");
    });

    await waitFor(() => {
      expect(result.current.fileModalOpen).toBe(true);
      expect(result.current.fileModalLoading).toBe(false);
      expect(result.current.fileModalFile?.path).toBe("README.md");
    });
    expect(result.current.fileModalMarkdownViewMode).toBe("preview");
    expect(requestRepoFileContentLocal).toHaveBeenCalledWith("pane-1", "README.md", {
      maxBytes: 256 * 1024,
    });
  });

  it("revokes a loaded preview ticket when the modal closes", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();
    const requestRepoFileContentLocal = vi.fn(
      async (): Promise<RepoFileContent> => ({
        path: "preview.html",
        sizeBytes: 42,
        isBinary: false,
        truncated: false,
        languageHint: "html",
        content: "<main>preview</main>",
        preview: {
          token: "preview-token",
          url: "/file-preview/preview-token/r/repo/preview.html",
          mimeType: "text/html",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    act(() => result.current.onOpenFileModal("preview.html"));
    await waitFor(() => expect(result.current.fileModalFile?.preview?.token).toBe("preview-token"));

    act(() => result.current.onCloseFileModal());

    await waitFor(() => {
      expect(revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "preview-token");
    });
  });

  it("ignores stale file content response after modal close", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();
    const deferred = createDeferred<RepoFileContent>();
    const requestRepoFileContentLocal = vi.fn(async () => deferred.promise);

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    act(() => {
      result.current.onOpenFileModal("src/stale.ts");
    });
    expect(result.current.fileModalOpen).toBe(true);

    act(() => {
      result.current.onCloseFileModal();
    });
    expect(result.current.fileModalOpen).toBe(false);

    await act(async () => {
      deferred.resolve({
        path: "src/stale.ts",
        sizeBytes: 10,
        isBinary: false,
        truncated: false,
        languageHint: "typescript",
        content: "const a = 1",
        preview: {
          token: "stale-preview-token",
          url: "/file-preview/stale-preview-token/r/repo/src/stale.ts",
          mimeType: "image/svg+xml",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      });
      await Promise.resolve();
    });

    expect(result.current.fileModalOpen).toBe(false);
    expect(result.current.fileModalFile).toBeNull();
    expect(result.current.fileModalLoading).toBe(false);
    expect(revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "stale-preview-token");
  });

  it("revokes a preview returned after the file navigator unmounts", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();
    const deferred = createDeferred<RepoFileContent>();

    const { result, unmount } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: vi.fn(async () => deferred.promise),
      }),
    );

    act(() => result.current.onOpenFileModal("late.png"));
    unmount();
    await act(async () => {
      deferred.resolve({
        path: "late.png",
        sizeBytes: 10,
        isBinary: true,
        truncated: false,
        languageHint: null,
        content: null,
        preview: {
          token: "unmounted-preview-token",
          url: "/file-preview/unmounted-preview-token/r/repo/late.png",
          mimeType: "image/png",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      });
      await Promise.resolve();
    });

    expect(revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "unmounted-preview-token");
  });

  it("toggles line-number visibility in file modal", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    expect(result.current.fileModalShowLineNumbers).toBe(true);
    act(() => {
      result.current.onToggleFileModalLineNumbers();
    });
    expect(result.current.fileModalShowLineNumbers).toBe(false);
    act(() => {
      result.current.onToggleFileModalLineNumbers();
    });
    expect(result.current.fileModalShowLineNumbers).toBe(true);
  });

  it("resets line-number visibility to default when opening or closing file modal", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-1",
        repoRoot: "/repo",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    act(() => {
      result.current.onToggleFileModalLineNumbers();
    });
    expect(result.current.fileModalShowLineNumbers).toBe(false);

    act(() => {
      result.current.onOpenFileModal("src/reset.ts");
    });
    expect(result.current.fileModalShowLineNumbers).toBe(true);

    act(() => {
      result.current.onToggleFileModalLineNumbers();
      result.current.onCloseFileModal();
    });
    expect(result.current.fileModalShowLineNumbers).toBe(true);
  });

  it("opens file modal directly when log path exists", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => {
      if (query === "apps/web/src/index.ts") {
        return createSearchPage({
          query,
          items: [
            {
              path: "apps/web/src/index.ts",
              name: "index.ts",
              kind: "file",
              score: 1,
              highlights: [0],
            },
          ],
          totalMatchedCount: 1,
        });
      }
      return createSearchPage({ query, items: [], totalMatchedCount: 0 });
    });
    const requestRepoFileContentLocal = vi.fn(async (paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 100,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: `// ${paneId}:${targetPath}`,
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "apps/web/src/index.ts:12",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalOpen).toBe(true);
      expect(result.current.fileModalPath).toBe("apps/web/src/index.ts");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(result.current.fileModalHighlightLine).toBe(12);
    expect(result.current.selectedFilePath).toBeNull();
    expect(result.current.logFileCandidateModalOpen).toBe(false);
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "apps/web/src/index.ts", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileContentLocal).toHaveBeenCalledWith("pane-log", "apps/web/src/index.ts", {
      maxBytes: 256 * 1024,
    });
  });

  it("opens line-specific HTML log references in code mode while preserving the highlighted line", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => {
      if (query === "apps/web/preview.html") {
        return createSearchPage({
          query,
          items: [
            {
              path: "apps/web/preview.html",
              name: "preview.html",
              kind: "file",
              score: 1,
              highlights: [0],
            },
          ],
          totalMatchedCount: 1,
        });
      }
      return createSearchPage({ query, items: [], totalMatchedCount: 0 });
    });
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 64,
      isBinary: false,
      truncated: false,
      languageHint: "html" as const,
      content: "<!doctype html><main>Preview</main>",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "apps/web/preview.html:7",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalOpen).toBe(true);
      expect(result.current.fileModalPath).toBe("apps/web/preview.html");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(result.current.fileModalHighlightLine).toBe(7);
    expect(result.current.fileModalMarkdownViewMode).toBe("code");
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "apps/web/preview.html", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileContentLocal).toHaveBeenCalledWith("pane-log", "apps/web/preview.html", {
      maxBytes: 256 * 1024,
    });
  });

  it("opens Markdown log references through ignored preview lookup", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => {
      if (query === "docs/notes.md") {
        return createSearchPage({
          query,
          items: [
            {
              path: "docs/notes.md",
              name: "notes.md",
              kind: "file",
              score: 1,
              highlights: [],
              isIgnored: true,
            },
          ],
          totalMatchedCount: 1,
        });
      }
      return createSearchPage({ query, items: [], totalMatchedCount: 0 });
    });
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 32,
      isBinary: false,
      truncated: false,
      languageHint: "markdown" as const,
      content: "# Notes",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "docs/notes.md",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalOpen).toBe(true);
      expect(result.current.fileModalPath).toBe("docs/notes.md");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(result.current.fileModalMarkdownViewMode).toBe("preview");
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "docs/notes.md", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileContentLocal).toHaveBeenCalledWith("pane-log", "docs/notes.md", {
      maxBytes: 256 * 1024,
    });
  });

  it("opens root Markdown filename references through ignored exact lookup", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(
      async (_paneId: string, query: string, options?: { exactReference?: boolean }) => {
        if (query === "README.md" && options?.exactReference) {
          return createSearchPage({
            query,
            items: [
              {
                path: "README.md",
                name: "README.md",
                kind: "file",
                score: 1,
                highlights: [],
                isIgnored: true,
              },
            ],
            totalMatchedCount: 1,
          });
        }
        return createSearchPage({ query, items: [], totalMatchedCount: 0 });
      },
    );
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 32,
      isBinary: false,
      truncated: false,
      languageHint: "markdown" as const,
      content: "# Readme",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "README.md",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalOpen).toBe(true);
      expect(result.current.fileModalPath).toBe("README.md");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(1);
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "README.md", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileContentLocal).toHaveBeenCalledWith("pane-log", "README.md", {
      maxBytes: 256 * 1024,
    });
  });

  it("falls back to exact filename search when path lookup fails and opens the single match", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async () =>
      createSearchPage({
        query: "index.ts",
        items: [
          {
            path: "apps/server/src/index.ts",
            name: "index.ts",
            kind: "file",
            score: 1,
            highlights: [0],
          },
        ],
        totalMatchedCount: 1,
      }),
    );
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 123,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: "export const value = 1;",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "src/index.ts:4",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalPath).toBe("apps/server/src/index.ts");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(result.current.fileModalHighlightLine).toBe(4);
    expect(result.current.fileResolveError).toBeNull();
    expect(result.current.logFileCandidateModalOpen).toBe(false);
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(1, "pane-log", "src/index.ts", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(2, "pane-log", "index.ts", {
      cursor: undefined,
      limit: 100,
    });
  });

  it("does not fall back to a repo basename search for a missing external absolute path", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) =>
      createSearchPage({ query, items: [], totalMatchedCount: 0 }),
    );
    const requestRepoFileContentLocal = vi.fn(requestRepoFileContent);

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "/tmp/generated/image.png:4",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    expect(result.current.fileModalOpen).toBe(false);
    expect(result.current.fileResolveError).toBe("File not found: /tmp/generated/image.png");
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(1);
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "/tmp/generated/image.png", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileContentLocal).not.toHaveBeenCalled();
  });

  it("falls back to filename search when path lookup cursor repeats", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(
      async (_paneId: string, query: string, options?: { cursor?: string; limit?: number }) => {
        if (query === "src/index.ts") {
          return createSearchPage({
            query,
            items: [],
            totalMatchedCount: 0,
            nextCursor: options?.cursor ?? "cursor-1",
          });
        }
        if (query === "index.ts") {
          return createSearchPage({
            query,
            items: [
              {
                path: "apps/server/src/index.ts",
                name: "index.ts",
                kind: "file",
                score: 1,
                highlights: [0],
              },
            ],
            totalMatchedCount: 1,
          });
        }
        return createSearchPage({ query, items: [], totalMatchedCount: 0 });
      },
    );
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 123,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: "export const value = 1;",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "src/index.ts:9",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalPath).toBe("apps/server/src/index.ts");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(result.current.fileModalHighlightLine).toBe(9);
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(1, "pane-log", "src/index.ts", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(2, "pane-log", "src/index.ts", {
      cursor: "cursor-1",
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(3, "pane-log", "index.ts", {
      cursor: undefined,
      limit: 100,
    });
  });

  it("opens candidate modal when multiple exact filename matches are found", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async () =>
      createSearchPage({
        query: "index.ts",
        items: [
          {
            path: "apps/server/src/index.ts",
            name: "index.ts",
            kind: "file",
            score: 0.9,
            highlights: [0],
          },
          {
            path: "apps/web/src/index.ts",
            name: "index.ts",
            kind: "file",
            score: 0.8,
            highlights: [0],
          },
        ],
        totalMatchedCount: 2,
      }),
    );
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 12,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: "export {};",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "src/index.ts:4",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    expect(result.current.logFileCandidateModalOpen).toBe(true);
    expect(result.current.logFileCandidatePaneId).toBe("pane-log");
    expect(result.current.logFileCandidateItems.map((item) => item.path)).toEqual([
      "apps/server/src/index.ts",
      "apps/web/src/index.ts",
    ]);

    act(() => {
      result.current.onSelectLogFileCandidate("apps/web/src/index.ts");
    });

    await waitFor(() => {
      expect(result.current.fileModalPath).toBe("apps/web/src/index.ts");
      expect(result.current.fileModalLoading).toBe(false);
    });
    expect(result.current.fileModalHighlightLine).toBe(4);
    expect(result.current.logFileCandidateModalOpen).toBe(false);
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(1, "pane-log", "src/index.ts", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileSearch).toHaveBeenNthCalledWith(2, "pane-log", "index.ts", {
      cursor: undefined,
      limit: 100,
    });
    expect(requestRepoFileContentLocal).toHaveBeenCalledWith("pane-log", "apps/web/src/index.ts", {
      maxBytes: 256 * 1024,
    });
  });

  it("sets an error when filename search returns no match", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async () =>
      createSearchPage({
        query: "index.ts",
        items: [],
        totalMatchedCount: 0,
      }),
    );
    const requestRepoFileContentLocal = vi.fn(async () => ({
      path: "unused.ts",
      sizeBytes: 0,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: "",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "src/index.ts",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    expect(result.current.fileResolveError).toBe("No file matched: index.ts");
    expect(result.current.fileModalOpen).toBe(false);
  });

  it("ignores stale log-reference resolution results and keeps latest result", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const slowSearch = createDeferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn((_: string, query: string) => {
      if (query === "a.ts") {
        return slowSearch.promise;
      }
      return Promise.resolve(
        createSearchPage({
          query: "b.ts",
          items: [{ path: "src/b.ts", name: "b.ts", kind: "file", score: 1, highlights: [0] }],
          totalMatchedCount: 1,
        }),
      );
    });
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 10,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: `// ${targetPath}`,
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    let firstPromise: Promise<void> | null = null;
    await act(async () => {
      firstPromise = result.current.onResolveLogFileReference({
        rawToken: "src/a.ts",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "src/b.ts",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.fileModalPath).toBe("src/b.ts");
      expect(result.current.fileModalLoading).toBe(false);
    });

    await act(async () => {
      slowSearch.resolve(
        createSearchPage({
          query: "a.ts",
          items: [
            { path: "src/a.ts", name: "a.ts", kind: "file", score: 1, highlights: [0] },
            { path: "src/nested/a.ts", name: "a.ts", kind: "file", score: 0.7, highlights: [0] },
          ],
          totalMatchedCount: 2,
        }),
      );
      await firstPromise;
    });

    expect(result.current.fileModalPath).toBe("src/b.ts");
    expect(result.current.logFileCandidateModalOpen).toBe(false);
  });

  it("returns context-unavailable error when source pane id is blank", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn();

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    await act(async () => {
      await result.current.onResolveLogFileReference({
        rawToken: "src/index.ts",
        sourcePaneId: "  ",
        sourceRepoRoot: "/repo",
      });
    });

    expect(result.current.fileResolveError).toBe("Session context is unavailable.");
    expect(requestRepoFileSearch).not.toHaveBeenCalled();
  });

  it("returns only existing tokens for log-linkify candidate resolution", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => {
      if (query === "src/exists.ts") {
        return createSearchPage({
          query,
          items: [
            {
              path: "src/exists.ts",
              name: "exists.ts",
              kind: "file",
              score: 1,
              highlights: [0],
            },
          ],
          totalMatchedCount: 1,
        });
      }
      if (query === "src/missing.ts" || query === "missing.ts") {
        return createSearchPage({
          query,
          items: [],
          totalMatchedCount: 0,
        });
      }
      if (query === "index.ts") {
        return createSearchPage({
          query,
          items: [
            {
              path: "apps/web/src/index.ts",
              name: "index.ts",
              kind: "file",
              score: 1,
              highlights: [0],
            },
          ],
          totalMatchedCount: 1,
        });
      }
      return createSearchPage({ query, items: [], totalMatchedCount: 0 });
    });
    const requestRepoFileContentLocal = vi.fn(async (_paneId: string, targetPath: string) => ({
      path: targetPath,
      sizeBytes: 12,
      isBinary: false,
      truncated: false,
      languageHint: "typescript" as const,
      content: "export {};",
    }));

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent: requestRepoFileContentLocal,
      }),
    );

    const linkable = await result.current.onResolveLogFileReferenceCandidates({
      rawTokens: ["src/exists.ts:2", "src/missing.ts:1", "index.ts", "https://example.com"],
      sourcePaneId: "pane-log",
      sourceRepoRoot: "/repo",
    });

    expect(linkable).toEqual(["src/exists.ts:2", "index.ts"]);
    expect(requestRepoFileContentLocal).not.toHaveBeenCalled();
  });

  it("treats exact previewable path references as linkable through ignored preview lookup", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(
      async (_paneId: string, query: string, options?: { exactReference?: boolean }) => {
        if (query === "docs/sidebar-collapse-proposals.html" && options?.exactReference) {
          return createSearchPage({
            query,
            items: [
              {
                path: "docs/sidebar-collapse-proposals.html",
                name: "sidebar-collapse-proposals.html",
                kind: "file",
                score: 1,
                highlights: [],
                isIgnored: true,
              },
            ],
            totalMatchedCount: 1,
          });
        }
        if (query === "docs/notes.md" && options?.exactReference) {
          return createSearchPage({
            query,
            items: [
              {
                path: "docs/notes.md",
                name: "notes.md",
                kind: "file",
                score: 1,
                highlights: [],
                isIgnored: true,
              },
            ],
            totalMatchedCount: 1,
          });
        }
        if (query === "index.html" && options?.exactReference) {
          return createSearchPage({
            query,
            items: [
              {
                path: "index.html",
                name: "index.html",
                kind: "file",
                score: 1,
                highlights: [],
                isIgnored: true,
              },
            ],
            totalMatchedCount: 1,
          });
        }
        return createSearchPage({
          query,
          items: [],
          totalMatchedCount: 0,
        });
      },
    );

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    const linkable = await result.current.onResolveLogFileReferenceCandidates({
      rawTokens: ["docs/sidebar-collapse-proposals.html", "docs/notes.md", "index.html:7"],
      sourcePaneId: "pane-log",
      sourceRepoRoot: "/repo",
    });

    expect(linkable).toEqual([
      "docs/sidebar-collapse-proposals.html",
      "docs/notes.md",
      "index.html:7",
    ]);
    expect(requestRepoFileSearch).toHaveBeenCalledWith(
      "pane-log",
      "docs/sidebar-collapse-proposals.html",
      {
        cursor: undefined,
        limit: 100,
        exactReference: true,
      },
    );
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "docs/notes.md", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
    expect(requestRepoFileSearch).toHaveBeenCalledWith("pane-log", "index.html", {
      cursor: undefined,
      limit: 100,
      exactReference: true,
    });
  });

  it("does not cache negative previewable exact linkability results", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    let searchAttemptCount = 0;
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => {
      if (query === "docs/report.html") {
        searchAttemptCount += 1;
        if (searchAttemptCount >= 2) {
          return createSearchPage({
            query,
            items: [
              {
                path: "docs/report.html",
                name: "report.html",
                kind: "file",
                score: 1,
                highlights: [],
                isIgnored: true,
              },
            ],
            totalMatchedCount: 1,
          });
        }
      }
      return createSearchPage({
        query,
        items: [],
        totalMatchedCount: 0,
      });
    });

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    await expect(
      result.current.onResolveLogFileReferenceCandidates({
        rawTokens: ["docs/report.html"],
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      }),
    ).resolves.toEqual([]);
    await expect(
      result.current.onResolveLogFileReferenceCandidates({
        rawTokens: ["docs/report.html"],
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/repo",
      }),
    ).resolves.toEqual(["docs/report.html"]);
    const exactPathSearchCalls = requestRepoFileSearch.mock.calls.filter(
      ([, query]) => query === "docs/report.html",
    );
    expect(exactPathSearchCalls.length).toBe(2);
  });

  it("treats hidden path references as non-linkable when search does not return exact path", async () => {
    const requestRepoFileTree = vi.fn(async () => createTreePage({ basePath: ".", entries: [] }));
    const requestRepoFileSearch = vi.fn(async (_paneId: string, query: string) => {
      if (query === "build/output.txt") {
        return createSearchPage({
          query,
          items: [
            {
              path: "build/output.txt",
              name: "output.txt",
              kind: "file",
              score: 1,
              highlights: [0],
            },
          ],
          totalMatchedCount: 1,
        });
      }
      return createSearchPage({
        query,
        items: [],
        totalMatchedCount: 0,
      });
    });

    const { result } = renderHook(() =>
      useSessionFiles({
        paneId: "pane-current",
        repoRoot: "/repo-current",
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
      }),
    );

    const linkable = await result.current.onResolveLogFileReferenceCandidates({
      rawTokens: ["build/output.txt:12", "build/hidden.txt:4"],
      sourcePaneId: "pane-log",
      sourceRepoRoot: "/repo",
    });

    expect(linkable).toEqual(["build/output.txt:12"]);
  });
});
