import { QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RepoFileContent, RepoFileSearchPage, RepoFileTreePage } from "@vde-monitor/shared";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { createAppQueryClient } from "@/state/query-client";

import { sessionDetailQueryKeys } from "../session-detail-query-keys";
import { type UseSessionFilesParams, useSessionFiles } from "./useSessionFiles";

vi.mock("@/lib/copy-to-clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));

type HookProps = Pick<UseSessionFilesParams, "connected" | "paneId" | "repoRoot" | "worktreePath">;

const treePage = (basePath = ".", overrides: Partial<RepoFileTreePage> = {}) => ({
  basePath,
  entries: [],
  ...overrides,
});
const searchPage = (query: string, overrides: Partial<RepoFileSearchPage> = {}) => ({
  query,
  items: [],
  truncated: false,
  totalMatchedCount: 0,
  ...overrides,
});
const fileContent = (path: string, overrides: Partial<RepoFileContent> = {}): RepoFileContent => ({
  path,
  sizeBytes: 1,
  isBinary: false,
  truncated: false,
  languageHint: "text",
  content: "content",
  ...overrides,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const renderFiles = ({
  strict = false,
  queryClient = createAppQueryClient(),
  initialProps = {},
  requestRepoFileTree = vi.fn<UseSessionFilesParams["requestRepoFileTree"]>(
    async (_pane, options) => treePage(options?.path ?? "."),
  ),
  requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
    async (_pane, query) => searchPage(query),
  ),
  requestRepoFileContent = vi.fn<UseSessionFilesParams["requestRepoFileContent"]>(
    async (_pane, path) => fileContent(path),
  ),
  revokeRepoFilePreview = vi.fn(async () => undefined),
}: {
  strict?: boolean;
  queryClient?: ReturnType<typeof createAppQueryClient>;
  initialProps?: Partial<HookProps>;
  requestRepoFileTree?: UseSessionFilesParams["requestRepoFileTree"];
  requestRepoFileSearch?: UseSessionFilesParams["requestRepoFileSearch"];
  requestRepoFileContent?: UseSessionFilesParams["requestRepoFileContent"];
  revokeRepoFilePreview?: UseSessionFilesParams["revokeRepoFilePreview"];
} = {}) => {
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const provider = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{provider}</StrictMode> : provider;
  };
  const rendered = renderHook(
    (props: HookProps) =>
      useSessionFiles({
        ...props,
        autoExpandMatchLimit: 100,
        requestRepoFileTree,
        requestRepoFileSearch,
        requestRepoFileContent,
        revokeRepoFilePreview,
      }),
    {
      wrapper: Wrapper,
      initialProps: {
        paneId: "pane-1",
        repoRoot: "/repo",
        worktreePath: null,
        connected: true,
        ...initialProps,
      },
    },
  );
  return {
    ...rendered,
    queryClient,
    requestRepoFileTree,
    requestRepoFileSearch,
    requestRepoFileContent,
    revokeRepoFilePreview,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

describe("useSessionFiles Query resources", () => {
  it("loads the root with the resolved root override and forwards AbortSignal", async () => {
    let signal: AbortSignal | undefined;
    const requestRepoFileTree = vi.fn<UseSessionFilesParams["requestRepoFileTree"]>(
      async (_pane, _options, requestSignal) => {
        signal = requestSignal;
        return treePage(".", {
          entries: [{ path: "README.md", name: "README.md", kind: "file" }],
        });
      },
    );
    const { result, queryClient } = renderFiles({ requestRepoFileTree });
    await waitFor(() => expect(result.current.treeNodes).toHaveLength(1));

    expect(requestRepoFileTree).toHaveBeenCalledWith(
      "pane-1",
      { limit: 200, worktreePath: "/repo" },
      expect.any(AbortSignal),
    );
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(
      queryClient.getQueryData(
        sessionDetailQueryKeys.filesTree("pane-1", {
          resolvedRoot: "/repo",
          worktreePath: null,
          path: ".",
          cursor: null,
          limit: 200,
        }),
      ),
    ).toEqual(expect.objectContaining({ basePath: "." }));
  });

  it("keeps a cold descriptor disconnected and requests once on reconnect", async () => {
    const rendered = renderFiles({ initialProps: { connected: false } });
    expect(rendered.requestRepoFileTree).not.toHaveBeenCalled();
    expect(rendered.result.current.treeLoading).toBe(false);
    expect(rendered.result.current.treeError).toContain("Disconnected");

    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: true,
    });
    await waitFor(() => expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(1));
  });

  it("pauses cold resources offline without a spinner and resumes once online", async () => {
    onlineManager.setOnline(false);
    const rendered = renderFiles();
    await waitFor(() => expect(rendered.result.current.treeError).toContain("Offline"));
    expect(rendered.result.current.treeLoading).toBe(false);
    expect(rendered.requestRepoFileTree).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(1));
  });

  it("resumes cold search and content exactly once after coming online", async () => {
    vi.useFakeTimers();
    onlineManager.setOnline(false);
    const rendered = renderFiles();
    act(() => {
      rendered.result.current.onSearchQueryChange("index");
      rendered.result.current.onOpenFileModal("index.ts");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();
    expect(rendered.requestRepoFileContent).not.toHaveBeenCalled();
    expect(rendered.result.current.searchLoading).toBe(false);
    expect(rendered.result.current.searchError).toContain("Offline");
    expect(rendered.result.current.fileModalLoading).toBe(false);
    expect(rendered.result.current.fileModalError).toContain("Offline");

    act(() => onlineManager.setOnline(true));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1);
  });

  it("loads an expanded child and coalesces repeated load-more actions", async () => {
    const tail = deferred<RepoFileTreePage>();
    const requestRepoFileTree = vi.fn<UseSessionFilesParams["requestRepoFileTree"]>(
      async (_pane, options) => {
        if (options?.path === "src" && options.cursor === "next") return tail.promise;
        if (options?.path === "src") {
          return treePage("src", {
            entries: [{ path: "src/a.ts", name: "a.ts", kind: "file" }],
            nextCursor: "next",
          });
        }
        return treePage(".", {
          entries: [{ path: "src", name: "src", kind: "directory", hasChildren: true }],
        });
      },
    );
    const { result } = renderFiles({ requestRepoFileTree });
    await waitFor(() => expect(result.current.treeNodes).toHaveLength(1));
    act(() => result.current.onToggleDirectory("src"));
    await waitFor(() =>
      expect(result.current.treeNodes.some((node) => node.path === "src/a.ts")).toBe(true),
    );
    act(() => {
      result.current.onLoadMoreTreeRoot();
      result.current.onLoadMoreTreeRoot();
    });
    await waitFor(() =>
      expect(
        requestRepoFileTree.mock.calls.filter(([, options]) => options?.cursor === "next"),
      ).toHaveLength(1),
    );
    tail.resolve(treePage("src", { entries: [] }));
  });

  it("debounces search at 120ms and keeps normalized-equivalent input stable", async () => {
    vi.useFakeTimers();
    const { result, requestRepoFileSearch } = renderFiles();
    act(() => result.current.onSearchQueryChange(" index "));
    await act(async () => vi.advanceTimersByTimeAsync(119));
    expect(requestRepoFileSearch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(1);
    await act(async () => Promise.resolve());
    act(() => result.current.onSearchQueryChange("index"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(1);
  });

  it.each([{ paneId: "pane-2" }, { repoRoot: "/other-repo" }, { worktreePath: "/other-worktree" }])(
    "cancels a pending search debounce when scope changes: %o",
    async (nextScope) => {
      vi.useFakeTimers();
      const rendered = renderFiles({ strict: true });
      act(() => rendered.result.current.onSearchQueryChange("old"));
      await act(async () => vi.advanceTimersByTimeAsync(119));
      rendered.rerender({
        paneId: "pane-1",
        repoRoot: "/repo",
        worktreePath: null,
        connected: true,
        ...nextScope,
      });
      await act(async () => vi.advanceTimersByTimeAsync(120));
      expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();
      expect(rendered.result.current.searchQuery).toBe("");
      expect(rendered.result.current.searchResult).toBeNull();
      act(() => rendered.result.current.onSearchQueryChange("new"));
      await act(async () => vi.advanceTimersByTimeAsync(120));
      expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);
      expect(rendered.requestRepoFileSearch).toHaveBeenLastCalledWith(
        nextScope.paneId ?? "pane-1",
        "new",
        expect.objectContaining({ worktreePath: nextScope.repoRoot ?? "/repo" }),
        expect.any(AbortSignal),
      );
    },
  );

  it("cancels a pending search debounce on unmount", async () => {
    vi.useFakeTimers();
    const rendered = renderFiles();
    act(() => rendered.result.current.onSearchQueryChange("old"));
    rendered.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();
  });

  it("keeps displayed A while desired B is pending and switches only after B succeeds", async () => {
    vi.useFakeTimers();
    const pendingB = deferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        query === "b"
          ? pendingB.promise
          : searchPage(query, {
              items: [{ path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }],
            }),
    );
    const { result } = renderFiles({ requestRepoFileSearch });
    act(() => result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.searchResult?.query).toBe("a");
    act(() => result.current.onSearchQueryChange("b"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(result.current.searchResult?.query).toBe("a");
    pendingB.resolve(
      searchPage("b", {
        items: [{ path: "b.ts", name: "b.ts", kind: "file", score: 1, highlights: [] }],
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.searchResult?.query).toBe("b");
  });

  it("clears desired and displayed search immediately", async () => {
    vi.useFakeTimers();
    const { result } = renderFiles();
    act(() => result.current.onSearchQueryChange("index"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => Promise.resolve());
    act(() => result.current.onSearchQueryChange(""));
    expect(result.current.searchResult).toBeNull();
    expect(result.current.searchLoading).toBe(false);
    expect(result.current.searchError).toBeNull();
  });

  it("binds content to its target root and close-reopen performs a fresh request", async () => {
    const { result, requestRepoFileContent } = renderFiles();
    act(() => result.current.onOpenFileModal("README.md"));
    await waitFor(() => expect(result.current.fileModalFile?.path).toBe("README.md"));
    expect(requestRepoFileContent).toHaveBeenCalledWith(
      "pane-1",
      "README.md",
      { maxBytes: 256 * 1024, worktreePath: "/repo" },
      expect.any(AbortSignal),
    );
    act(() => result.current.onCloseFileModal());
    await act(async () => Promise.resolve());
    act(() => result.current.onOpenFileModal("README.md"));
    await waitFor(() => expect(requestRepoFileContent).toHaveBeenCalledTimes(2));
  });

  it("releases a preview token exactly once on close", async () => {
    const revokeRepoFilePreview = vi.fn(async () => undefined);
    const requestRepoFileContent = vi.fn<UseSessionFilesParams["requestRepoFileContent"]>(
      async (_pane, path) =>
        fileContent(path, {
          preview: { token: "preview-1", url: "/preview", mimeType: "image/png", expiresAt: "x" },
        }),
    );
    const { result } = renderFiles({ requestRepoFileContent, revokeRepoFilePreview });
    act(() => result.current.onOpenFileModal("image.png"));
    await waitFor(() => expect(result.current.fileModalFile).not.toBeNull());
    act(() => result.current.onCloseFileModal());
    await waitFor(() => expect(revokeRepoFilePreview).toHaveBeenCalledTimes(1));
    expect(revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "preview-1");
  });

  it("does not revoke a live preview during StrictMode replay", async () => {
    const revokeRepoFilePreview = vi.fn(async () => undefined);
    const requestRepoFileContent = vi.fn<UseSessionFilesParams["requestRepoFileContent"]>(
      async (_pane, path) =>
        fileContent(path, {
          preview: { token: "preview-1", url: "/preview", mimeType: "image/png", expiresAt: "x" },
        }),
    );
    const rendered = renderFiles({ strict: true, requestRepoFileContent, revokeRepoFilePreview });
    act(() => rendered.result.current.onOpenFileModal("image.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    expect(revokeRepoFilePreview).not.toHaveBeenCalled();
    rendered.unmount();
    await waitFor(() => expect(revokeRepoFilePreview).toHaveBeenCalledTimes(1));
  });

  it("keeps warm content across disconnect without refetching on reconnect", async () => {
    const rendered = renderFiles();
    act(() => rendered.result.current.onOpenFileModal("README.md"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    expect(rendered.result.current.fileModalFile?.path).toBe("README.md");
    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: true,
    });
    await act(async () => Promise.resolve());
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1);
  });

  it("keeps exactly one observer per active tree and content descriptor with fixed options", async () => {
    const rendered = renderFiles({ strict: true });
    await waitFor(() => expect(rendered.result.current.treeLoading).toBe(false));
    const treeQuery = rendered.queryClient.getQueryCache().find({
      queryKey: sessionDetailQueryKeys.filesTree("pane-1", {
        resolvedRoot: "/repo",
        worktreePath: null,
        path: ".",
        cursor: null,
        limit: 200,
      }),
      exact: true,
    });
    expect(treeQuery?.getObserversCount()).toBe(1);
    expect(treeQuery?.options).toMatchObject({
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
      networkMode: "online",
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });

    act(() => rendered.result.current.onOpenFileModal("README.md"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    const contentQuery = rendered.queryClient.getQueryCache().find({
      queryKey: sessionDetailQueryKeys.filesContent(
        "pane-1",
        { resolvedRoot: "/repo", worktreePath: null },
        {
          targetPaneId: "pane-1",
          targetRoot: "/repo",
          targetWorktreePath: null,
          path: "README.md",
          maxBytes: 256 * 1024,
        },
      ),
      exact: true,
    });
    expect(contentQuery?.getObserversCount()).toBe(1);
    expect(contentQuery?.options).toMatchObject({ staleTime: Infinity, gcTime: 0, retry: false });
  });

  it("aborts tree and content signals on disconnect without surfacing cancellation", async () => {
    const treePending = deferred<RepoFileTreePage>();
    const contentPending = deferred<RepoFileContent>();
    let treeSignal: AbortSignal | undefined;
    let contentSignal: AbortSignal | undefined;
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async (_pane, _options, signal) => {
        treeSignal = signal;
        return treePending.promise;
      }),
      requestRepoFileContent: vi.fn(async (_pane, _path, _options, signal) => {
        contentSignal = signal;
        return contentPending.promise;
      }),
    });
    await waitFor(() => expect(treeSignal).toBeInstanceOf(AbortSignal));
    act(() => rendered.result.current.onOpenFileModal("README.md"));
    await waitFor(() => expect(contentSignal).toBeInstanceOf(AbortSignal));
    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    await waitFor(() => {
      expect(treeSignal?.aborted).toBe(true);
      expect(contentSignal?.aborted).toBe(true);
    });
    expect(rendered.result.current.treeError).toContain("Disconnected");
    expect(rendered.result.current.fileModalError).toContain("Disconnected");
  });

  it("rejects tree, search, and content payload identity mismatches", async () => {
    vi.useFakeTimers();
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async () => treePage("other")),
      requestRepoFileSearch: vi.fn(async () => searchPage("other")),
      requestRepoFileContent: vi.fn(async () => fileContent("other.ts")),
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.treeNodes).toEqual([]);
    expect(rendered.result.current.treeError).not.toBeNull();
    act(() => rendered.result.current.onSearchQueryChange("expected"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.searchResult).toBeNull();
    expect(rendered.result.current.searchError).not.toBeNull();
    act(() => rendered.result.current.onOpenFileModal("expected.ts"));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.fileModalFile).toBeNull();
    expect(rendered.result.current.fileModalError).not.toBeNull();
  });

  it("uses sourceRepoRoot for external lookup and content without owner fallback", async () => {
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        searchPage(query, {
          items: [{ path: "src/a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }],
        }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "src/a.ts",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/external",
      }),
    );
    await waitFor(() => expect(rendered.result.current.fileModalPath).toBe("src/a.ts"));
    expect(requestRepoFileSearch).toHaveBeenCalledWith(
      "pane-log",
      "src/a.ts",
      expect.objectContaining({ worktreePath: "/external", exactReference: true }),
      expect.any(AbortSignal),
    );
    expect(rendered.requestRepoFileContent).toHaveBeenCalledWith(
      "pane-log",
      "src/a.ts",
      expect.objectContaining({ worktreePath: "/external" }),
      expect.any(AbortSignal),
    );
  });

  it("starts no external lookup when sourceRepoRoot is missing", async () => {
    const rendered = renderFiles();
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "src/a.ts",
        sourcePaneId: "pane-log",
        sourceRepoRoot: null,
      }),
    );
    expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();
    expect(rendered.result.current.fileResolveError).toBe("Session context is unavailable.");
  });

  it("starts no external lookup when sourcePaneId is blank", async () => {
    const rendered = renderFiles();
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "src/a.ts",
        sourcePaneId: "  ",
        sourceRepoRoot: "/external",
      }),
    );
    expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();
    expect(rendered.result.current.fileResolveError).toBe("Session context is unavailable.");
  });

  it("treats a repeated lookup cursor as incomplete and never opens a candidate", async () => {
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) => searchPage(query, { nextCursor: "repeat" }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "a.ts",
        sourcePaneId: "pane-log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(rendered.result.current.fileModalOpen).toBe(false);
    expect(rendered.result.current.logFileCandidateModalOpen).toBe(false);
    expect(rendered.result.current.fileResolveError).toContain("incomplete");
  });

  it("manually refreshes the root and only the active desired search head", async () => {
    vi.useFakeTimers();
    const rendered = renderFiles();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(1);
    act(() => rendered.result.current.onRefresh());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(2);
    expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();

    act(() => rendered.result.current.onSearchQueryChange("index"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);
    act(() => rendered.result.current.onRefresh());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(2);
  });

  it("moves and confirms file search selection while directory confirmation only toggles", async () => {
    vi.useFakeTimers();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        searchPage(query, {
          items: [
            { path: "src", name: "src", kind: "directory", score: 2, highlights: [] },
            { path: "src/a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] },
          ],
          totalMatchedCount: 2,
        }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    act(() => rendered.result.current.onSearchQueryChange("src"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchConfirm());
    expect(rendered.result.current.fileModalOpen).toBe(false);
    act(() => rendered.result.current.onSearchMove(1));
    act(() => rendered.result.current.onSearchConfirm());
    expect(rendered.result.current.selectedFilePath).toBe("src/a.ts");
    expect(rendered.result.current.fileModalPath).toBe("src/a.ts");
  });

  it("manually collapses and re-expands directory ancestors in search mode", async () => {
    vi.useFakeTimers();
    const rendered = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query) =>
        searchPage(query, {
          items: [
            {
              path: "src/app/index.ts",
              name: "index.ts",
              kind: "file",
              score: 1,
              highlights: [],
            },
          ],
          totalMatchedCount: 1,
        }),
      ),
    });
    act(() => rendered.result.current.onSearchQueryChange("index"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(
      true,
    );
    act(() => rendered.result.current.onToggleDirectory("src/app"));
    expect(rendered.result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(
      false,
    );
    act(() => rendered.result.current.onToggleDirectory("src/app"));
    expect(rendered.result.current.treeNodes.some((node) => node.path === "src/app/index.ts")).toBe(
      true,
    );
  });

  it("resets selection and search and ignores a stale tree response on pane change", async () => {
    const paneA = deferred<RepoFileTreePage>();
    const requestRepoFileTree = vi.fn<UseSessionFilesParams["requestRepoFileTree"]>(
      async (pane, options) =>
        pane === "pane-1" && options?.path == null
          ? paneA.promise
          : treePage(options?.path ?? ".", {
              entries: [{ path: "fresh.ts", name: "fresh.ts", kind: "file" }],
            }),
    );
    const rendered = renderFiles({ requestRepoFileTree });
    act(() => {
      rendered.result.current.onSelectFile("old.ts");
      rendered.result.current.onSearchQueryChange("old");
    });
    rendered.rerender({
      paneId: "pane-2",
      repoRoot: "/repo",
      worktreePath: null,
      connected: true,
    });
    await waitFor(() => expect(rendered.result.current.searchQuery).toBe(""));
    expect(rendered.result.current.selectedFilePath).toBeNull();
    paneA.resolve(
      treePage(".", { entries: [{ path: "stale.ts", name: "stale.ts", kind: "file" }] }),
    );
    await waitFor(() =>
      expect(rendered.result.current.treeNodes.some((node) => node.path === "fresh.ts")).toBe(true),
    );
    expect(rendered.result.current.treeNodes.some((node) => node.path === "stale.ts")).toBe(false);
  });

  it("loads all remaining ancestor pages when revealing a selected file", async () => {
    const requestRepoFileTree = vi.fn<UseSessionFilesParams["requestRepoFileTree"]>(
      async (_pane, options) => {
        if (options?.path !== "src") {
          return treePage(".", {
            entries: [{ path: "src", name: "src", kind: "directory", hasChildren: true }],
          });
        }
        if (options.cursor === "tail") {
          return treePage("src", {
            entries: [{ path: "src/b.ts", name: "b.ts", kind: "file" }],
          });
        }
        return treePage("src", {
          entries: [{ path: "src/a.ts", name: "a.ts", kind: "file" }],
          nextCursor: "tail",
        });
      },
    );
    const rendered = renderFiles({ requestRepoFileTree });
    await waitFor(() => expect(rendered.result.current.treeNodes).toHaveLength(1));
    act(() => rendered.result.current.onSelectFile("src/a.ts"));
    await waitFor(() =>
      expect(rendered.result.current.treeNodes.some((node) => node.path === "src/b.ts")).toBe(true),
    );
    expect(
      requestRepoFileTree.mock.calls.filter(([, options]) => options?.path === "src"),
    ).toHaveLength(2);
  });

  it("paginates search once and deduplicates merged paths", async () => {
    const tail = deferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query, options) =>
        options?.cursor === "tail"
          ? tail.promise
          : searchPage(query, {
              items: [{ path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }],
              nextCursor: "tail",
              truncated: true,
              totalMatchedCount: 2,
            }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    act(() => rendered.result.current.onSearchQueryChange("a"));
    await waitFor(() => expect(rendered.result.current.searchHasMore).toBe(true));
    act(() => {
      rendered.result.current.onLoadMoreSearch();
      rendered.result.current.onLoadMoreSearch();
    });
    await waitFor(() => expect(requestRepoFileSearch).toHaveBeenCalledTimes(2));
    tail.resolve(
      searchPage("a", {
        items: [
          { path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] },
          { path: "b.ts", name: "b.ts", kind: "file", score: 0.5, highlights: [] },
        ],
        totalMatchedCount: 2,
      }),
    );
    await waitFor(() =>
      expect(rendered.result.current.searchResult?.items.map((item) => item.path)).toEqual([
        "a.ts",
        "b.ts",
      ]),
    );
  });

  it("drops late content after close and unmount and revokes returned previews", async () => {
    const first = deferred<RepoFileContent>();
    const second = deferred<RepoFileContent>();
    const requestRepoFileContent = vi
      .fn<UseSessionFilesParams["requestRepoFileContent"]>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const rendered = renderFiles({ requestRepoFileContent });
    act(() => rendered.result.current.onOpenFileModal("late-a.png"));
    act(() => rendered.result.current.onCloseFileModal());
    first.resolve(
      fileContent("late-a.png", {
        preview: { token: "late-a", url: "/a", mimeType: "image/png", expiresAt: "x" },
      }),
    );
    await waitFor(() =>
      expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "late-a"),
    );
    expect(rendered.result.current.fileModalFile).toBeNull();

    act(() => rendered.result.current.onOpenFileModal("late-b.png"));
    rendered.unmount();
    second.resolve(
      fileContent("late-b.png", {
        preview: { token: "late-b", url: "/b", mimeType: "image/png", expiresAt: "x" },
      }),
    );
    await waitFor(() =>
      expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "late-b"),
    );
  });

  it("resets line numbers on open and close", async () => {
    const rendered = renderFiles();
    act(() => rendered.result.current.onToggleFileModalLineNumbers());
    expect(rendered.result.current.fileModalShowLineNumbers).toBe(false);
    act(() => rendered.result.current.onOpenFileModal("a.ts"));
    expect(rendered.result.current.fileModalShowLineNumbers).toBe(true);
    act(() => rendered.result.current.onToggleFileModalLineNumbers());
    act(() => rendered.result.current.onCloseFileModal());
    expect(rendered.result.current.fileModalShowLineNumbers).toBe(true);
  });

  it("opens exact HTML and Markdown references with the expected view and highlight", async () => {
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        searchPage(query, {
          items: [
            {
              path: query,
              name: query.split("/").at(-1) ?? query,
              kind: "file",
              score: 1,
              highlights: [],
              isIgnored: true,
            },
          ],
          totalMatchedCount: 1,
        }),
    );
    const requestRepoFileContent = vi.fn<UseSessionFilesParams["requestRepoFileContent"]>(
      async (_pane, path) =>
        fileContent(path, { languageHint: path.endsWith(".html") ? "html" : "markdown" }),
    );
    const rendered = renderFiles({ requestRepoFileSearch, requestRepoFileContent });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "preview.html:7",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("preview.html"));
    expect(rendered.result.current.fileModalHighlightLine).toBe(7);
    expect(rendered.result.current.fileModalMarkdownViewMode).toBe("code");
    act(() => rendered.result.current.onCloseFileModal());
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "README.md",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("README.md"));
    expect(rendered.result.current.fileModalMarkdownViewMode).toBe("preview");
  });

  it("falls back to basename, opens a candidate for multiple matches, and reports no match", async () => {
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query, options) => {
        if (options?.exactReference) return searchPage(query);
        if (query === "a.ts") {
          return searchPage(query, {
            items: [
              { path: "src/a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] },
              { path: "test/a.ts", name: "a.ts", kind: "file", score: 0.5, highlights: [] },
            ],
            totalMatchedCount: 2,
          });
        }
        return searchPage(query);
      },
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "a.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(rendered.result.current.logFileCandidateModalOpen).toBe(true);
    expect(rendered.result.current.logFileCandidateItems).toHaveLength(2);
    act(() => rendered.result.current.onSelectLogFileCandidate("src/a.ts"));
    await waitFor(() => expect(rendered.result.current.fileModalPath).toBe("src/a.ts"));
    act(() => rendered.result.current.onCloseFileModal());
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "missing.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(rendered.result.current.fileResolveError).toContain("missing.ts");
  });

  it("opens the single basename fallback match and preserves the requested line", async () => {
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query, options) =>
        options?.exactReference
          ? searchPage(query)
          : searchPage(query, {
              items: [
                {
                  path: "apps/server/index.ts",
                  name: "index.ts",
                  kind: "file",
                  score: 1,
                  highlights: [],
                },
              ],
              totalMatchedCount: 1,
            }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "src/index.ts:4",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    await waitFor(() => expect(rendered.result.current.fileModalPath).toBe("apps/server/index.ts"));
    expect(rendered.result.current.fileModalHighlightLine).toBe(4);
    expect(rendered.result.current.logFileCandidateModalOpen).toBe(false);
  });

  it("checks an external absolute path exactly once without basename fallback", async () => {
    const rendered = renderFiles();
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "/tmp/generated/image.png:4",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(rendered.result.current.fileResolveError).toBe(
      "File not found: /tmp/generated/image.png",
    );
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledWith(
      "log",
      "/tmp/generated/image.png",
      expect.objectContaining({ exactReference: true, worktreePath: "/external" }),
      expect.any(AbortSignal),
    );
    expect(rendered.requestRepoFileContent).not.toHaveBeenCalled();
  });

  it("keeps only the latest interactive log resolution result", async () => {
    const old = deferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        query === "old.ts"
          ? old.promise
          : searchPage(query, {
              items: [{ path: query, name: query, kind: "file", score: 1, highlights: [] }],
              totalMatchedCount: 1,
            }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    const oldAction = rendered.result.current.onResolveLogFileReference({
      rawToken: "old.ts",
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "new.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    old.resolve(
      searchPage("old.ts", {
        items: [{ path: "old.ts", name: "old.ts", kind: "file", score: 1, highlights: [] }],
        totalMatchedCount: 1,
      }),
    );
    await act(async () => oldAction);
    expect(rendered.result.current.fileModalPath).toBe("new.ts");
  });

  it("coalesces linkability, retains positive results, and returns existing tokens", async () => {
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        searchPage(query, {
          items:
            query === "a.ts"
              ? [{ path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }]
              : [],
          totalMatchedCount: query === "a.ts" ? 1 : 0,
        }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    const args = {
      rawTokens: ["a.ts", "a.ts", "missing.ts"],
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    };
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    const positiveCalls = requestRepoFileSearch.mock.calls.length;
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    expect(requestRepoFileSearch.mock.calls.length).toBe(positiveCalls);
    expect(requestRepoFileSearch.mock.calls.filter(([, query]) => query === "a.ts")).toHaveLength(
      1,
    );
  });

  it("keeps an overlapping positive exact lookup alive while a fallback resolution is negative", async () => {
    const positive = deferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query, options) => {
        if (query === "a.ts" && options?.exactReference === true) return positive.promise;
        return searchPage(query);
      },
    );
    const rendered = renderFiles({ requestRepoFileSearch });

    const negativeResolution = rendered.result.current.onResolveLogFileReferenceCandidates({
      rawTokens: ["nested/a.ts"],
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    });
    const positiveResolution = rendered.result.current.onResolveLogFileReferenceCandidates({
      rawTokens: ["a.ts"],
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    });
    await waitFor(() => expect(requestRepoFileSearch).toHaveBeenCalledTimes(3));
    await expect(negativeResolution).resolves.toEqual([]);
    positive.resolve(
      searchPage("a.ts", {
        items: [{ path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }],
        totalMatchedCount: 1,
      }),
    );
    await expect(positiveResolution).resolves.toEqual(["a.ts"]);
  });

  it("retains positive linkability across disconnect and reconnect", async () => {
    const rendered = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query) =>
        searchPage(query, {
          items: [{ path: query, name: query, kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
      ),
    });
    const args = {
      rawTokens: ["a.ts"],
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    };
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    rendered.rerender({ paneId: "pane-1", repoRoot: "/repo", worktreePath: null, connected: true });
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);
  });

  it("clears positive linkability on scope change and manual refresh", async () => {
    const rendered = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query) =>
        searchPage(query, {
          items: [{ path: query, name: query, kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
      ),
    });
    const args = {
      rawTokens: ["a.ts"],
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    };
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);

    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo-b",
      worktreePath: null,
      connected: true,
    });
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(2);

    act(() => rendered.result.current.onRefresh());
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates(args),
    ).resolves.toEqual(["a.ts"]);
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(3);
  });

  it("preserves search and selection while modal display and copy state change", async () => {
    vi.useFakeTimers();
    const copied = deferred<boolean>();
    vi.mocked(copyToClipboard).mockImplementationOnce(() => copied.promise);
    const rendered = renderFiles();
    act(() => {
      rendered.result.current.onSearchQueryChange("readme");
      rendered.result.current.onOpenFileModal("README.md");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    act(() => {
      rendered.result.current.onSetFileModalMarkdownViewMode("code");
      rendered.result.current.onToggleFileModalLineNumbers();
    });
    const copying = rendered.result.current.onCopyFileModalPath();
    act(() => rendered.result.current.onSearchQueryChange("package"));
    copied.resolve(true);
    await act(async () => copying);
    expect(rendered.result.current.searchQuery).toBe("package");
    expect(rendered.result.current.searchResult?.query).toBe("readme");
    expect(rendered.result.current.selectedFilePath).toBe("README.md");
    expect(rendered.result.current.fileModalMarkdownViewMode).toBe("code");
    expect(rendered.result.current.fileModalShowLineNumbers).toBe(false);
    expect(rendered.result.current.fileModalCopiedPath).toBe(true);
    act(() => rendered.result.current.onCloseFileModal());
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.searchResult?.query).toBe("package");
    expect(rendered.result.current.selectedFilePath).toBe("README.md");
    expect(rendered.result.current.fileModalOpen).toBe(false);
    expect(rendered.result.current.fileModalCopiedPath).toBe(false);
  });

  it("clears only the matching latest copy indicator and ignores a prior scope result", async () => {
    vi.useFakeTimers();
    const first = deferred<boolean>();
    vi.mocked(copyToClipboard)
      .mockImplementationOnce(async () => first.promise)
      .mockResolvedValueOnce(true);
    const rendered = renderFiles();
    act(() => rendered.result.current.onOpenFileModal("old.ts"));
    const oldCopy = rendered.result.current.onCopyFileModalPath();
    rendered.rerender({ paneId: "pane-2", repoRoot: "/repo", worktreePath: null, connected: true });
    act(() => rendered.result.current.onOpenFileModal("new.ts"));
    await act(async () => rendered.result.current.onCopyFileModalPath());
    expect(rendered.result.current.fileModalCopiedPath).toBe(true);
    first.resolve(true);
    await act(async () => oldCopy);
    expect(rendered.result.current.fileModalCopiedPath).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(rendered.result.current.fileModalCopiedPath).toBe(false);
  });

  it("keeps warm tree and search data visible when manual refetch fails", async () => {
    vi.useFakeTimers();
    const requestRepoFileTree = vi
      .fn<UseSessionFilesParams["requestRepoFileTree"]>()
      .mockResolvedValueOnce(
        treePage(".", { entries: [{ path: "warm.ts", name: "warm.ts", kind: "file" }] }),
      )
      .mockRejectedValueOnce(new Error("tree refresh failed"))
      .mockResolvedValueOnce(
        treePage(".", { entries: [{ path: "warm.ts", name: "warm.ts", kind: "file" }] }),
      );
    const requestRepoFileSearch = vi
      .fn<UseSessionFilesParams["requestRepoFileSearch"]>()
      .mockResolvedValueOnce(
        searchPage("warm", {
          items: [{ path: "warm.ts", name: "warm.ts", kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
      )
      .mockRejectedValueOnce(new Error("search refresh failed"))
      .mockResolvedValueOnce(
        searchPage("warm", {
          items: [{ path: "warm.ts", name: "warm.ts", kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
      );
    const rendered = renderFiles({ requestRepoFileTree, requestRepoFileSearch });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchQueryChange("warm"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onRefresh());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.treeNodes.some((node) => node.path === "warm.ts")).toBe(true);
    expect(rendered.result.current.searchResult?.items[0]?.path).toBe("warm.ts");
    expect(rendered.result.current.treeError).toContain("tree refresh failed");
    expect(rendered.result.current.searchError).toContain("search refresh failed");

    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    rendered.rerender({ paneId: "pane-1", repoRoot: "/repo", worktreePath: null, connected: true });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(requestRepoFileTree).toHaveBeenCalledTimes(3);
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(3);
    expect(rendered.result.current.treeError).toBeNull();
    expect(rendered.result.current.searchError).toBeNull();
  });

  it("coalesces repeated manual tree and search head refreshes", async () => {
    vi.useFakeTimers();
    const treeRefresh = deferred<RepoFileTreePage>();
    const searchRefresh = deferred<RepoFileSearchPage>();
    const requestRepoFileTree = vi
      .fn<UseSessionFilesParams["requestRepoFileTree"]>()
      .mockResolvedValueOnce(treePage("."))
      .mockImplementationOnce(async () => treeRefresh.promise);
    const requestRepoFileSearch = vi
      .fn<UseSessionFilesParams["requestRepoFileSearch"]>()
      .mockResolvedValueOnce(searchPage("warm"))
      .mockImplementationOnce(async () => searchRefresh.promise);
    const rendered = renderFiles({ requestRepoFileTree, requestRepoFileSearch });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchQueryChange("warm"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));

    act(() => {
      rendered.result.current.onRefresh();
      rendered.result.current.onRefresh();
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(requestRepoFileTree).toHaveBeenCalledTimes(2);
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(2);

    treeRefresh.resolve(treePage("."));
    searchRefresh.resolve(searchPage("warm"));
    await act(async () => Promise.all([treeRefresh.promise, searchRefresh.promise]));
  });

  it("does not refetch warm successful tree and search heads on reconnect", async () => {
    vi.useFakeTimers();
    const rendered = renderFiles();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchQueryChange("warm"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));

    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    rendered.rerender({ paneId: "pane-1", repoRoot: "/repo", worktreePath: null, connected: true });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(1);
    expect(rendered.requestRepoFileSearch).toHaveBeenCalledTimes(1);
  });

  it("retries a failed child head on re-expand and a failed search tail on load-more", async () => {
    vi.useFakeTimers();
    let childAttempt = 0;
    let searchTailAttempt = 0;
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async (_pane, options) => {
        if (options?.path === "src") {
          childAttempt += 1;
          if (childAttempt === 1) throw new Error("child failed");
          return treePage("src", {
            entries: [{ path: "src/a.ts", name: "a.ts", kind: "file" }],
          });
        }
        return treePage(".", {
          entries: [{ path: "src", name: "src", kind: "directory", hasChildren: true }],
        });
      }),
      requestRepoFileSearch: vi.fn(async (_pane, query, options) => {
        if (options?.cursor === "tail") {
          searchTailAttempt += 1;
          if (searchTailAttempt === 1) throw new Error("tail failed");
          return searchPage(query, {
            items: [{ path: "b.ts", name: "b.ts", kind: "file", score: 0.5, highlights: [] }],
            totalMatchedCount: 2,
          });
        }
        return searchPage(query, {
          items: [{ path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }],
          nextCursor: "tail",
          truncated: true,
          totalMatchedCount: 2,
        });
      }),
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onToggleDirectory("src"));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.treeError).toContain("child failed");
    act(() => rendered.result.current.onToggleDirectory("src"));
    expect(rendered.result.current.treeError).toBeNull();
    act(() => rendered.result.current.onToggleDirectory("src"));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.treeNodes.some((node) => node.path === "src/a.ts")).toBe(true);

    act(() => rendered.result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onLoadMoreSearch());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.searchError).toContain("tail failed");
    act(() => {
      rendered.result.current.onLoadMoreSearch();
      rendered.result.current.onLoadMoreSearch();
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(searchTailAttempt).toBe(2);
    expect(rendered.result.current.searchResult?.items.map((item) => item.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("hides collapsed descendant pagination and suppresses repeated tree cursors", async () => {
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async (_pane, options) => {
        if (options?.path === "src" && options.cursor === "repeat") {
          return treePage("src", { entries: [], nextCursor: "repeat" });
        }
        if (options?.path === "src") {
          return treePage("src", {
            entries: [{ path: "src/a.ts", name: "a.ts", kind: "file" }],
            nextCursor: "repeat",
          });
        }
        return treePage(".", {
          entries: [{ path: "src", name: "src", kind: "directory", hasChildren: true }],
        });
      }),
    });
    await waitFor(() => expect(rendered.result.current.treeNodes).toHaveLength(1));
    act(() => rendered.result.current.onToggleDirectory("src"));
    await waitFor(() => expect(rendered.result.current.rootTreeHasMore).toBe(true));
    act(() => rendered.result.current.onToggleDirectory("src"));
    expect(rendered.result.current.rootTreeHasMore).toBe(false);
    act(() => rendered.result.current.onToggleDirectory("src"));
    act(() => rendered.result.current.onLoadMoreTreeRoot());
    await waitFor(() => expect(rendered.result.current.rootTreeHasMore).toBe(false));
  });

  it("has no content observer while closed and removes the observer after close", async () => {
    const rendered = renderFiles();
    expect(
      rendered.queryClient.getQueryCache().findAll({
        queryKey: sessionDetailQueryKeys.filesContentRoot("pane-1", {
          resolvedRoot: "/repo",
          worktreePath: null,
        }),
      }),
    ).toHaveLength(0);
    act(() => rendered.result.current.onOpenFileModal("README.md"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    const query = rendered.queryClient.getQueryCache().findAll({
      queryKey: sessionDetailQueryKeys.filesContentRoot("pane-1", {
        resolvedRoot: "/repo",
        worktreePath: null,
      }),
    })[0];
    expect(query?.getObserversCount()).toBe(1);
    act(() => rendered.result.current.onCloseFileModal());
    await waitFor(() => expect(query?.getObserversCount()).toBe(0));
  });

  it("reopens the same content in one React batch with a fresh request and one preview release", async () => {
    let request = 0;
    const rendered = renderFiles({
      requestRepoFileContent: vi.fn(async (_pane, path) => {
        request += 1;
        return fileContent(path, {
          preview: {
            token: `preview-${request}`,
            url: `/preview-${request}`,
            mimeType: "image/png",
            expiresAt: "x",
          },
        });
      }),
    });
    act(() => rendered.result.current.onOpenFileModal("image.png"));
    await waitFor(() =>
      expect(rendered.result.current.fileModalFile?.preview?.token).toBe("preview-1"),
    );

    act(() => {
      rendered.result.current.onCloseFileModal();
      rendered.result.current.onOpenFileModal("image.png");
    });

    await waitFor(() => expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(rendered.result.current.fileModalFile?.preview?.token).toBe("preview-2"),
    );
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(1);
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "preview-1");
  });

  it("keeps the modal closed when a queued same-resource reopen is superseded by close", async () => {
    const rendered = renderFiles();
    act(() => rendered.result.current.onOpenFileModal("a.ts"));
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("a.ts"));

    act(() => {
      rendered.result.current.onCloseFileModal();
      rendered.result.current.onOpenFileModal("a.ts");
      rendered.result.current.onCloseFileModal();
    });

    await waitFor(() => expect(rendered.result.current.fileModalOpen).toBe(false));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.result.current.fileModalOpen).toBe(false);
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1);
  });

  it("lets the latest different target win over a queued same-resource reopen", async () => {
    const rendered = renderFiles();
    act(() => rendered.result.current.onOpenFileModal("a.ts"));
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("a.ts"));

    act(() => {
      rendered.result.current.onCloseFileModal();
      rendered.result.current.onOpenFileModal("a.ts");
      rendered.result.current.onOpenFileModal("b.ts");
    });

    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("b.ts"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.result.current.fileModalPath).toBe("b.ts");
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(2);
    expect(rendered.requestRepoFileContent).toHaveBeenNthCalledWith(
      2,
      "pane-1",
      "b.ts",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("reopens A freshly across a rapid A to B to A transition", async () => {
    let aRequest = 0;
    const rendered = renderFiles({
      requestRepoFileContent: vi.fn(async (_pane, path) => {
        if (path === "a.png") aRequest += 1;
        return fileContent(path, {
          preview:
            path === "a.png"
              ? {
                  token: `a-preview-${aRequest}`,
                  url: `/a-preview-${aRequest}`,
                  mimeType: "image/png",
                  expiresAt: "x",
                }
              : undefined,
        });
      }),
    });
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() =>
      expect(rendered.result.current.fileModalFile?.preview?.token).toBe("a-preview-1"),
    );

    act(() => {
      rendered.result.current.onOpenFileModal("b.ts");
      rendered.result.current.onOpenFileModal("a.png");
    });

    await waitFor(() => expect(aRequest).toBe(2));
    await waitFor(() =>
      expect(rendered.result.current.fileModalFile?.preview?.token).toBe("a-preview-2"),
    );
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(1);
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "a-preview-1");
  });

  it("releases both preview leases once across a rapid A to B to A transition", async () => {
    let request = 0;
    const rendered = renderFiles({
      requestRepoFileContent: vi.fn(async (_pane, path) => {
        request += 1;
        return fileContent(path, {
          preview: {
            token: `${path}-${request}`,
            url: `/preview-${request}`,
            mimeType: "image/png",
            expiresAt: "x",
          },
        });
      }),
    });
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("a.png"));
    act(() => rendered.result.current.onOpenFileModal("b.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("b.png"));
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("a.png"));

    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(3);
    expect(rendered.result.current.fileModalFile?.preview?.token).toBe("a.png-3");
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(2);
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "a.png-1");
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "b.png-2");
  });

  it("keeps one pending content resource request when only log metadata changes", async () => {
    const pending = deferred<RepoFileContent>();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) =>
        searchPage(query, {
          items: [{ path: query, name: "a.ts", kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
    );
    const rendered = renderFiles({
      requestRepoFileSearch,
      requestRepoFileContent: vi.fn(async () => pending.promise),
    });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "a.ts:1",
        sourcePaneId: "pane-1",
        sourceRepoRoot: "/repo",
      }),
    );
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "a.ts:2",
        sourcePaneId: "pane-1",
        sourceRepoRoot: "/repo",
      }),
    );
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1);
    pending.resolve(fileContent("a.ts"));
    await waitFor(() => expect(rendered.result.current.fileModalFile?.path).toBe("a.ts"));
    expect(rendered.result.current.fileModalHighlightLine).toBe(2);
  });

  it("opens a configured external absolute log path", async () => {
    const absolute = "/tmp/external/preview.html";
    const rendered = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query) =>
        searchPage(query, {
          items: [{ path: absolute, name: "preview.html", kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
      ),
      requestRepoFileContent: vi.fn(async () => fileContent(absolute, { languageHint: "html" })),
    });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: `${absolute}:4`,
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    await waitFor(() => expect(rendered.result.current.fileModalPath).toBe(absolute));
    expect(rendered.result.current.fileModalHighlightLine).toBe(4);
    expect(rendered.requestRepoFileContent).toHaveBeenCalledWith(
      "log",
      absolute,
      expect.objectContaining({ worktreePath: "/external" }),
      expect.any(AbortSignal),
    );
  });

  it("rejects a Windows drive-prefixed navigator path without a request", () => {
    const rendered = renderFiles();
    act(() => rendered.result.current.onOpenFileModal("C:/repo/index.ts"));
    expect(rendered.requestRepoFileContent).not.toHaveBeenCalled();
    expect(rendered.result.current.fileModalOpen).toBe(false);
    expect(rendered.result.current.fileResolveError).toBe("File not found.");
  });

  it.each([
    "C:\\repo\\index.ts",
    "C:/repo/index.ts",
    "C:relative/index.ts",
    "C:file.ts",
    "C:file.ts:12",
    "../index.ts",
  ])("rejects invalid log path %s without exact or basename requests", async (rawToken) => {
    const rendered = renderFiles();
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken,
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(rendered.requestRepoFileSearch).not.toHaveBeenCalled();
    expect(rendered.requestRepoFileContent).not.toHaveBeenCalled();
    expect(rendered.result.current.fileModalOpen).toBe(false);
    expect(rendered.result.current.logFileCandidateModalOpen).toBe(false);
  });

  it("allocates copy operation ids synchronously for same-render reverse completion", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    vi.mocked(copyToClipboard)
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const rendered = renderFiles();
    act(() => rendered.result.current.onOpenFileModal("a.ts"));
    const firstCopy = rendered.result.current.onCopyFileModalPath();
    const secondCopy = rendered.result.current.onCopyFileModalPath();
    second.resolve(true);
    await act(async () => secondCopy);
    first.resolve(false);
    await act(async () => firstCopy);
    expect(rendered.result.current.fileModalCopiedPath).toBe(true);
    expect(rendered.result.current.fileModalCopyError).toBeNull();
  });

  it("retries a failed tree tail exactly once after repeated load-more actions", async () => {
    let tailAttempt = 0;
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async (_pane, options) => {
        if (options?.cursor === "tail") {
          tailAttempt += 1;
          if (tailAttempt === 1) throw new Error("tree tail failed");
          return treePage(".", {
            entries: [{ path: "b.ts", name: "b.ts", kind: "file" }],
          });
        }
        return treePage(".", {
          entries: [{ path: "a.ts", name: "a.ts", kind: "file" }],
          nextCursor: "tail",
        });
      }),
    });
    await waitFor(() => expect(rendered.result.current.rootTreeHasMore).toBe(true));
    act(() => rendered.result.current.onLoadMoreTreeRoot());
    await waitFor(() => expect(rendered.result.current.treeError).toContain("tree tail failed"));
    act(() => {
      rendered.result.current.onLoadMoreTreeRoot();
      rendered.result.current.onLoadMoreTreeRoot();
    });
    await waitFor(() => expect(rendered.result.current.treeNodes).toHaveLength(2));
    expect(tailAttempt).toBe(2);
  });

  it("prioritizes tree errors by root head, visible child heads, then active pagination", async () => {
    let rootHeadAttempt = 0;
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async (_pane, options) => {
        if (options?.cursor === "root-tail") throw new Error("root tail failed");
        if (options?.path === "a") throw new Error("a child failed");
        if (options?.path === "b") throw new Error("b child failed");
        rootHeadAttempt += 1;
        if (rootHeadAttempt > 1) throw new Error("root head failed");
        return treePage(".", {
          entries: [
            { path: "b", name: "b", kind: "directory", hasChildren: true },
            { path: "a", name: "a", kind: "directory", hasChildren: true },
          ],
          nextCursor: "root-tail",
        });
      }),
    });
    await waitFor(() => expect(rendered.result.current.treeNodes).toHaveLength(2));
    act(() => {
      rendered.result.current.onToggleDirectory("a");
      rendered.result.current.onToggleDirectory("b");
      rendered.result.current.onLoadMoreTreeRoot();
    });
    await waitFor(() => expect(rendered.result.current.treeError).toContain("b child failed"));

    act(() => rendered.result.current.onToggleDirectory("b"));
    await waitFor(() => expect(rendered.result.current.treeError).toContain("a child failed"));
    act(() => rendered.result.current.onToggleDirectory("a"));
    await waitFor(() => expect(rendered.result.current.treeError).toContain("root tail failed"));

    act(() => rendered.result.current.onRefresh());
    await waitFor(() => expect(rendered.result.current.treeError).toContain("root head failed"));
  });

  it("includes a visible directory tail error in render-order priority", async () => {
    const rendered = renderFiles({
      requestRepoFileTree: vi.fn(async (_pane, options) => {
        if (options?.path === "b" && options.cursor === "b-tail") {
          throw new Error("b tail failed");
        }
        if (options?.path === "b") {
          return treePage("b", {
            entries: [{ path: "b/ok.ts", name: "ok.ts", kind: "file" }],
            nextCursor: "b-tail",
          });
        }
        if (options?.path === "a") throw new Error("a head failed");
        return treePage(".", {
          entries: [
            { path: "b", name: "b", kind: "directory", hasChildren: true },
            { path: "a", name: "a", kind: "directory", hasChildren: true },
          ],
        });
      }),
    });
    await waitFor(() => expect(rendered.result.current.treeNodes).toHaveLength(2));
    act(() => {
      rendered.result.current.onToggleDirectory("b");
      rendered.result.current.onToggleDirectory("a");
    });
    await waitFor(() => expect(rendered.result.current.treeError).toContain("a head failed"));
    act(() => rendered.result.current.onLoadMoreTreeRoot());
    await waitFor(() => expect(rendered.result.current.treeError).toContain("b tail failed"));
    act(() => rendered.result.current.onToggleDirectory("b"));
    await waitFor(() => expect(rendered.result.current.treeError).toContain("a head failed"));
  });

  it("does not coalesce lookup requests across pane A to B to A or manual generation", async () => {
    const first = deferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi
      .fn<UseSessionFilesParams["requestRepoFileSearch"]>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementation(async (_pane, query) =>
        searchPage(query, {
          items: [{ path: query, name: query, kind: "file", score: 1, highlights: [] }],
          totalMatchedCount: 1,
        }),
      );
    const rendered = renderFiles({ requestRepoFileSearch });
    const stale = rendered.result.current.onResolveLogFileReference({
      rawToken: "a.ts",
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    });
    await waitFor(() => expect(requestRepoFileSearch).toHaveBeenCalledTimes(1));
    rendered.rerender({
      paneId: "pane-2",
      repoRoot: "/repo-b",
      worktreePath: null,
      connected: true,
    });
    rendered.rerender({ paneId: "pane-1", repoRoot: "/repo", worktreePath: null, connected: true });
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "a.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(2);
    act(() => rendered.result.current.onRefresh());
    await act(async () =>
      rendered.result.current.onResolveLogFileReference({
        rawToken: "a.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(requestRepoFileSearch).toHaveBeenCalledTimes(3);
    first.resolve(searchPage("a.ts"));
    await act(async () => stale);
    expect(rendered.result.current.fileModalPath).toBe("a.ts");
  });

  it("cleans old content and preview once across scope A to B to A", async () => {
    const rendered = renderFiles({
      requestRepoFileContent: vi.fn(async (_pane, path) =>
        fileContent(path, {
          preview: {
            token: `preview-${path}`,
            url: "/preview",
            mimeType: "image/png",
            expiresAt: "x",
          },
        }),
      ),
    });
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    const oldQuery = rendered.queryClient.getQueryCache().findAll({
      queryKey: sessionDetailQueryKeys.filesContentRoot("pane-1", {
        resolvedRoot: "/repo",
        worktreePath: null,
      }),
    })[0];
    rendered.rerender({
      paneId: "pane-2",
      repoRoot: "/repo-b",
      worktreePath: null,
      connected: true,
    });
    await waitFor(() => expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(1));
    expect(oldQuery?.getObserversCount()).toBe(0);
    rendered.rerender({ paneId: "pane-1", repoRoot: "/repo", worktreePath: null, connected: true });
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() => expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(2));
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["pane", { paneId: "pane-2", repoRoot: "/repo", worktreePath: null }],
    ["resolved root", { paneId: "pane-1", repoRoot: "/repo-b", worktreePath: null }],
    ["worktree", { paneId: "pane-1", repoRoot: "/repo", worktreePath: "/repo/wt" }],
  ] as const)(
    "removes old tree cache and observers across %s A to B to A",
    async (_label, next) => {
      const rendered = renderFiles();
      const oldKey = sessionDetailQueryKeys.filesTree("pane-1", {
        resolvedRoot: "/repo",
        worktreePath: null,
        path: ".",
        cursor: null,
        limit: 200,
      });
      await waitFor(() =>
        expect(
          rendered.queryClient.getQueryCache().find({ queryKey: oldKey, exact: true }),
        ).toBeDefined(),
      );

      rendered.rerender({ ...next, connected: true });
      await waitFor(() =>
        expect(
          rendered.queryClient.getQueryCache().find({ queryKey: oldKey, exact: true }),
        ).toBeUndefined(),
      );
      rendered.rerender({
        paneId: "pane-1",
        repoRoot: "/repo",
        worktreePath: null,
        connected: true,
      });
      await waitFor(() => expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(3));
      expect(
        rendered.queryClient
          .getQueryCache()
          .find({ queryKey: oldKey, exact: true })
          ?.getObserversCount(),
      ).toBe(1);
    },
  );

  it("protects an observerless filesRoot fetch when the owner remounts before old cleanup", async () => {
    const queryClient = createAppQueryClient();
    const first = renderFiles({ queryClient });
    await waitFor(() => expect(first.requestRepoFileTree).toHaveBeenCalledTimes(1));
    first.unmount();

    const pending = deferred<string>();
    const externalKey = [...sessionDetailQueryKeys.filesRoot("pane-1"), "external"] as const;
    const fetch = queryClient.fetchQuery({
      queryKey: externalKey,
      queryFn: async () => pending.promise,
      gcTime: Infinity,
    });
    const second = renderFiles({ queryClient });
    pending.resolve("protected");

    await expect(fetch).resolves.toBe("protected");
    expect(queryClient.getQueryData(externalKey)).toBe("protected");
    second.unmount();
  });

  it("keeps a slow positive lookup while cleaning an unrelated negative resolution", async () => {
    const positive = deferred<RepoFileSearchPage>();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query) => (query === "a.ts" ? positive.promise : searchPage(query)),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    const positiveResult = rendered.result.current.onResolveLogFileReferenceCandidates({
      rawTokens: ["a.ts"],
      sourcePaneId: "log",
      sourceRepoRoot: "/external",
    });
    await waitFor(() => expect(requestRepoFileSearch).toHaveBeenCalledTimes(1));
    await expect(
      rendered.result.current.onResolveLogFileReferenceCandidates({
        rawTokens: ["missing.ts"],
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    ).resolves.toEqual([]);
    positive.resolve(
      searchPage("a.ts", {
        items: [{ path: "a.ts", name: "a.ts", kind: "file", score: 1, highlights: [] }],
        totalMatchedCount: 1,
      }),
    );
    await expect(positiveResult).resolves.toEqual(["a.ts"]);
    expect(requestRepoFileSearch.mock.calls.filter(([, query]) => query === "a.ts")).toHaveLength(
      1,
    );
  });

  it("disables A pagination while B is desired and clamps the active index after shrink", async () => {
    vi.useFakeTimers();
    const pendingB = deferred<RepoFileSearchPage>();
    let aAttempt = 0;
    const rendered = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query) => {
        if (query === "b") return pendingB.promise;
        aAttempt += 1;
        return searchPage("a", {
          items: (aAttempt === 1 ? ["a.ts", "b.ts", "c.ts"] : ["a.ts"]).map((path) => ({
            path,
            name: path,
            kind: "file" as const,
            score: 1,
            highlights: [],
          })),
          nextCursor: aAttempt === 1 ? "tail" : undefined,
          totalMatchedCount: aAttempt === 1 ? 3 : 1,
        });
      }),
    });
    act(() => rendered.result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchMove(2));
    expect(rendered.result.current.searchHasMore).toBe(true);
    act(() => rendered.result.current.onSearchQueryChange("b"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(rendered.result.current.searchHasMore).toBe(false);
    pendingB.resolve(searchPage("b"));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(aAttempt).toBe(2);
    expect(rendered.result.current.searchActiveIndex).toBe(0);
  });

  it("stops lookup after twenty pages and never falls back after a communication error", async () => {
    const paged = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query, options) =>
        searchPage(query, {
          nextCursor: `cursor-${Number(options?.cursor?.split("-")[1] ?? 0) + 1}`,
        }),
      ),
    });
    await act(async () =>
      paged.result.current.onResolveLogFileReference({
        rawToken: "src/a.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(paged.requestRepoFileSearch).toHaveBeenCalledTimes(20);
    expect(paged.result.current.fileResolveError).toContain("incomplete");
    paged.unmount();

    const failed = renderFiles({
      requestRepoFileSearch: vi.fn(async () => {
        throw new Error("communication failed");
      }),
    });
    await act(async () =>
      failed.result.current.onResolveLogFileReference({
        rawToken: "src/a.ts",
        sourcePaneId: "log",
        sourceRepoRoot: "/external",
      }),
    );
    expect(failed.requestRepoFileSearch).toHaveBeenCalledTimes(1);
    expect(failed.result.current.fileResolveError).toContain("communication failed");
  });

  it("does not refetch warm files resources on focus or visibility-equivalent focus changes", async () => {
    const rendered = renderFiles();
    await waitFor(() => expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(1));
    act(() => rendered.result.current.onOpenFileModal("a.ts"));
    await waitFor(() => expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1));
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await act(async () => Promise.resolve());
    expect(rendered.requestRepoFileTree).toHaveBeenCalledTimes(1);
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1);
  });

  it("keeps a warm preview lease across disconnect and reconnect", async () => {
    const rendered = renderFiles({
      requestRepoFileContent: vi.fn(async (_pane, path) =>
        fileContent(path, {
          preview: {
            token: "warm-preview",
            url: "/preview",
            mimeType: "image/png",
            expiresAt: "x",
          },
        }),
      ),
    });
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    rendered.rerender({ paneId: "pane-1", repoRoot: "/repo", worktreePath: null, connected: true });
    await act(async () => Promise.resolve());
    expect(rendered.requestRepoFileContent).toHaveBeenCalledTimes(1);
    expect(rendered.revokeRepoFilePreview).not.toHaveBeenCalled();
  });

  it("revokes a disconnected warm preview once when the files scope changes", async () => {
    const rendered = renderFiles({
      requestRepoFileContent: vi.fn(async (_pane, path) =>
        fileContent(path, {
          preview: {
            token: "scope-preview",
            url: "/preview",
            mimeType: "image/png",
            expiresAt: "x",
          },
        }),
      ),
    });
    act(() => rendered.result.current.onOpenFileModal("a.png"));
    await waitFor(() => expect(rendered.result.current.fileModalFile).not.toBeNull());
    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo",
      worktreePath: null,
      connected: false,
    });
    expect(rendered.revokeRepoFilePreview).not.toHaveBeenCalled();

    rendered.rerender({
      paneId: "pane-1",
      repoRoot: "/repo-b",
      worktreePath: null,
      connected: false,
    });
    await waitFor(() => expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(1));
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledWith("pane-1", "scope-preview");
    rendered.unmount();
    await act(async () => Promise.resolve());
    expect(rendered.revokeRepoFilePreview).toHaveBeenCalledTimes(1);
  });

  it("clamps the active index when manual same-query refresh shrinks results", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const rendered = renderFiles({
      requestRepoFileSearch: vi.fn(async (_pane, query) => {
        attempt += 1;
        const paths = attempt === 1 ? ["a.ts", "b.ts", "c.ts"] : ["a.ts"];
        return searchPage(query, {
          items: paths.map((path) => ({
            path,
            name: path,
            kind: "file" as const,
            score: 1,
            highlights: [],
          })),
          totalMatchedCount: paths.length,
        });
      }),
    });
    act(() => rendered.result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchMove(2));
    expect(rendered.result.current.searchActiveIndex).toBe(2);
    act(() => rendered.result.current.onRefresh());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rendered.result.current.searchActiveIndex).toBe(0);
  });

  it("revisits a past query with one head request and no old tail observer fetch", async () => {
    vi.useFakeTimers();
    const requestRepoFileSearch = vi.fn<UseSessionFilesParams["requestRepoFileSearch"]>(
      async (_pane, query, options) =>
        searchPage(query, {
          items: [
            { path: `${query}.ts`, name: `${query}.ts`, kind: "file", score: 1, highlights: [] },
          ],
          nextCursor: options?.cursor == null && query === "a" ? "tail" : undefined,
          totalMatchedCount: 1,
        }),
    );
    const rendered = renderFiles({ requestRepoFileSearch });
    act(() => rendered.result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onLoadMoreSearch());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchQueryChange("b"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => rendered.result.current.onSearchQueryChange("a"));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(
      requestRepoFileSearch.mock.calls.filter(
        ([, query, options]) => query === "a" && options?.cursor == null,
      ),
    ).toHaveLength(2);
    expect(
      requestRepoFileSearch.mock.calls.filter(
        ([, query, options]) => query === "a" && options?.cursor === "tail",
      ),
    ).toHaveLength(1);
  });
});
