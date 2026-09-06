type WorktreeStatusStackProps = {
  loading: boolean;
  error: string | null;
  entriesCount: number;
  loadingMessage?: string;
  emptyMessage?: string;
};

export const WorktreeStatusStack = ({
  loading,
  error,
  entriesCount,
  loadingMessage = "Loading worktrees...",
  emptyMessage = "No worktrees available.",
}: WorktreeStatusStackProps) => {
  const showBlockingLoading = loading && entriesCount === 0;

  return (
    <>
      {showBlockingLoading ? (
        <p className="text-latte-subtext0 px-1 py-2 text-xs">{loadingMessage}</p>
      ) : null}
      {error ? <p className="text-latte-red-text px-1 py-2 text-xs">{error}</p> : null}
      {!showBlockingLoading && !error && entriesCount === 0 ? (
        <p className="text-latte-subtext0 px-1 py-2 text-xs">{emptyMessage}</p>
      ) : null}
    </>
  );
};
