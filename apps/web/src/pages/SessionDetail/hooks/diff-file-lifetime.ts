import { CancelledError } from "@tanstack/react-query";
import type { DiffFile } from "@vde-monitor/shared";

export type CommittedDiffFileLifetime<TScope> = {
  scope: TScope;
  summarySnapshot: string | null;
  connected: boolean;
};

export type CommittedDiffFileLifetimeRef<TScope> = {
  commit: (lifetime: CommittedDiffFileLifetime<TScope>) => void;
  clear: (lifetime: CommittedDiffFileLifetime<TScope>) => void;
  assertActive: (targetScope: TScope, targetSnapshot: string | null, signal: AbortSignal) => void;
};

export const createCommittedDiffFileLifetimeRef = <
  TScope,
>(): CommittedDiffFileLifetimeRef<TScope> => {
  const ref: { current: CommittedDiffFileLifetime<TScope> | null } = { current: null };
  return {
    commit: (lifetime) => {
      ref.current = lifetime;
    },
    clear: (lifetime) => {
      if (ref.current === lifetime) ref.current = null;
    },
    assertActive: (targetScope, targetSnapshot, signal) => {
      const committedLifetime = ref.current;
      if (
        signal.aborted ||
        committedLifetime?.scope !== targetScope ||
        committedLifetime.summarySnapshot !== targetSnapshot ||
        !committedLifetime.connected
      ) {
        throw new CancelledError();
      }
    },
  };
};

export const createGuardedDiffFileQuery =
  <TScope>({
    lifetimeRef,
    targetScope,
    targetSnapshot,
    revision,
    path,
    request,
    handleMismatch,
  }: {
    lifetimeRef: CommittedDiffFileLifetimeRef<TScope>;
    targetScope: TScope;
    targetSnapshot: string | null;
    revision: string | null;
    path: string;
    request: (signal: AbortSignal) => Promise<DiffFile>;
    handleMismatch: () => never;
  }) =>
  async ({ signal }: { signal: AbortSignal }) => {
    const file = await request(signal);
    lifetimeRef.assertActive(targetScope, targetSnapshot, signal);
    if (file.rev !== revision || file.path !== path) {
      handleMismatch();
    }
    return file;
  };
