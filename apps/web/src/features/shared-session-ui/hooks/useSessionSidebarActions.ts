import { useAtom } from "jotai";
import { useCallback, useState } from "react";

import { sidebarListFilterAtom } from "@/features/shared-session-ui/atoms/sidebarUiAtoms";
import { useLazyRef } from "@/lib/use-lazy-ref";

import {
  DEFAULT_SESSION_LIST_FILTER,
  isSessionListFilter,
} from "@/features/shared-session-ui/model/session-list-filters";
import type { LaunchAgentHandler } from "@/state/launch-agent-options";

type UseSessionSidebarActionsArgs = {
  onSelectSession?: (paneId: string) => void;
  onFocusPane?: (paneId: string) => Promise<void> | void;
  onLaunchAgentInSession?: LaunchAgentHandler;
  onTouchSession?: (paneId: string) => void;
  onTouchRepoPin?: (repoRoot: string | null) => void;
};

export const useSessionSidebarActions = ({
  onSelectSession,
  onFocusPane,
  onLaunchAgentInSession,
  onTouchSession,
  onTouchRepoPin,
}: UseSessionSidebarActionsArgs) => {
  const [filter, setFilter] = useAtom(sidebarListFilterAtom);
  const [focusPendingPaneIds, setFocusPendingPaneIds] = useState<Set<string>>(() => new Set());
  const [launchPendingSessions, setLaunchPendingSessions] = useState<Set<string>>(() => new Set());
  const launchPendingRef = useLazyRef(() => new Set<string>());

  const handleSelectSession = useCallback(
    (paneId: string) => {
      onSelectSession?.(paneId);
    },
    [onSelectSession],
  );

  const handleFocusPane = useCallback(
    async (paneId: string) => {
      if (!onFocusPane) {
        return;
      }
      setFocusPendingPaneIds((prev) => {
        if (prev.has(paneId)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(paneId);
        return next;
      });
      try {
        await onFocusPane(paneId);
      } catch {
        // Best-effort UI action: ignore unexpected handler failures.
      } finally {
        setFocusPendingPaneIds((prev) => {
          if (!prev.has(paneId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(paneId);
          return next;
        });
      }
    },
    [onFocusPane],
  );

  const handleLaunchAgentInSession = useCallback<LaunchAgentHandler>(
    async (sessionName, agent, options) => {
      if (!onLaunchAgentInSession) {
        return;
      }
      const launchKey = sessionName;
      if (launchPendingRef.current.has(launchKey)) {
        return;
      }
      launchPendingRef.current.add(launchKey);
      setLaunchPendingSessions(new Set(launchPendingRef.current));
      try {
        await onLaunchAgentInSession(sessionName, agent, options);
      } catch {
        // Best-effort UI action: ignore unexpected handler failures.
      } finally {
        launchPendingRef.current.delete(launchKey);
        setLaunchPendingSessions(new Set(launchPendingRef.current));
      }
    },
    [launchPendingRef, onLaunchAgentInSession],
  );

  const handleFilterChange = useCallback(
    (next: string) => {
      if (!isSessionListFilter(next)) {
        setFilter(DEFAULT_SESSION_LIST_FILTER);
        return;
      }
      setFilter(next);
    },
    [setFilter],
  );

  const handleTouchRepoPin = useCallback(
    (repoRoot: string | null) => {
      onTouchRepoPin?.(repoRoot);
    },
    [onTouchRepoPin],
  );

  const handleTouchPane = useCallback(
    (paneId: string) => {
      onTouchSession?.(paneId);
    },
    [onTouchSession],
  );

  return {
    filter,
    focusPendingPaneIds,
    launchPendingSessions,
    handleSelectSession,
    handleFocusPane,
    handleLaunchAgentInSession,
    handleFilterChange,
    handleTouchRepoPin,
    handleTouchPane,
  };
};
