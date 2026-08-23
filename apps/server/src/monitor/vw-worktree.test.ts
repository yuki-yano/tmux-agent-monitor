import { describe, expect, it, vi } from "vitest";

const execaMock = vi.fn();

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve } as Deferred<T>;
};

const createVwListStdout = (worktrees: unknown[]) =>
  JSON.stringify({
    schemaVersion: 2,
    command: "list",
    status: "ok",
    repoRoot: "/repo",
    data: {
      baseBranch: "main",
      managedWorktreeRoot: "/repo/.git/wt",
      worktrees,
    },
    error: null,
  });

vi.mock("execa", () => ({
  execa: execaMock,
}));

const loadModule = async () => {
  vi.resetModules();
  execaMock.mockReset();
  return import("./vw-worktree");
};

describe("resolveVwWorktreeSnapshotCached", () => {
  it("loads snapshot from vw list --json", async () => {
    const { resolveVwWorktreeSnapshotCached } = await loadModule();
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: createVwListStdout([
        {
          branch: "main",
          path: "/repo",
          dirty: false,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false },
        },
      ]),
    });

    const snapshot = await resolveVwWorktreeSnapshotCached("/repo");

    expect(snapshot?.repoRoot).toBe("/repo");
    expect(snapshot?.baseBranch).toBe("main");
    expect(snapshot?.entries).toHaveLength(1);
    expect(execaMock).toHaveBeenCalledWith("vw", ["list", "--json"], expect.any(Object));
  });

  it("rejects unsupported vw JSON schema versions", async () => {
    const { resolveVwWorktreeSnapshotCached } = await loadModule();
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        command: "list",
        status: "ok",
        repoRoot: "/repo",
        data: {
          baseBranch: "main",
          worktrees: [{ branch: "main", path: "/repo" }],
        },
        error: null,
      }),
    });

    const snapshot = await resolveVwWorktreeSnapshotCached("/repo");

    expect(snapshot).toBeNull();
  });

  it("forces --no-gh when ghMode is never", async () => {
    const { resolveVwWorktreeSnapshotCached } = await loadModule();
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: createVwListStdout([
        {
          branch: "main",
          path: "/repo",
          dirty: false,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false },
        },
      ]),
    });

    const snapshot = await resolveVwWorktreeSnapshotCached("/repo", { ghMode: "never" });

    expect(snapshot?.repoRoot).toBe("/repo");
    expect(execaMock).toHaveBeenCalledWith("vw", ["list", "--json", "--no-gh"], expect.any(Object));
  });

  it("caches by normalized cwd", async () => {
    const { resolveVwWorktreeSnapshotCached } = await loadModule();
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: createVwListStdout([
        { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
      ]),
    });

    const first = await resolveVwWorktreeSnapshotCached("/repo/");
    const second = await resolveVwWorktreeSnapshotCached("/repo");

    expect(first?.entries[0]?.path).toBe("/repo");
    expect(second?.entries[0]?.path).toBe("/repo");
    expect(execaMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent snapshot requests with inflight cache", async () => {
    const { resolveVwWorktreeSnapshotCached } = await loadModule();
    const deferred = createDeferred<{
      exitCode: number;
      stdout: string;
    }>();
    execaMock.mockReturnValueOnce(deferred.promise);

    const firstPromise = resolveVwWorktreeSnapshotCached("/repo");
    const secondPromise = resolveVwWorktreeSnapshotCached("/repo/");
    await Promise.resolve();

    expect(execaMock).toHaveBeenCalledTimes(1);

    deferred.resolve({
      exitCode: 0,
      stdout: createVwListStdout([
        { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
      ]),
    });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first?.entries[0]?.path).toBe("/repo");
    expect(second?.entries[0]?.path).toBe("/repo");
    expect(execaMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a monitor snapshot until an event invalidates it", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(startedAt);
      const { invalidateVwWorktreeSnapshotCache, resolveVwWorktreeSnapshotCached } =
        await loadModule();
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      const options = {
        ghMode: "never" as const,
        cacheTtlMs: Number.POSITIVE_INFINITY,
        monitor: true,
        staleWhileRevalidate: true,
      };

      for (let elapsedSeconds = 0; elapsedSeconds <= 60; elapsedSeconds += 1) {
        vi.setSystemTime(new Date(startedAt.getTime() + elapsedSeconds * 1000));
        await resolveVwWorktreeSnapshotCached("/repo", options);
      }

      expect(execaMock).toHaveBeenCalledTimes(1);

      invalidateVwWorktreeSnapshotCache("/repo");
      await resolveVwWorktreeSnapshotCached("/repo", options);

      expect(execaMock).toHaveBeenCalledTimes(2);
      expect(execaMock).toHaveBeenNthCalledWith(
        2,
        "vw",
        ["list", "--json", "--no-gh", "--monitor"],
        expect.any(Object),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off and retries a failed monitor snapshot instead of caching it forever", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(startedAt);
      const { resolveVwWorktreeSnapshotCached } = await loadModule();
      execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: "" }).mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      const options = {
        ghMode: "never" as const,
        cacheTtlMs: Number.POSITIVE_INFINITY,
        monitor: true,
        staleWhileRevalidate: true,
      };

      expect(await resolveVwWorktreeSnapshotCached("/repo", options)).toBeNull();
      vi.setSystemTime(new Date(startedAt.getTime() + 29_999));
      expect(await resolveVwWorktreeSnapshotCached("/repo", options)).toBeNull();
      expect(execaMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(startedAt.getTime() + 30_000));
      expect(await resolveVwWorktreeSnapshotCached("/repo", options)).toBeNull();
      await vi.waitFor(() => {
        expect(execaMock).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(async () => {
        expect((await resolveVwWorktreeSnapshotCached("/repo", options))?.repoRoot).toBe("/repo");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a refreshed monitor snapshot stale when another event arrives in flight", async () => {
    const { invalidateVwWorktreeSnapshotCache, resolveVwWorktreeSnapshotCached } =
      await loadModule();
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: createVwListStdout([
        { branch: "old", path: "/repo", dirty: false, locked: {}, merged: {} },
      ]),
    });
    const options = {
      ghMode: "never" as const,
      cacheTtlMs: Number.POSITIVE_INFINITY,
      monitor: true,
      staleWhileRevalidate: true,
    };
    await resolveVwWorktreeSnapshotCached("/repo", options);
    invalidateVwWorktreeSnapshotCache("/repo");

    const refresh = createDeferred<{ exitCode: number; stdout: string }>();
    execaMock.mockReturnValueOnce(refresh.promise).mockResolvedValueOnce({
      exitCode: 0,
      stdout: createVwListStdout([
        { branch: "latest", path: "/repo", dirty: false, locked: {}, merged: {} },
      ]),
    });
    await resolveVwWorktreeSnapshotCached("/repo", options);
    invalidateVwWorktreeSnapshotCache("/repo");
    refresh.resolve({
      exitCode: 0,
      stdout: createVwListStdout([
        { branch: "intermediate", path: "/repo", dirty: false, locked: {}, merged: {} },
      ]),
    });
    await resolveVwWorktreeSnapshotCached("/repo", {
      ...options,
      staleWhileRevalidate: false,
    });

    const intermediate = await resolveVwWorktreeSnapshotCached("/repo", options);

    expect(intermediate?.entries[0]?.branch).toBe("intermediate");
    expect(execaMock).toHaveBeenCalledTimes(3);
  });

  it("returns a stale snapshot immediately and switches after background refresh", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { resolveVwWorktreeSnapshotCached } = await loadModule();
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "old", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      const options = {
        ghMode: "never" as const,
        cacheTtlMs: 60_000,
        staleWhileRevalidate: true,
      };
      await resolveVwWorktreeSnapshotCached("/repo", options);

      vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
      const deferred = createDeferred<{ exitCode: number; stdout: string }>();
      execaMock.mockReturnValueOnce(deferred.promise);

      const stale = await resolveVwWorktreeSnapshotCached("/repo", options);

      expect(stale?.entries[0]?.branch).toBe("old");
      expect(execaMock).toHaveBeenCalledTimes(2);

      deferred.resolve({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "new", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      const refreshed = await resolveVwWorktreeSnapshotCached("/repo", {
        ...options,
        staleWhileRevalidate: false,
      });

      expect(refreshed?.entries[0]?.branch).toBe("new");
      expect((await resolveVwWorktreeSnapshotCached("/repo", options))?.entries[0]?.branch).toBe(
        "new",
      );
      expect(execaMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts only one background refresh for concurrent stale reads", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { resolveVwWorktreeSnapshotCached } = await loadModule();
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "old", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      const options = {
        ghMode: "never" as const,
        cacheTtlMs: 60_000,
        staleWhileRevalidate: true,
      };
      await resolveVwWorktreeSnapshotCached("/repo", options);

      vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
      const deferred = createDeferred<{ exitCode: number; stdout: string }>();
      execaMock.mockReturnValueOnce(deferred.promise);

      const snapshots = await Promise.all([
        resolveVwWorktreeSnapshotCached("/repo", options),
        resolveVwWorktreeSnapshotCached("/repo", options),
        resolveVwWorktreeSnapshotCached("/repo/", options),
      ]);

      expect(snapshots.map((snapshot) => snapshot?.entries[0]?.branch)).toEqual([
        "old",
        "old",
        "old",
      ]);
      expect(execaMock).toHaveBeenCalledTimes(2);

      deferred.resolve({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "new", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      await resolveVwWorktreeSnapshotCached("/repo", {
        ...options,
        staleWhileRevalidate: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches immediately after clearing a monitor snapshot", async () => {
    const { clearVwWorktreeSnapshotCache, resolveVwWorktreeSnapshotCached } = await loadModule();
    execaMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "old", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "new", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
    const options = {
      ghMode: "never" as const,
      cacheTtlMs: 60_000,
      staleWhileRevalidate: true,
    };
    await resolveVwWorktreeSnapshotCached("/repo", options);

    clearVwWorktreeSnapshotCache("/repo");
    const refreshed = await resolveVwWorktreeSnapshotCached("/repo", options);

    expect(refreshed?.entries[0]?.branch).toBe("new");
    expect(execaMock).toHaveBeenCalledTimes(2);
  });

  it("refetches after clearing while a stale refresh is in flight", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { clearVwWorktreeSnapshotCache, resolveVwWorktreeSnapshotCached } = await loadModule();
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "old", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      const options = {
        ghMode: "never" as const,
        cacheTtlMs: 60_000,
        staleWhileRevalidate: true,
      };
      await resolveVwWorktreeSnapshotCached("/repo", options);

      vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
      const staleRefresh = createDeferred<{ exitCode: number; stdout: string }>();
      execaMock.mockReturnValueOnce(staleRefresh.promise).mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "new", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      await resolveVwWorktreeSnapshotCached("/repo", options);

      clearVwWorktreeSnapshotCache("/repo");
      const refreshed = await resolveVwWorktreeSnapshotCached("/repo", options);

      expect(refreshed?.entries[0]?.branch).toBe("new");
      expect(execaMock).toHaveBeenCalledTimes(3);

      staleRefresh.resolve({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "stale", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      await Promise.resolve();
      await Promise.resolve();

      expect((await resolveVwWorktreeSnapshotCached("/repo", options))?.entries[0]?.branch).toBe(
        "new",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the default cache TTL at three seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { resolveVwWorktreeSnapshotCached } = await loadModule();
      execaMock.mockResolvedValue({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });

      await resolveVwWorktreeSnapshotCached("/repo", { ghMode: "never" });
      vi.setSystemTime(new Date("2026-01-01T00:00:02.999Z"));
      await resolveVwWorktreeSnapshotCached("/repo", { ghMode: "never" });
      expect(execaMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-01-01T00:00:03.000Z"));
      await resolveVwWorktreeSnapshotCached("/repo", { ghMode: "never" });
      expect(execaMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs gh lookup in auto mode even when no-gh cache is fresh", async () => {
    const { resolveVwWorktreeSnapshotCached } = await loadModule();
    execaMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          {
            branch: "feature/foo",
            path: "/repo/.worktree/feature/foo",
            dirty: false,
            locked: {},
            merged: { overall: false, byPR: null },
            pr: { status: "unknown" },
          },
        ]),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          {
            branch: "feature/foo",
            path: "/repo/.worktree/feature/foo",
            dirty: false,
            locked: {},
            merged: { overall: false, byPR: true },
            pr: { status: "merged" },
          },
        ]),
      });

    const first = await resolveVwWorktreeSnapshotCached("/repo", { ghMode: "never" });
    const second = await resolveVwWorktreeSnapshotCached("/repo", { ghMode: "auto" });

    expect(first?.entries[0]?.merged.byPR).toBeNull();
    expect(first?.entries[0]?.pr.status).toBe("unknown");
    expect(second?.entries[0]?.merged.byPR).toBe(true);
    expect(second?.entries[0]?.pr.status).toBe("merged");
    expect(execaMock).toHaveBeenNthCalledWith(
      1,
      "vw",
      ["list", "--json", "--no-gh"],
      expect.any(Object),
    );
    expect(execaMock).toHaveBeenNthCalledWith(2, "vw", ["list", "--json"], expect.any(Object));
  });

  it("uses --no-gh within refresh interval and reuses cached merged state", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { resolveVwWorktreeSnapshotCached, resolveWorktreeStatusFromSnapshot } =
        await loadModule();
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          {
            branch: "feature/foo",
            path: "/repo/.worktree/feature/foo",
            dirty: false,
            locked: {},
            merged: { overall: true, byPR: true },
            pr: { status: "merged" },
          },
        ]),
      });

      const first = await resolveVwWorktreeSnapshotCached("/repo");
      expect(execaMock).toHaveBeenNthCalledWith(1, "vw", ["list", "--json"], expect.any(Object));
      expect(
        resolveWorktreeStatusFromSnapshot(first, "/repo/.worktree/feature/foo")?.worktreeMerged,
      ).toBe(true);

      vi.setSystemTime(new Date("2026-01-01T00:00:03.100Z"));
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          {
            branch: "feature/foo",
            path: "/repo/.worktree/feature/foo",
            dirty: false,
            locked: {},
            merged: { overall: false, byPR: null },
            pr: { status: "unknown" },
          },
        ]),
      });
      const second = await resolveVwWorktreeSnapshotCached("/repo");

      expect(execaMock).toHaveBeenNthCalledWith(
        2,
        "vw",
        ["list", "--json", "--no-gh"],
        expect.any(Object),
      );
      expect(
        resolveWorktreeStatusFromSnapshot(second, "/repo/.worktree/feature/foo")?.worktreeMerged,
      ).toBe(true);
      expect(second?.entries[0]?.pr.status).toBe("merged");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects configurable gh refresh interval", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { configureVwGhRefreshIntervalMs, resolveVwWorktreeSnapshotCached } =
        await loadModule();
      configureVwGhRefreshIntervalMs(10_000);

      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      await resolveVwWorktreeSnapshotCached("/repo");
      expect(execaMock).toHaveBeenNthCalledWith(1, "vw", ["list", "--json"], expect.any(Object));

      vi.setSystemTime(new Date("2026-01-01T00:00:03.100Z"));
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      await resolveVwWorktreeSnapshotCached("/repo");
      expect(execaMock).toHaveBeenNthCalledWith(
        2,
        "vw",
        ["list", "--json", "--no-gh"],
        expect.any(Object),
      );

      vi.setSystemTime(new Date("2026-01-01T00:00:10.300Z"));
      execaMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: createVwListStdout([
          { branch: "main", path: "/repo", dirty: false, locked: {}, merged: {} },
        ]),
      });
      await resolveVwWorktreeSnapshotCached("/repo");
      expect(execaMock).toHaveBeenNthCalledWith(3, "vw", ["list", "--json"], expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolveWorktreeStatusFromSnapshot", () => {
  it("matches nested cwd by longest path", async () => {
    const { resolveVwWorktreeSnapshotCached, resolveWorktreeStatusFromSnapshot } =
      await loadModule();
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: createVwListStdout([
        {
          branch: "main",
          path: "/repo",
          dirty: false,
          locked: { value: false, owner: null, reason: null },
          merged: { overall: false },
        },
        {
          branch: "feature/foo",
          path: "/repo/.worktree/feature/foo",
          dirty: true,
          locked: { value: true, owner: "codex", reason: "in progress" },
          merged: { overall: true },
        },
      ]),
    });
    const snapshot = await resolveVwWorktreeSnapshotCached("/repo");

    const matched = resolveWorktreeStatusFromSnapshot(
      snapshot,
      "/repo/.worktree/feature/foo/apps/web",
    );

    expect(matched).toEqual({
      repoRoot: "/repo",
      worktreePath: "/repo/.worktree/feature/foo",
      branch: "feature/foo",
      worktreeDirty: true,
      worktreeLocked: true,
      worktreeLockOwner: "codex",
      worktreeLockReason: "in progress",
      worktreeMerged: true,
    });
  });
});
