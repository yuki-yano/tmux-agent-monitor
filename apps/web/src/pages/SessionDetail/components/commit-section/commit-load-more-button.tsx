import { ArrowDown } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui";

type CommitLoadMoreButtonProps = {
  canLoadMore: boolean;
  commitLoadingMore: boolean;
  onLoadMore: () => void;
};

export const CommitLoadMoreButton = memo(
  ({ canLoadMore, commitLoadingMore, onLoadMore }: CommitLoadMoreButtonProps) => {
    if (!canLoadMore) {
      return null;
    }
    return (
      <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={commitLoadingMore}>
        <ArrowDown className="h-4 w-4" />
        {commitLoadingMore ? "Loading…" : "Load more"}
      </Button>
    );
  },
);

CommitLoadMoreButton.displayName = "CommitLoadMoreButton";
