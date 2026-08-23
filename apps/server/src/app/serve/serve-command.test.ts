import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFailedServeSetup,
  createGracefulShutdown,
  ensureCmuxAvailable,
  ensureCmuxPlatformSupported,
  resolveCmuxConnectionOptions,
  stopMonitorAndDisposeRuntime,
} from "./serve-command";
import {
  buildTailscaleServeCommand,
  buildTailscaleServeProxyTarget,
  collectServeProxyTargets,
  matchesExpectedTailscaleServeTarget,
} from "./tailscale-setup";

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

const cmuxCapabilities = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    protocol: "cmux-socket",
    version: 2,
    socket_path: "/Users/test/.cmux/cmux.sock",
    access_mode: "automation",
    methods: ["system.tree", "surface.read_text"],
    ...overrides,
  });

describe("ensureCmuxAvailable", () => {
  const previousSocketPath = process.env.CMUX_SOCKET_PATH;
  const previousSocketAlias = process.env.CMUX_SOCKET;
  const previousPassword = process.env.CMUX_SOCKET_PASSWORD;

  afterEach(() => {
    if (previousSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH;
    else process.env.CMUX_SOCKET_PATH = previousSocketPath;
    if (previousSocketAlias === undefined) delete process.env.CMUX_SOCKET;
    else process.env.CMUX_SOCKET = previousSocketAlias;
    if (previousPassword === undefined) delete process.env.CMUX_SOCKET_PASSWORD;
    else process.env.CMUX_SOCKET_PASSWORD = previousPassword;
  });

  it("validates version, capabilities, access mode, and required methods", async () => {
    delete process.env.CMUX_SOCKET_PATH;
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "cmux 0.64.17 (123)", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: cmuxCapabilities(), stderr: "", exitCode: 0 });

    const result = await ensureCmuxAvailable({
      cliPath: "/Applications/cmux.app/Contents/Resources/bin/cmux",
      socketPath: "/configured/cmux.sock",
      password: null,
      requiredMethods: ["system.tree", "surface.read_text"],
      run,
      platform: "darwin",
      osRelease: "23.0.0",
    });

    expect(result.socket_path).toBe("/Users/test/.cmux/cmux.sock");
    expect(run).toHaveBeenNthCalledWith(
      2,
      "/Applications/cmux.app/Contents/Resources/bin/cmux",
      ["--json", "--id-format", "uuids", "capabilities"],
      expect.objectContaining({ CMUX_SOCKET_PATH: "/configured/cmux.sock" }),
    );
  });

  it("prefers the configured socket and passes the resolved password only through the child environment", async () => {
    process.env.CMUX_SOCKET_PATH = "/environment/cmux.sock";
    process.env.CMUX_SOCKET = "/deprecated/cmux.sock";
    delete process.env.CMUX_SOCKET_PASSWORD;
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "cmux 0.65.0", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: cmuxCapabilities({ access_mode: "password" }),
        stderr: "",
        exitCode: 0,
      });

    const connection = resolveCmuxConnectionOptions({
      socketPath: "/configured/cmux.sock",
      env: { CMUX_SOCKET_PASSWORD: "secret" },
    });
    await ensureCmuxAvailable({
      cliPath: "cmux",
      ...connection,
      requiredMethods: [],
      run,
      platform: "darwin",
      osRelease: "24.0.0",
    });

    const capabilitiesCall = run.mock.calls[1];
    expect(capabilitiesCall?.[1]).not.toContain("secret");
    expect(capabilitiesCall?.[2]).toMatchObject({
      CMUX_SOCKET_PATH: "/configured/cmux.sock",
      CMUX_SOCKET_PASSWORD: "secret",
    });
    expect(capabilitiesCall?.[2]).not.toHaveProperty("CMUX_SOCKET");
  });

  it("uses CMUX_SOCKET_PASSWORD from the environment without trimming it", async () => {
    process.env.CMUX_SOCKET_PASSWORD = " environment secret ";
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "cmux 0.65.0", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: cmuxCapabilities({ access_mode: "password" }),
        stderr: "",
        exitCode: 0,
      });

    const connection = resolveCmuxConnectionOptions({
      socketPath: null,
    });
    await ensureCmuxAvailable({
      cliPath: "cmux",
      ...connection,
      requiredMethods: [],
      run,
      platform: "darwin",
      osRelease: "24.0.0",
    });

    expect(run.mock.calls[1]?.[2]).toMatchObject({
      CMUX_SOCKET_PASSWORD: " environment secret ",
    });
  });

  it("uses CMUX_SOCKET_PATH when no socket is configured", () => {
    expect(
      resolveCmuxConnectionOptions({
        socketPath: null,
        env: { CMUX_SOCKET_PATH: "/environment/cmux.sock" },
      }),
    ).toEqual({
      socketPath: "/environment/cmux.sock",
      password: null,
    });
  });

  it("rejects an explicitly empty CMUX_SOCKET_PASSWORD instead of falling back", () => {
    expect(() =>
      resolveCmuxConnectionOptions({
        socketPath: null,
        env: { CMUX_SOCKET_PASSWORD: "" },
      }),
    ).toThrow("CMUX_SOCKET_PASSWORD must not be empty");
  });

  it("rejects cmux versions older than 0.64.17", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "cmux 0.64.16",
      stderr: "",
      exitCode: 0,
    });

    await expect(
      ensureCmuxAvailable({
        cliPath: "cmux",
        socketPath: null,
        password: null,
        requiredMethods: [],
        run,
        platform: "darwin",
        osRelease: "23.0.0",
      }),
    ).rejects.toThrow("cmux 0.64.17 or newer is required");
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects missing required methods", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "cmux 0.64.17", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: cmuxCapabilities(), stderr: "", exitCode: 0 });

    await expect(
      ensureCmuxAvailable({
        cliPath: "cmux",
        socketPath: null,
        password: null,
        requiredMethods: ["system.tree", "surface.send_key"],
        run,
        platform: "darwin",
        osRelease: "23.0.0",
      }),
    ).rejects.toThrow("cmux is missing required socket methods: surface.send_key");
  });

  it("explains how to resolve socket access failures", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "cmux 0.64.17", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "Failed to write to socket (Broken pipe, errno 32)",
        exitCode: 1,
      });

    await expect(
      ensureCmuxAvailable({
        cliPath: "cmux",
        socketPath: null,
        password: null,
        requiredMethods: [],
        run,
        platform: "darwin",
        osRelease: "23.0.0",
      }),
    ).rejects.toThrow(
      "Start vde-monitor inside a cmux terminal, or select Automation/Password under cmux Settings > Automation > Socket Control Mode",
    );
  });

  it("rejects remote relay and relative socket addresses", async () => {
    for (const socketPath of ["127.0.0.1:64011", "relative/cmux.sock"]) {
      const run = vi
        .fn()
        .mockResolvedValueOnce({ stdout: "cmux 0.64.17", stderr: "", exitCode: 0 })
        .mockResolvedValueOnce({
          stdout: cmuxCapabilities({ socket_path: socketPath }),
          stderr: "",
          exitCode: 0,
        });

      await expect(
        ensureCmuxAvailable({
          cliPath: "cmux",
          socketPath: null,
          password: null,
          requiredMethods: [],
          run,
          platform: "darwin",
          osRelease: "23.0.0",
        }),
      ).rejects.toThrow("cmux requires a local Unix socket with an absolute filesystem path");
    }
  });

  it("rejects insecure or disabled access modes", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "cmux 0.64.17", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: cmuxCapabilities({ access_mode: "allowAll" }),
        stderr: "",
        exitCode: 0,
      });

    await expect(
      ensureCmuxAvailable({
        cliPath: "cmux",
        socketPath: null,
        password: null,
        requiredMethods: [],
        run,
        platform: "darwin",
        osRelease: "23.0.0",
      }),
    ).rejects.toThrow("cmux access mode is not supported: allowAll");
  });
});

describe("ensureCmuxPlatformSupported", () => {
  it("accepts macOS 14 and newer Darwin kernels", () => {
    expect(() => ensureCmuxPlatformSupported("darwin", "23.0.0")).not.toThrow();
    expect(() => ensureCmuxPlatformSupported("darwin", "25.5.0")).not.toThrow();
  });

  it("fails before CLI execution outside supported macOS releases", () => {
    expect(() => ensureCmuxPlatformSupported("linux", "6.8.0")).toThrow(
      "cmux requires macOS 14 or newer",
    );
    expect(() => ensureCmuxPlatformSupported("darwin", "22.6.0")).toThrow(
      "cmux requires macOS 14 or newer",
    );
    expect(() => ensureCmuxPlatformSupported("darwin", "unknown")).toThrow(
      "cmux requires macOS 14 or newer",
    );
  });
});

describe("stopMonitorAndDisposeRuntime", () => {
  it("disposes the runtime after the monitor stops", async () => {
    const calls: string[] = [];

    await stopMonitorAndDisposeRuntime({
      stopMonitor: () => {
        calls.push("monitor");
      },
      disposeRuntime: () => {
        calls.push("runtime");
      },
    });

    expect(calls).toEqual(["monitor", "runtime"]);
  });

  it("still disposes the runtime when monitor shutdown fails", async () => {
    const disposeRuntime = vi.fn();

    await expect(
      stopMonitorAndDisposeRuntime({
        stopMonitor: () => {
          throw new Error("monitor stop failed");
        },
        disposeRuntime,
      }),
    ).rejects.toThrow("monitor stop failed");
    expect(disposeRuntime).toHaveBeenCalledOnce();
  });
});

describe("cleanupFailedServeSetup", () => {
  it("attempts every acquired cleanup and releases ownership last", async () => {
    const calls: string[] = [];

    await cleanupFailedServeSetup({
      streamCleanups: [
        () => {
          calls.push("stream-1");
          throw new Error("stream cleanup failed");
        },
        () => calls.push("stream-2"),
      ],
      closeServer: (onClosed) => {
        calls.push("server");
        onClosed();
      },
      stopMonitor: () => {
        calls.push("monitor");
        throw new Error("monitor cleanup failed");
      },
      disposeRuntime: () => {
        calls.push("runtime");
        throw new Error("runtime cleanup failed");
      },
      releaseServerRuntime: () => calls.push("release"),
    });

    expect(calls).toEqual(["stream-1", "stream-2", "server", "monitor", "runtime", "release"]);
  });

  it("disposes an initialized runtime without stopping an unstarted monitor", async () => {
    const stopMonitor = vi.fn();
    const disposeRuntime = vi.fn();

    await cleanupFailedServeSetup({
      stopMonitor: undefined,
      disposeRuntime,
      releaseServerRuntime: vi.fn(),
    });

    expect(stopMonitor).not.toHaveBeenCalled();
    expect(disposeRuntime).toHaveBeenCalledOnce();
  });
});

describe("createGracefulShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one shutdown across duplicate SIGINT and SIGTERM delivery", async () => {
    let resolveMonitorStop = () => {};
    const monitorStopped = new Promise<void>((resolve) => {
      resolveMonitorStop = resolve;
    });
    let onServerClosed = () => {};
    const closeStreams = vi.fn();
    const stopMonitor = vi.fn(() => monitorStopped);
    const closeServer = vi.fn((onClosed: () => void) => {
      onServerClosed = onClosed;
    });
    const releaseServerRuntime = vi.fn();
    const exitProcess = vi.fn();
    const shutdown = createGracefulShutdown({
      closeStreams,
      stopMonitor,
      closeServer,
      releaseServerRuntime,
      exitProcess,
    });

    const sigintShutdown = shutdown();
    const sigtermShutdown = shutdown();
    await flushMicrotasks();

    expect(sigtermShutdown).toBe(sigintShutdown);
    expect(closeStreams).toHaveBeenCalledOnce();
    expect(stopMonitor).toHaveBeenCalledOnce();
    expect(closeServer).not.toHaveBeenCalled();

    resolveMonitorStop();
    await flushMicrotasks();

    expect(closeServer).toHaveBeenCalledOnce();
    expect(exitProcess).not.toHaveBeenCalled();

    onServerClosed();
    await sigintShutdown;

    expect(releaseServerRuntime).toHaveBeenCalledOnce();
    expect(exitProcess).toHaveBeenCalledOnce();
    expect(exitProcess).toHaveBeenCalledWith(0);
    expect(shutdown()).toBe(sigintShutdown);
  });

  it("releases the server claim after HTTP closes and before process exit", async () => {
    const calls: string[] = [];
    let onServerClosed = () => {};
    const shutdown = createGracefulShutdown({
      closeStreams: vi.fn(),
      stopMonitor: vi.fn(),
      closeServer: vi.fn((onClosed: () => void) => {
        onServerClosed = onClosed;
      }),
      releaseServerRuntime: () => {
        calls.push("release");
      },
      exitProcess: () => {
        calls.push("exit");
      },
    });

    const shutdownPromise = shutdown();
    await flushMicrotasks();
    expect(calls).toEqual([]);

    onServerClosed();
    await shutdownPromise;

    expect(calls).toEqual(["release", "exit"]);
  });

  it("starts HTTP server close after the five-second monitor stop timeout", async () => {
    const closeServer = vi.fn();
    const shutdown = createGracefulShutdown({
      closeStreams: vi.fn(),
      stopMonitor: vi.fn(() => new Promise<void>(() => {})),
      closeServer,
      exitProcess: vi.fn(),
    });

    void shutdown();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(4999);

    expect(closeServer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(closeServer).toHaveBeenCalledOnce();
  });

  it("keeps the three-second server-close guard after monitor shutdown", async () => {
    let onServerClosed = () => {};
    const exitProcess = vi.fn();
    const shutdown = createGracefulShutdown({
      closeStreams: vi.fn(),
      stopMonitor: vi.fn(),
      closeServer: vi.fn((onClosed: () => void) => {
        onServerClosed = onClosed;
      }),
      exitProcess,
    });

    const shutdownPromise = shutdown();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2999);

    expect(exitProcess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await shutdownPromise;

    expect(exitProcess).toHaveBeenCalledOnce();
    expect(exitProcess).toHaveBeenCalledWith(0);

    onServerClosed();
    expect(exitProcess).toHaveBeenCalledOnce();
  });

  it("continues server shutdown when monitor stop rejects", async () => {
    let onServerClosed = () => {};
    const closeServer = vi.fn((onClosed: () => void) => {
      onServerClosed = onClosed;
    });
    const exitProcess = vi.fn();
    const shutdown = createGracefulShutdown({
      closeStreams: vi.fn(),
      stopMonitor: vi.fn(async () => {
        throw new Error("detach failed");
      }),
      closeServer,
      exitProcess,
    });

    const shutdownPromise = shutdown();
    await flushMicrotasks();

    expect(closeServer).toHaveBeenCalledOnce();

    onServerClosed();
    await shutdownPromise;
    expect(exitProcess).toHaveBeenCalledOnce();
  });

  it("releases the claim when stream cleanup and server close throw", async () => {
    const stopMonitor = vi.fn();
    const releaseServerRuntime = vi.fn();
    const exitProcess = vi.fn();
    const shutdown = createGracefulShutdown({
      closeStreams: () => {
        throw new Error("stream cleanup failed");
      },
      stopMonitor,
      closeServer: () => {
        throw new Error("server close failed");
      },
      releaseServerRuntime,
      exitProcess,
    });

    await shutdown();

    expect(stopMonitor).toHaveBeenCalledOnce();
    expect(releaseServerRuntime).toHaveBeenCalledOnce();
    expect(exitProcess).toHaveBeenCalledWith(0);
  });
});

describe("buildTailscaleServeProxyTarget", () => {
  it("builds an HTTP upstream target from host and port", () => {
    expect(
      buildTailscaleServeProxyTarget({
        proxyHost: "127.0.0.1",
        displayPort: 11080,
      }),
    ).toBe("http://127.0.0.1:11080");
  });

  it("uses loopback as the Tailscale Serve upstream for a public bind", () => {
    expect(
      buildTailscaleServeProxyTarget({
        proxyHost: "0.0.0.0",
        displayPort: 11080,
      }),
    ).toBe("http://127.0.0.1:11080");
  });
});

describe("buildTailscaleServeCommand", () => {
  it("builds a serve command with explicit upstream target", () => {
    expect(buildTailscaleServeCommand("http://100.102.60.85:11080")).toBe(
      "tailscale serve --bg http://100.102.60.85:11080",
    );
  });
});

describe("collectServeProxyTargets", () => {
  it("collects and deduplicates HTTP proxy targets from serve status json", () => {
    const status = {
      Web: {
        "device.tail123.ts.net:443": {
          Handlers: {
            "/": {
              Proxy: "http://127.0.0.1:11080",
            },
            "/api": {
              Proxy: "http://100.102.60.85:11080/",
            },
          },
        },
      },
      Services: [{ Proxy: "http://127.0.0.1:11080" }],
    };

    expect(collectServeProxyTargets(status).sort()).toEqual([
      "http://100.102.60.85:11080",
      "http://127.0.0.1:11080",
    ]);
  });
});

describe("matchesExpectedTailscaleServeTarget", () => {
  it("returns true when serve status includes expected upstream", () => {
    const status = {
      Web: {
        "device.tail123.ts.net:443": {
          Handlers: {
            "/": {
              Proxy: "http://100.102.60.85:11080/",
            },
          },
        },
      },
    };

    expect(
      matchesExpectedTailscaleServeTarget({
        serveStatus: status,
        expectedProxyTarget: "http://100.102.60.85:11080",
      }),
    ).toBe(true);
  });

  it("returns false when serve status does not include expected upstream", () => {
    const status = {
      Web: {
        "device.tail123.ts.net:443": {
          Handlers: {
            "/": {
              Proxy: "http://127.0.0.1:11080",
            },
          },
        },
      },
    };

    expect(
      matchesExpectedTailscaleServeTarget({
        serveStatus: status,
        expectedProxyTarget: "http://100.102.60.85:11080",
      }),
    ).toBe(false);
  });
});
