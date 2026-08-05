import { CMUX_METHODS } from "@vde-monitor/cmux";
import { HerdrClient, resolveSocketPath } from "@vde-monitor/herdr";
import { normalizeWeztermTarget } from "@vde-monitor/shared";
import { createTmuxAdapter } from "@vde-monitor/tmux";
import { createWeztermAdapter } from "@vde-monitor/wezterm";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { execa } from "execa";
import qrcode from "qrcode-terminal";

import { createApp } from "../../app";
import { ensureConfig } from "../../config";
import { createSessionMonitor } from "../../monitor";
import { resolveProcessStartedAt } from "../../monitor/runtime-marker";
import { createMultiplexerRuntime } from "../../multiplexer/runtime";
import { getLocalIP, getTailscaleDnsName, getTailscaleIP } from "../../network";
import { createNotificationService } from "../../notifications/service";
import { listenOnAvailablePort } from "../../ports";
import { createScreenCache } from "../../screen/screen-cache";
import { createServerRuntimeMarker } from "../../server-runtime-marker";
import { createScreenStreamScheduler } from "../../streams/screen-stream-scheduler";
import { createSessionsStreamSource } from "../../streams/sessions-stream-source";
import { createStreamConnections } from "../../streams/stream-connections";
import { type ParsedArgs, parsePort, resolveHosts, resolveMultiplexerOverrides } from "../cli/cli";
import {
  buildTailscaleHttpsAccessUrl,
  buildTailscaleServeCommand,
  buildTailscaleServeProxyTarget,
  runTailscaleHttpsPreflight,
} from "./tailscale-setup";

export {
  buildTailscaleHttpsAccessUrl,
  collectServeProxyTargets,
  matchesExpectedTailscaleServeTarget,
  buildTailscaleServeProxyTarget,
  buildTailscaleServeCommand,
} from "./tailscale-setup";

export const ensureTmuxAvailable = async (adapter: ReturnType<typeof createTmuxAdapter>) => {
  const version = await adapter.run(["-V"]);
  if (version.exitCode !== 0) {
    throw new Error("tmux not available");
  }
  const sessions = await adapter.run(["list-sessions"]);
  if (sessions.exitCode !== 0) {
    throw new Error("tmux server not running");
  }
};

export const ensureWeztermAvailable = async (adapter: ReturnType<typeof createWeztermAdapter>) => {
  const result = await adapter.run(["list", "--format", "json"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "wezterm server not running");
  }
};

export const ensureHerdrAvailable = async (client: Pick<HerdrClient, "request" | "close">) => {
  try {
    await client.request("ping", {});
  } finally {
    await client.close();
  }
};

const MINIMUM_CMUX_VERSION = [0, 64, 17] as const;
const MINIMUM_CMUX_DARWIN_MAJOR = 23;
const SUPPORTED_CMUX_ACCESS_MODES = new Set(["cmuxOnly", "automation", "password"]);

export type CmuxCapabilities = {
  protocol: "cmux-socket";
  version: number;
  socket_path: string;
  access_mode: string;
  methods: string[];
};

type CmuxCliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunCmuxCli = (
  cliPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<CmuxCliResult>;

type ResolveCmuxConnectionOptions = {
  socketPath: string | null;
  env?: NodeJS.ProcessEnv;
};

const runCmuxCli: RunCmuxCli = async (cliPath, args, env) => {
  const result = await execa(cliPath, args, {
    env,
    reject: false,
    timeout: 10_000,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? -1,
  };
};

// The socket password is accepted only through CMUX_SOCKET_PASSWORD; storing
// it in the config file is intentionally unsupported (plan NFR-04).
export const resolveCmuxConnectionOptions = ({
  socketPath,
  env = process.env,
}: ResolveCmuxConnectionOptions) => {
  const environmentPassword = env.CMUX_SOCKET_PASSWORD;
  if (environmentPassword === "") {
    throw new Error("CMUX_SOCKET_PASSWORD must not be empty");
  }
  return {
    socketPath: socketPath?.trim() || env.CMUX_SOCKET_PATH?.trim() || null,
    password: environmentPassword ?? null,
  };
};

const parseCmuxVersion = (raw: string): readonly [number, number, number] | null => {
  const match = raw.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isMinimumCmuxVersion = (version: readonly [number, number, number]) => {
  for (let index = 0; index < MINIMUM_CMUX_VERSION.length; index += 1) {
    const actual = version[index] ?? 0;
    const minimum = MINIMUM_CMUX_VERSION[index] ?? 0;
    if (actual !== minimum) return actual > minimum;
  }
  return true;
};

const parseCmuxCapabilities = (raw: string): CmuxCapabilities => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("cmux capabilities returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("cmux capabilities returned an invalid payload");
  }
  const capabilities = parsed as Record<string, unknown>;
  if (
    capabilities.protocol !== "cmux-socket" ||
    capabilities.version !== 2 ||
    typeof capabilities.socket_path !== "string" ||
    capabilities.socket_path.trim().length === 0 ||
    typeof capabilities.access_mode !== "string" ||
    !Array.isArray(capabilities.methods) ||
    capabilities.methods.some((method) => typeof method !== "string")
  ) {
    throw new Error("cmux capabilities is missing the required v2 socket metadata");
  }
  return capabilities as CmuxCapabilities;
};

export const ensureCmuxPlatformSupported = (
  platform: NodeJS.Platform = process.platform,
  osRelease: string = os.release(),
): void => {
  if (platform !== "darwin") {
    throw new Error("cmux requires macOS 14 or newer");
  }
  const darwinMajor = Number.parseInt(osRelease.split(".")[0] ?? "", 10);
  if (!Number.isSafeInteger(darwinMajor) || darwinMajor < MINIMUM_CMUX_DARWIN_MAJOR) {
    throw new Error("cmux requires macOS 14 or newer");
  }
};

export const ensureCmuxAvailable = async ({
  cliPath,
  socketPath,
  password,
  requiredMethods,
  run = runCmuxCli,
  platform = process.platform,
  osRelease = os.release(),
}: {
  cliPath: string;
  socketPath: string | null;
  password: string | null;
  requiredMethods: readonly string[];
  run?: RunCmuxCli;
  platform?: NodeJS.Platform;
  osRelease?: string;
}): Promise<CmuxCapabilities> => {
  ensureCmuxPlatformSupported(platform, osRelease);
  const versionResult = await run(cliPath, ["--version"], { ...process.env });
  if (versionResult.exitCode !== 0) {
    throw new Error(versionResult.stderr.trim() || "cmux CLI is not available");
  }
  const version = parseCmuxVersion(versionResult.stdout);
  if (!version) {
    throw new Error("unable to determine cmux version");
  }
  if (!isMinimumCmuxVersion(version)) {
    throw new Error("cmux 0.64.17 or newer is required");
  }

  const selectedSocketPath = socketPath?.trim() || null;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CMUX_SOCKET;
  if (selectedSocketPath) {
    env.CMUX_SOCKET_PATH = selectedSocketPath;
  } else {
    delete env.CMUX_SOCKET_PATH;
  }
  if (password != null) {
    env.CMUX_SOCKET_PASSWORD = password;
  } else {
    delete env.CMUX_SOCKET_PASSWORD;
  }

  const capabilitiesResult = await run(
    cliPath,
    ["--json", "--id-format", "uuids", "capabilities"],
    env,
  );
  if (capabilitiesResult.exitCode !== 0) {
    const detail = capabilitiesResult.stderr.trim() || "cmux socket is not available";
    throw new Error(
      `cmux socket preflight failed: ${detail}. Start vde-monitor inside a cmux terminal, or select Automation/Password under cmux Settings > Automation > Socket Control Mode.`,
    );
  }
  const capabilities = parseCmuxCapabilities(capabilitiesResult.stdout);
  if (!path.isAbsolute(capabilities.socket_path) || capabilities.socket_path.includes("\0")) {
    throw new Error("cmux requires a local Unix socket with an absolute filesystem path");
  }
  if (!SUPPORTED_CMUX_ACCESS_MODES.has(capabilities.access_mode)) {
    throw new Error(`cmux access mode is not supported: ${capabilities.access_mode}`);
  }
  if (capabilities.access_mode === "password" && password == null) {
    throw new Error("cmux password access mode requires a socket password");
  }

  const advertisedMethods = new Set(capabilities.methods);
  const missingMethods = [...new Set(requiredMethods)].filter(
    (method) => !advertisedMethods.has(method),
  );
  if (missingMethods.length > 0) {
    throw new Error(`cmux is missing required socket methods: ${missingMethods.join(", ")}`);
  }
  return capabilities;
};

export const ensureBackendAvailable = async (
  config: ReturnType<typeof ensureConfig>,
): Promise<void> => {
  if (config.multiplexer.backend === "tmux") {
    const tmuxAdapter = createTmuxAdapter({
      socketName: config.tmux.socketName,
      socketPath: config.tmux.socketPath,
    });
    await ensureTmuxAvailable(tmuxAdapter);
    return;
  }
  if (config.multiplexer.backend === "herdr") {
    const client = new HerdrClient(resolveSocketPath(process.env, os.homedir()));
    await ensureHerdrAvailable(client);
    return;
  }
  if (config.multiplexer.backend === "cmux") {
    const connection = resolveCmuxConnectionOptions({
      socketPath: config.multiplexer.cmux.socketPath,
    });
    const capabilities = await ensureCmuxAvailable({
      cliPath: config.multiplexer.cmux.cliPath,
      socketPath: connection.socketPath,
      password: connection.password,
      requiredMethods: Object.values(CMUX_METHODS),
    });
    config.multiplexer.cmux.socketPath = capabilities.socket_path;
    config.multiplexer.cmux.password = connection.password;
    return;
  }
  const weztermAdapter = createWeztermAdapter({
    cliPath: config.multiplexer.wezterm.cliPath,
    target: config.multiplexer.wezterm.target,
  });
  await ensureWeztermAvailable(weztermAdapter);
};

type BuildAccessUrlInput = {
  displayHost: string;
  displayPort: number;
  token: string;
  apiBaseUrl?: string | null;
};

export const buildAccessUrl = ({
  displayHost,
  displayPort,
  token,
  apiBaseUrl,
}: BuildAccessUrlInput) => {
  const hashParams = new URLSearchParams({ token });
  if (apiBaseUrl) {
    hashParams.set("api", apiBaseUrl);
  }
  return `http://${displayHost}:${displayPort}/#${hashParams.toString()}`;
};

type CliOverrides = {
  port?: number;
  socketName?: string;
  socketPath?: string;
  multiplexerBackend?: string;
  screenImageBackend?: string;
  weztermCliPath?: string;
  weztermTarget?: string;
  cmuxCliPath?: string;
  cmuxSocketPath?: string;
};

const MONITOR_STOP_TIMEOUT_MS = 5000;
const SERVER_CLOSE_TIMEOUT_MS = 3000;

export const closeServerWithTimeout = async ({
  closeServer,
  timeoutMs = SERVER_CLOSE_TIMEOUT_MS,
}: {
  closeServer: (onClosed: () => void) => void;
  timeoutMs?: number;
}): Promise<void> => {
  await new Promise<void>((resolve) => {
    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (completed) return;
      completed = true;
      if (timeout !== null) clearTimeout(timeout);
      resolve();
    };

    try {
      closeServer(finish);
    } catch {
      finish();
    }
    if (completed) return;
    timeout = setTimeout(finish, timeoutMs);
    timeout.unref();
  });
};

export const stopMonitorAndDisposeRuntime = async ({
  stopMonitor,
  disposeRuntime,
}: {
  stopMonitor: () => void | Promise<void>;
  disposeRuntime?: () => void | Promise<void>;
}): Promise<void> => {
  try {
    await stopMonitor();
  } finally {
    await disposeRuntime?.();
  }
};

export const cleanupFailedServeSetup = async ({
  streamCleanups = [],
  closeServer,
  stopMonitor,
  disposeRuntime,
  releaseServerRuntime,
}: {
  streamCleanups?: Array<() => unknown | Promise<unknown>>;
  closeServer?: (onClosed: () => void) => void;
  stopMonitor?: () => void | Promise<void>;
  disposeRuntime?: () => void | Promise<void>;
  releaseServerRuntime: () => unknown | Promise<unknown>;
}): Promise<void> => {
  await Promise.allSettled(streamCleanups.map((cleanup) => Promise.resolve().then(cleanup)));
  await Promise.allSettled([
    closeServer == null ? Promise.resolve() : closeServerWithTimeout({ closeServer }),
    stopMonitor == null
      ? Promise.resolve().then(() => disposeRuntime?.())
      : stopMonitorAndDisposeRuntime({ stopMonitor, disposeRuntime }),
  ]);
  await Promise.resolve()
    .then(releaseServerRuntime)
    .catch(() => undefined);
};

export const createGracefulShutdown = ({
  closeStreams,
  stopMonitor,
  closeServer,
  releaseServerRuntime,
  exitProcess = (code) => process.exit(code),
}: {
  closeStreams: () => void;
  stopMonitor: () => void | Promise<void>;
  closeServer: (onClosed: () => void) => void;
  releaseServerRuntime?: () => void | Promise<void>;
  exitProcess?: (code: number) => void;
}): (() => Promise<void>) => {
  let shutdownPromise: Promise<void> | null = null;

  const waitForMonitorStop = async (): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, MONITOR_STOP_TIMEOUT_MS);
      timeout.unref();
    });
    try {
      await Promise.race([
        Promise.resolve()
          .then(() => stopMonitor())
          .catch(() => undefined),
        timeoutPromise,
      ]);
    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    }
  };

  return () => {
    if (shutdownPromise !== null) return shutdownPromise;
    shutdownPromise = (async () => {
      await Promise.resolve()
        .then(closeStreams)
        .catch(() => undefined);
      await waitForMonitorStop();
      // The close guard begins only after the monitor has stopped or its separate owned-pipe
      // detach timeout has elapsed.
      await closeServerWithTimeout({ closeServer });
      await Promise.resolve()
        .then(() => releaseServerRuntime?.())
        .catch(() => undefined);
      exitProcess(0);
    })();
    return shutdownPromise;
  };
};

/**
 * Single mutation point for applying CLI argument overrides onto a resolved config object.
 * All direct config property assignments from CLI args are performed here and nowhere else.
 */
const applyCliOverrides = (
  config: ReturnType<typeof ensureConfig>,
  overrides: CliOverrides,
): void => {
  if (overrides.port != null) {
    config.port = overrides.port;
  }
  if (overrides.socketName != null) {
    config.tmux.socketName = overrides.socketName;
  }
  if (overrides.socketPath != null) {
    config.tmux.socketPath = overrides.socketPath;
  }
  if (overrides.multiplexerBackend != null) {
    config.multiplexer.backend = overrides.multiplexerBackend as typeof config.multiplexer.backend;
  }
  if (overrides.screenImageBackend != null) {
    config.screen.image.backend =
      overrides.screenImageBackend as typeof config.screen.image.backend;
  }
  if (overrides.weztermCliPath != null) {
    config.multiplexer.wezterm.cliPath = overrides.weztermCliPath;
  }
  if (overrides.weztermTarget != null) {
    config.multiplexer.wezterm.target = overrides.weztermTarget;
  }
  if (overrides.cmuxCliPath != null) {
    config.multiplexer.cmux.cliPath = overrides.cmuxCliPath;
  }
  if (overrides.cmuxSocketPath != null) {
    config.multiplexer.cmux.socketPath = overrides.cmuxSocketPath;
  }
  // Always normalise the wezterm target after all overrides are applied
  config.multiplexer.wezterm.target = normalizeWeztermTarget(config.multiplexer.wezterm.target);
};

export const runServe = async (args: ParsedArgs) => {
  const parsedPort = parsePort(args.port);
  const parsedWebPort = parsePort(args.webPort);
  const serverProcessStartedAt = resolveProcessStartedAt(process.pid);
  const serverRuntimeMarker = createServerRuntimeMarker({
    pid: process.pid,
    processStartedAt: serverProcessStartedAt,
  });
  await serverRuntimeMarker.claim();
  let runtime: ReturnType<typeof createMultiplexerRuntime> | undefined;
  let monitor: ReturnType<typeof createSessionMonitor> | undefined;
  let monitorStartAttempted = false;
  let streamConnections: ReturnType<typeof createStreamConnections> | undefined;
  let streamSource: ReturnType<typeof createSessionsStreamSource> | undefined;
  let screenScheduler: ReturnType<typeof createScreenStreamScheduler> | undefined;
  let boundServer: ReturnType<typeof serve> | undefined;
  let setupCompleted = false;
  try {
    const config = ensureConfig();
    const multiplexerOverrides = resolveMultiplexerOverrides(args);

    const { bindHost, displayHost } = resolveHosts({
      args,
      configBind: config.bind,
      getLocalIP,
      getTailscaleIP,
    });

    // Collect all CLI overrides and apply them through the single mutation point
    applyCliOverrides(config, {
      port: parsedPort ?? undefined,
      socketName: typeof args.socketName === "string" ? args.socketName : undefined,
      socketPath: typeof args.socketPath === "string" ? args.socketPath : undefined,
      multiplexerBackend: multiplexerOverrides.multiplexerBackend ?? undefined,
      screenImageBackend: multiplexerOverrides.screenImageBackend ?? undefined,
      weztermCliPath: multiplexerOverrides.weztermCliPath ?? undefined,
      weztermTarget: multiplexerOverrides.weztermTarget ?? undefined,
      cmuxCliPath: multiplexerOverrides.cmuxCliPath ?? undefined,
      cmuxSocketPath: multiplexerOverrides.cmuxSocketPath ?? undefined,
    });

    const host = bindHost;

    await ensureBackendAvailable(config);

    const activeRuntime = createMultiplexerRuntime(config);
    runtime = activeRuntime;
    const notificationService = createNotificationService({ config });
    const activeMonitor = createSessionMonitor(activeRuntime, config, {
      onSessionTransition: (event) => notificationService.dispatchTransition(event),
    });
    monitor = activeMonitor;
    monitorStartAttempted = true;
    await activeMonitor.start();

    // Instantiate the SSE infrastructure.
    const schedulerScreenCache = createScreenCache();
    const activeStreamConnections = createStreamConnections();
    streamConnections = activeStreamConnections;
    const activeStreamSource = createSessionsStreamSource({ registry: activeMonitor.registry });
    streamSource = activeStreamSource;
    const activeScreenScheduler = createScreenStreamScheduler({
      monitor: activeMonitor,
      config,
      buildTextResponse: schedulerScreenCache.buildTextResponse,
    });
    screenScheduler = activeScreenScheduler;

    const { app } = createApp({
      config,
      monitor: activeMonitor,
      actions: activeRuntime.actions,
      launchCapability: activeRuntime.capabilities.launch,
      notificationService,
      streamSource: activeStreamSource,
      screenScheduler: activeScreenScheduler,
      streamConnections: activeStreamConnections,
    });

    const bound = await listenOnAvailablePort({
      startPort: config.port,
      host,
      attempts: 10,
      listen: (candidatePort, onListening) =>
        serve(
          {
            fetch: app.fetch,
            port: candidatePort,
            hostname: host,
          },
          onListening,
        ),
    });
    const activeServer = bound.server;
    boundServer = activeServer;
    const port = bound.port;

    await serverRuntimeMarker.publish({
      host: host === "0.0.0.0" ? "127.0.0.1" : host,
      port,
    });
    const displayPort = parsedWebPort ?? port;
    const apiBaseUrl =
      parsedWebPort != null && parsedWebPort !== port ? `http://${displayHost}:${port}/api` : null;
    const url = buildAccessUrl({
      displayHost,
      displayPort,
      token: config.token,
      apiBaseUrl,
    });
    console.log(`vde-monitor: ${url}`);
    let qrUrl = url;
    const useTailscaleHttps = args.tailscale === true && args.https === true;

    if (useTailscaleHttps) {
      const expectedProxyTarget = buildTailscaleServeProxyTarget({
        proxyHost: host,
        displayPort,
      });
      const manualCommand = buildTailscaleServeCommand(expectedProxyTarget);
      console.log(
        `[vde-monitor] Push notification testing requires HTTPS. Expected tailscale upstream: ${expectedProxyTarget}`,
      );
      console.log(`[vde-monitor] Run (or update) serve: ${manualCommand}`);
      console.log("[vde-monitor] Confirm serve endpoint: tailscale serve status");
      const preflight = await runTailscaleHttpsPreflight(expectedProxyTarget);
      const tailscaleDnsName = preflight.dnsName ?? getTailscaleDnsName();
      if (tailscaleDnsName) {
        const secureUrl = buildTailscaleHttpsAccessUrl({
          dnsName: tailscaleDnsName,
          token: config.token,
        });
        qrUrl = secureUrl;
        console.log(`vde-monitor (tailscale-https): ${secureUrl}`);
        if (apiBaseUrl) {
          console.log(
            "[vde-monitor] Use the tailscale-https URL above for push tests (it intentionally omits #api).",
          );
        }
      } else {
        console.log(
          "[vde-monitor] Could not resolve Tailscale DNSName automatically. Use your <device>.<tailnet>.ts.net host.",
        );
      }
    }

    qrcode.generate(qrUrl, { small: true });

    const shutdown = createGracefulShutdown({
      // 1. Disconnect all SSE connections so clients reconnect.
      closeStreams: () => {
        activeStreamConnections.closeAll();
        activeStreamSource.dispose();
        activeScreenScheduler.dispose();
      },
      // 2. Wait up to five seconds for the monitor to stop, including owned pipe detachment.
      stopMonitor: () =>
        stopMonitorAndDisposeRuntime({
          stopMonitor: () => activeMonitor.stop(),
          disposeRuntime: activeRuntime.dispose,
        }),
      // 3. Stop accepting new HTTP connections and close existing keep-alive connections.
      closeServer: (onClosed) => activeServer.close(onClosed),
      // 4. Release the process-owned single-server claim only after HTTP has stopped.
      releaseServerRuntime: async () => {
        await serverRuntimeMarker.removeIfOwned();
      },
    });

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    setupCompleted = true;
  } finally {
    if (!setupCompleted) {
      await cleanupFailedServeSetup({
        streamCleanups: [
          () => streamConnections?.closeAll(),
          () => streamSource?.dispose(),
          () => screenScheduler?.dispose(),
        ],
        closeServer: boundServer == null ? undefined : (onClosed) => boundServer?.close(onClosed),
        stopMonitor: monitorStartAttempted && monitor != null ? () => monitor?.stop() : undefined,
        disposeRuntime: runtime?.dispose,
        releaseServerRuntime: serverRuntimeMarker.removeIfOwned,
      });
    }
  }
};
