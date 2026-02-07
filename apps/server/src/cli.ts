import type { AgentMonitorConfig } from "@vde-monitor/shared";

type FlagValue = string | boolean | undefined;

export type ParsedArgs = {
  command: string | null;
  flags: Map<string, string | boolean>;
  positional: string[];
};

export type ResolvedHosts = {
  bindHost: string;
  displayHost: string;
};

export type MultiplexerOverrides = {
  backend?: AgentMonitorConfig["multiplexer"]["backend"];
  weztermCliPath?: string;
  weztermTarget?: string;
};

type ResolveHostsOptions = {
  flags: Map<string, string | boolean>;
  configBind: AgentMonitorConfig["bind"];
  getLocalIP: () => string;
  getTailscaleIP: () => string | null;
};

export const parseArgs = (argv = process.argv.slice(2)): ParsedArgs => {
  const flags = new Map<string, string | boolean>();
  let command: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(arg, next);
        i += 1;
      } else {
        flags.set(arg, true);
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
};

export const parsePort = (value: FlagValue) => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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

const parseBind = (value: FlagValue) => {
  if (value === undefined) {
    return null;
  }
  if (value === true) {
    throw new Error("--bind requires an IPv4 address.");
  }
  if (typeof value !== "string") {
    return null;
  }
  if (!isIPv4(value)) {
    throw new Error(`--bind must be a valid IPv4 address. (received: ${value})`);
  }
  return value;
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
  configBind,
}: {
  bindFlag: string | null;
  publicBind: boolean;
  tailscaleIP: string | null;
  configBind: AgentMonitorConfig["bind"];
}) => {
  if (bindFlag) {
    return bindFlag;
  }
  if (publicBind) {
    return "0.0.0.0";
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
  flags,
  configBind,
  getLocalIP,
  getTailscaleIP,
}: ResolveHostsOptions): ResolvedHosts => {
  const bindFlag = parseBind(flags.get("--bind"));
  const publicBind = flags.has("--public");
  const tailscale = flags.has("--tailscale");

  if (bindFlag && tailscale) {
    throw new Error("--bind and --tailscale cannot be used together.");
  }

  const tailscaleIP = resolveTailscaleIP(tailscale, getTailscaleIP);
  const bindHost = resolveBindHost({
    bindFlag,
    publicBind,
    tailscaleIP,
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

const resolveRequiredStringFlag = (
  flags: Map<string, string | boolean>,
  flag: string,
): string | null => {
  if (!flags.has(flag)) {
    return null;
  }
  const value = flags.get(flag);
  if (value === true || value === undefined) {
    throw new Error(`${flag} requires a value.`);
  }
  if (typeof value !== "string") {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

export const resolveMultiplexerOverrides = (
  flags: Map<string, string | boolean>,
): MultiplexerOverrides => {
  const overrides: MultiplexerOverrides = {};

  const backend = resolveRequiredStringFlag(flags, "--multiplexer");
  if (backend) {
    if (backend !== "tmux" && backend !== "wezterm") {
      throw new Error(`--multiplexer must be one of: tmux, wezterm. (received: ${backend})`);
    }
    overrides.backend = backend;
  }

  const weztermCliPath = resolveRequiredStringFlag(flags, "--wezterm-cli");
  if (weztermCliPath) {
    overrides.weztermCliPath = weztermCliPath;
  }

  const weztermTarget = resolveRequiredStringFlag(flags, "--wezterm-target");
  if (weztermTarget) {
    overrides.weztermTarget = weztermTarget;
  }

  return overrides;
};
