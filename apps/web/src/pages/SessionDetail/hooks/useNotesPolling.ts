import { useVisibilityPolling } from "@/lib/use-visibility-polling";

const AUTO_SYNC_INTERVAL_MS = 10_000;

type UseNotesPollingParams = {
  repoRoot: string | null;
  onRefresh: (options?: { silent?: boolean }) => void;
  intervalMs?: number;
};

/**
 * Silently refetches notes on mount and every `intervalMs` while a repo root
 * is available; stops (and does not fire once) when there is none.
 */
export const useNotesPolling = ({
  repoRoot,
  onRefresh,
  intervalMs = AUTO_SYNC_INTERVAL_MS,
}: UseNotesPollingParams) => {
  useVisibilityPolling({
    enabled: Boolean(repoRoot),
    intervalMs,
    onStart: () => onRefresh({ silent: true }),
    onTick: () => onRefresh({ silent: true }),
  });
};
