// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createCommitDetail, createCommitFileDiff, createCommitLog } from "../test-helpers";
import { CommitSection } from "./CommitSection";

describe("CommitSection", () => {
  it("renders commit log and handles copy", () => {
    const commitLog = createCommitLog();
    const onCopyHash = vi.fn();
    render(
      <CommitSection
        commitLog={commitLog}
        commitError={null}
        commitLoading={false}
        commitLoadingMore={false}
        commitHasMore={false}
        commitDetails={{}}
        commitFileDetails={{}}
        commitFileOpen={{}}
        commitFileLoading={{}}
        commitOpen={{}}
        commitLoadingDetails={{}}
        copiedHash={null}
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
        onToggleCommit={vi.fn()}
        onToggleCommitFile={vi.fn()}
        onCopyHash={onCopyHash}
      />,
    );

    expect(screen.getByText("Initial commit")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Copy commit hash abc123"));
    expect(onCopyHash).toHaveBeenCalledWith("abc123");
  });

  it("handles commit and file toggles", () => {
    const commitLog = createCommitLog();
    const onToggleCommit = vi.fn();
    const onToggleCommitFile = vi.fn();
    const detail = createCommitDetail();
    const fileKey = "abc123:src/index.ts";
    render(
      <CommitSection
        commitLog={commitLog}
        commitError={null}
        commitLoading={false}
        commitLoadingMore={false}
        commitHasMore={false}
        commitDetails={{ abc123: detail }}
        commitFileDetails={{ [fileKey]: createCommitFileDiff() }}
        commitFileOpen={{ [fileKey]: true }}
        commitFileLoading={{}}
        commitOpen={{ abc123: true }}
        commitLoadingDetails={{}}
        copiedHash={null}
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
        onToggleCommit={onToggleCommit}
        onToggleCommitFile={onToggleCommitFile}
        onCopyHash={vi.fn()}
      />,
    );

    const [first, second] = screen.getAllByText("Hide");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(screen.getByText("Total changes")).toBeTruthy();
    fireEvent.click(first as Element);
    expect(onToggleCommit).toHaveBeenCalledWith("abc123");

    fireEvent.click(second as Element);
    expect(onToggleCommitFile).toHaveBeenCalledWith("abc123", "src/index.ts");
  });

  it("renders load more button when available", () => {
    const commitLog = createCommitLog();
    const onLoadMore = vi.fn();
    render(
      <CommitSection
        commitLog={commitLog}
        commitError={null}
        commitLoading={false}
        commitLoadingMore={false}
        commitHasMore
        commitDetails={{}}
        commitFileDetails={{}}
        commitFileOpen={{}}
        commitFileLoading={{}}
        commitOpen={{}}
        commitLoadingDetails={{}}
        copiedHash={null}
        onRefresh={vi.fn()}
        onLoadMore={onLoadMore}
        onToggleCommit={vi.fn()}
        onToggleCommitFile={vi.fn()}
        onCopyHash={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Load more"));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
