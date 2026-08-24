import { CancelledError, type QueryClient, type QueryKey } from "@tanstack/react-query";

export type FilesScopeIdentity = {
  paneId: string;
  resolvedRoot: string | null;
  worktreePath: string | null;
};

export type ContentTarget = {
  targetPaneId: string;
  targetRoot: string;
  targetWorktreePath: string | null;
  path: string;
  origin: "navigator" | "log";
  highlightLine: number | null;
};

export const sameContentResource = (left: ContentTarget | null, right: ContentTarget | null) =>
  left === right ||
  (left != null &&
    right != null &&
    left.targetPaneId === right.targetPaneId &&
    left.targetRoot === right.targetRoot &&
    left.targetWorktreePath === right.targetWorktreePath &&
    left.path === right.path);

type CommittedFilesLifetime = {
  scope: FilesScopeIdentity;
  connected: boolean;
  contentTarget: ContentTarget | null;
};

export const createCommittedFilesLifetimeRef = () => {
  const ref: { current: CommittedFilesLifetime | null } = { current: null };
  return {
    commit: (lifetime: CommittedFilesLifetime) => {
      ref.current = lifetime;
    },
    clear: (lifetime: CommittedFilesLifetime) => {
      if (ref.current === lifetime) ref.current = null;
    },
    assertContent: (scope: FilesScopeIdentity, target: ContentTarget, signal: AbortSignal) => {
      const current = ref.current;
      if (
        signal.aborted ||
        current?.scope !== scope ||
        !sameContentResource(current.contentTarget, target) ||
        !current.connected
      ) {
        throw new CancelledError();
      }
    },
  };
};
export type CommittedFilesLifetimeRef = ReturnType<typeof createCommittedFilesLifetimeRef>;

type PreviewLease = { paneId: string; token: string };

export const createPreviewLeaseController = (
  revoke: (paneId: string, token: string) => Promise<void>,
) => {
  const owned = new Map<string, PreviewLease>();
  let deferredCleanup = 0;
  const leaseKey = (paneId: string, token: string) => `${paneId}\0${token}`;
  const release = (lease: PreviewLease | null | undefined) => {
    if (lease == null) return;
    const key = leaseKey(lease.paneId, lease.token);
    if (!owned.has(key)) return;
    owned.delete(key);
    void revoke(lease.paneId, lease.token).catch(() => undefined);
  };
  return {
    register: (paneId: string, token: string | null | undefined) => {
      if (token == null) return;
      owned.set(leaseKey(paneId, token), { paneId, token });
    },
    release,
    releaseToken: (paneId: string, token: string | null | undefined) => {
      if (token != null) release(owned.get(leaseKey(paneId, token)));
    },
    scheduleReleaseAll: () => {
      const generation = ++deferredCleanup;
      queueMicrotask(() => {
        if (generation !== deferredCleanup) return;
        [...owned.values()].forEach(release);
      });
    },
    cancelScheduledRelease: () => {
      deferredCleanup += 1;
    },
  };
};
export type PreviewLeaseController = ReturnType<typeof createPreviewLeaseController>;

type PendingContentCleanup = {
  queryClient: QueryClient;
  queryKey: QueryKey;
  reopen: { generation: number; callback: () => void } | null;
};

export const createContentQueryCleanupCoordinator = () => {
  const pending = new Map<string, PendingContentCleanup>();
  let unsubscribe: (() => void) | null = null;
  let callbackGeneration = 0;
  let drainScheduled = false;
  let draining = false;
  let drainRequested = false;
  const hashKey = (queryKey: QueryKey) => JSON.stringify(queryKey);
  const stopWhenIdle = () => {
    if (pending.size !== 0) return;
    unsubscribe?.();
    unsubscribe = null;
  };
  const drain = () => {
    if (draining) {
      drainRequested = true;
      return;
    }
    draining = true;
    drainScheduled = false;
    const ready: PendingContentCleanup[] = [];
    for (const [hash, cleanup] of pending) {
      const query = cleanup.queryClient
        .getQueryCache()
        .find({ queryKey: cleanup.queryKey, exact: true });
      if ((query?.getObserversCount() ?? 0) !== 0) continue;
      pending.delete(hash);
      ready.push(cleanup);
    }
    stopWhenIdle();
    ready.forEach((cleanup) => {
      cleanup.queryClient.removeQueries({
        queryKey: cleanup.queryKey,
        exact: true,
        type: "inactive",
      });
    });
    const reopens = ready.flatMap((cleanup) => (cleanup.reopen == null ? [] : [cleanup.reopen]));
    if (reopens.length > 0) {
      queueMicrotask(() => {
        reopens.forEach((reopen) => {
          if (reopen.generation === callbackGeneration) reopen.callback();
        });
      });
    }
    draining = false;
    if (drainRequested) {
      drainRequested = false;
      scheduleDrain();
    }
  };
  const scheduleDrain = () => {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(drain);
  };
  const ensureSubscribed = (queryClient: QueryClient) => {
    if (unsubscribe != null) return;
    unsubscribe = queryClient.getQueryCache().subscribe(scheduleDrain);
  };
  return {
    invalidate: (queryClient: QueryClient, queryKey: QueryKey) => {
      const hash = hashKey(queryKey);
      const previous = pending.get(hash);
      pending.set(hash, { queryClient, queryKey, reopen: previous?.reopen ?? null });
      ensureSubscribed(queryClient);
      scheduleDrain();
    },
    reopenAfterCleanup: (queryClient: QueryClient, queryKey: QueryKey, reopen: () => void) => {
      const cleanup = pending.get(hashKey(queryKey));
      if (cleanup == null) return false;
      cleanup.reopen = { generation: callbackGeneration, callback: reopen };
      ensureSubscribed(queryClient);
      scheduleDrain();
      return true;
    },
    cancelReopens: () => {
      callbackGeneration += 1;
      pending.forEach((cleanup) => {
        cleanup.reopen = null;
      });
    },
    dispose: () => {
      callbackGeneration += 1;
      pending.clear();
      stopWhenIdle();
    },
  };
};
export type ContentQueryCleanupCoordinator = ReturnType<
  typeof createContentQueryCleanupCoordinator
>;

type FilesOwnerEntry = { epoch: number; tokens: Set<number> };
const filesOwnerRegistry = new Map<string, FilesOwnerEntry>();
let nextFilesOwnerToken = 0;

export const registerFilesOwner = (rootHash: string) => {
  const previous = filesOwnerRegistry.get(rootHash) ?? { epoch: 0, tokens: new Set<number>() };
  const token = ++nextFilesOwnerToken;
  const entry = { epoch: previous.epoch + 1, tokens: new Set(previous.tokens).add(token) };
  filesOwnerRegistry.set(rootHash, entry);
  return token;
};

export const unregisterFilesOwner = (rootHash: string, token: number, cleanup: () => void) => {
  const current = filesOwnerRegistry.get(rootHash);
  if (current == null) return;
  current.tokens.delete(token);
  const epoch = current.epoch;
  queueMicrotask(() => {
    const latest = filesOwnerRegistry.get(rootHash);
    if (latest?.epoch !== epoch || latest.tokens.size !== 0) return;
    filesOwnerRegistry.delete(rootHash);
    cleanup();
  });
};

export const normalizeRepoFilePath = (value: string, allowRoot = false): string | null => {
  const trimmed = value.trim();
  if (trimmed.includes("\\") || /^[A-Za-z]:/.test(trimmed)) return null;
  if (allowRoot && (trimmed === "" || trimmed === ".")) return ".";
  if (trimmed === "" || trimmed.startsWith("/") || trimmed.includes("\0")) return null;
  const normalized: string[] = [];
  for (const segment of trimmed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  return normalized.length === 0 ? (allowRoot ? "." : null) : normalized.join("/");
};

export const normalizeAbsoluteLogFilePath = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("\0")) return null;
  const normalized: string[] = [];
  for (const segment of trimmed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") normalized.pop();
    else normalized.push(segment);
  }
  return `/${normalized.join("/")}`;
};

export const normalizeFilesQuery = (value: string) => value.trim();

export const sameFilesScope = (left: FilesScopeIdentity, right: FilesScopeIdentity) =>
  left.paneId === right.paneId &&
  left.resolvedRoot === right.resolvedRoot &&
  left.worktreePath === right.worktreePath;
