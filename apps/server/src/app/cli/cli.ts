import path from "node:path";

import type { AgentMonitorConfig } from "@vde-monitor/multiplexer";
import type { ArgsDef, ParsedArgs as CittyParsedArgs } from "citty";
import { parseArgs as parseCittyArgs } from "citty";

const multiplexerBackends = ["tmux", "wezterm", "herdr", "cmux"] as const;
const imageBackends = ["alacritty", "terminal", "iterm", "wezterm", "ghostty"] as const;

const cliArgDefinitions = {
  command: { type: "positional", required: false },
  subcommand: { type: "positional", required: false },
  subcommand2: { type: "positional", required: false },
  dryRun: { type: "boolean" },
  bind: { type: "string" },
  public: { type: "boolean" },
  tailscale: { type: "boolean" },
  https: { type: "boolean" },
  port: { type: "string" },
  webPort: { type: "string" },
  socketName: { type: "string" },
  socketPath: { type: "string" },
  multiplexer: { type: "enum", options: [...multiplexerBackends] },
  backend: { type: "enum", options: [...imageBackends] },
  weztermCli: { type: "string" },
  weztermTarget: { type: "string" },
  cmuxCli: { type: "string" },
  cmuxSocket: { type: "string" },
  runtimeDir: { type: "string" },
  serverIdentity: { type: "string" },
  help: { type: "boolean" },
} satisfies ArgsDef;

export type ParsedArgs = CittyParsedArgs<typeof cliArgDefinitions>;

export type ResolvedHosts = {
  bindHost: string;
  displayHost: string;
};

export type MultiplexerOverrides = {
  multiplexerBackend?: AgentMonitorConfig["multiplexer"]["backend"];
  screenImageBackend?: AgentMonitorConfig["screen"]["image"]["backend"];
  weztermCliPath?: string;
  weztermTarget?: string;
  cmuxCliPath?: string;
  cmuxSocketPath?: string;
};

export type PaneLogDaemonCommandArgs = {
  runtimeDir: string;
  serverIdentity: string;
};

type ResolveHostsOptions = {
  args: ParsedArgs;
  configBind: AgentMonitorConfig["bind"];
  getLocalIP: () => string;
  getTailscaleIP: () => string | null;
};

const normalizeRawArgv = (argv: string[]) => argv.filter((token) => token !== "--");

const paneLogDaemonFlags = ["--runtime-dir", "--server-identity"] as const;

const assertNoDuplicatePaneLogDaemonFlags = (argv: string[]) => {
  for (const flag of paneLogDaemonFlags) {
    const count = argv.filter((token) => token === flag || token.startsWith(`${flag}=`)).length;
    if (count > 1) {
      throw new Error(`${flag} may only be specified once.`);
    }
  }
};

const isPaneLogDaemonCommand = (args: ParsedArgs) =>
  args.command === "internal" && args.subcommand === "pane-log-daemon" && args.subcommand2 == null;

export const parseArgs = (argv = process.argv.slice(2)): ParsedArgs => {
  const normalizedArgv = normalizeRawArgv(argv);
  assertNoDuplicatePaneLogDaemonFlags(normalizedArgv);
  const parsed = parseCittyArgs<typeof cliArgDefinitions>(normalizedArgv, cliArgDefinitions);
  const definitionKeys = Object.keys(cliArgDefinitions);
  const knownKeys = new Set([
    "_",
    ...definitionKeys,
    ...definitionKeys.map((key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
  ]);
  const unknownKey = Object.keys(parsed).find((key) => !knownKeys.has(key));
  if (unknownKey != null) {
    throw new Error(`Unknown option: --${unknownKey}`);
  }
  const hasPaneLogDaemonOptions = parsed.runtimeDir != null || parsed.serverIdentity != null;
  if (hasPaneLogDaemonOptions && !isPaneLogDaemonCommand(parsed)) {
    throw new Error("--runtime-dir and --server-identity are only valid for the internal daemon.");
  }
  return parsed;
};

const requireStringOption = (value: unknown, flag: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

export const resolvePaneLogDaemonCommandArgs = (args: ParsedArgs): PaneLogDaemonCommandArgs => {
  if (!isPaneLogDaemonCommand(args)) {
    throw new Error("internal pane-log-daemon requires exactly two positional command parts.");
  }
  const runtimeDir = requireStringOption(args.runtimeDir, "--runtime-dir");
  if (!path.isAbsolute(runtimeDir)) {
    throw new Error(`--runtime-dir must be absolute. (received: ${runtimeDir})`);
  }
  const serverIdentity = requireStringOption(args.serverIdentity, "--server-identity");
  if (!/^[a-f0-9]{64}$/.test(serverIdentity)) {
    throw new Error("--server-identity must be a lowercase SHA-256 hex digest.");
  }
  return {
    runtimeDir,
    serverIdentity,
  };
};

export const parsePort = (value: unknown) => {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    const received = typeof value === "string" ? value : `value of type ${typeof value}`;
    throw new Error(`port must be an integer between 1 and 65535. (received: ${received})`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`port must be an integer between 1 and 65535. (received: ${value})`);
  }
  return parsed;
};

const readOptionalString = (value: unknown, flag: string): string | null => {
  if (value == null) {
    return null;
  }
  if (value === true || value === "") {
    throw new Error(`${flag} requires a value.`);
  }
  if (typeof value !== "string") {
    return null;
  }
  return value;
};

const isIPv4 = (value: string) => {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const parsed = Number(part);
    return parsed >= 0 && parsed <= 255 && String(parsed) === part;
  });
};

const parseBind = (value: unknown) => {
  const bind = readOptionalString(value, "--bind");
  if (bind == null) {
    return null;
  }
  if (!isIPv4(bind)) {
    throw new Error(`--bind must be a valid IPv4 address. (received: ${bind})`);
  }
  return bind;
};

const resolveTailscaleIP = (enabled: boolean, getTailscaleIP: () => string | null) => {
  if (!enabled) {
    return null;
  }
  const tailscaleIP = getTailscaleIP();
  if (!tailscaleIP) {
    throw new Error("Tailscale IP not found. Is Tailscale running?");
  }
  return tailscaleIP;
};

const resolveBindHost = ({
  bindFlag,
  publicBind,
  tailscaleIP,
  tailscaleHttps,
  configBind,
}: {
  bindFlag: string | null;
  publicBind: boolean;
  tailscaleIP: string | null;
  tailscaleHttps: boolean;
  configBind: AgentMonitorConfig["bind"];
}) => {
  if (bindFlag) {
    return bindFlag;
  }
  if (publicBind) {
    return "0.0.0.0";
  }
  if (tailscaleHttps) {
    return "127.0.0.1";
  }
  if (tailscaleIP) {
    return tailscaleIP;
  }
  return configBind;
};

const resolveDisplayHost = ({
  bindHost,
  bindFlag,
  tailscaleIP,
  getLocalIP,
}: {
  bindHost: string;
  bindFlag: string | null;
  tailscaleIP: string | null;
  getLocalIP: () => string;
}) => {
  if (tailscaleIP) {
    return tailscaleIP;
  }
  if (bindHost === "0.0.0.0") {
    return getLocalIP();
  }
  if (bindFlag) {
    return bindHost;
  }
  return bindHost === "127.0.0.1" ? "localhost" : bindHost;
};

export const resolveHosts = ({
  args,
  configBind,
  getLocalIP,
  getTailscaleIP,
}: ResolveHostsOptions): ResolvedHosts => {
  const bindFlag = parseBind(args.bind);
  const publicBind = args.public === true;
  const tailscale = args.tailscale === true;
  const https = args.https === true;
  const tailscaleHttps = tailscale && https;

  if (bindFlag && tailscale) {
    throw new Error("--bind and --tailscale cannot be used together.");
  }

  const tailscaleIP = resolveTailscaleIP(tailscale, getTailscaleIP);
  const bindHost = resolveBindHost({
    bindFlag,
    publicBind,
    tailscaleIP,
    tailscaleHttps,
    configBind,
  });
  const displayHost = resolveDisplayHost({
    bindHost,
    bindFlag,
    tailscaleIP,
    getLocalIP,
  });

  return { bindHost, displayHost };
};

export const resolveMultiplexerOverrides = (args: ParsedArgs): MultiplexerOverrides => {
  const overrides: MultiplexerOverrides = {};

  if (args.multiplexer) {
    overrides.multiplexerBackend = args.multiplexer;
  }

  if (args.backend) {
    overrides.screenImageBackend = args.backend;
  }

  const weztermCliPath = readOptionalString(args.weztermCli, "--wezterm-cli");
  if (weztermCliPath) {
    overrides.weztermCliPath = weztermCliPath;
  }

  const weztermTarget = readOptionalString(args.weztermTarget, "--wezterm-target");
  if (weztermTarget) {
    overrides.weztermTarget = weztermTarget;
  }

  const cmuxCliPath = readOptionalString(args.cmuxCli, "--cmux-cli");
  if (cmuxCliPath) {
    overrides.cmuxCliPath = cmuxCliPath;
  }

  const cmuxSocketPath = readOptionalString(args.cmuxSocket, "--cmux-socket");
  if (cmuxSocketPath) {
    overrides.cmuxSocketPath = cmuxSocketPath;
  }

  return overrides;
};
