import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { useVisibilityPolling } from "@/lib/use-visibility-polling";

type UseScopeGuardParams = {
  paneId: string;
  worktreePath?: string | null;
  branch?: string | null;
  variant?: string | null;
  connected: boolean;
  /**
   * Ref to the callback invoked when the connection transitions from
   * disconnected → connected. Update this ref after defining your load
   * callbacks so the latest version is always called.
   */
  onReconnectRef: MutableRefObject<() => void>;
  /**
   * Ref to the callback invoked on each visibility-polling tick. Update this
   * ref after defining your poll callbacks so the latest version is always called.
   */
  pollTickRef: MutableRefObject<() => void>;
  pollIntervalMs: number;
};

type UseScopeGuardResult = {
  /** Pane/worktree/branch key with an optional request variant suffix. */
  scopeKey: string;
  /** Ref whose `.current` is always the latest scopeKey. */
  activeScopeRef: MutableRefObject<string>;
};

/**
 * Thin hook that centralises the scope-key computation, activeScopeRef
 * maintenance, reconnection effect, and visibility polling shared across
 * useSessionCommits and useSessionDiffs.
 *
 * Business logic (state machines, module-level caches, etc.) is intentionally
 * kept out of this hook.
 */
export const useScopeGuard = ({
  paneId,
  worktreePath = null,
  branch = null,
  variant = null,
  connected,
  onReconnectRef,
  pollTickRef,
  pollIntervalMs,
}: UseScopeGuardParams): UseScopeGuardResult => {
  const baseScopeKey = `${paneId}:${worktreePath ?? "__default__"}:${branch ?? "__no_branch__"}`;
  const scopeKey = variant == null ? baseScopeKey : `${baseScopeKey}:${variant}`;
  const activeScopeRef = useRef(scopeKey);
  const prevConnectedRef = useRef<boolean | null>(null);

  // Commit the latest scope before passive effects or browser events can start
  // requests. Render stays pure if React replays or discards it.
  useLayoutEffect(() => {
    activeScopeRef.current = scopeKey;
    return () => {
      // A keyed remount creates a new guard ref, so invalidate this mount's ref
      // before any request it started can settle into shared atom state.
      activeScopeRef.current = "";
    };
  }, [scopeKey]);

  // Re-fetch when the connection is restored after a disconnect.
  useEffect(() => {
    if (prevConnectedRef.current === false && connected) {
      onReconnectRef.current();
    }
    prevConnectedRef.current = connected;
  }, [connected, onReconnectRef]);

  // Stable wrapper so useVisibilityPolling receives a referentially-stable
  // onTick even though pollTickRef.current is updated each render.
  const pollTickWrapper = useCallback(() => {
    pollTickRef.current();
  }, [pollTickRef]);

  useVisibilityPolling({
    enabled: Boolean(paneId) && connected,
    intervalMs: pollIntervalMs,
    onTick: pollTickWrapper,
  });

  return { scopeKey, activeScopeRef };
};
