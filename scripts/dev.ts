#!/usr/bin/env node
import { createServer as createNetServer } from "node:net";

import { execa } from "execa";

const argv = process.argv.slice(2);
const separatorIndex = argv.indexOf("--");
const scriptArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
const passthroughArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : argv;
const allArgs = [...scriptArgs, ...passthroughArgs];
const hasFlag = (flag: string) => allArgs.includes(flag);
const getFlagValue = (flag: string) => {
  const index = allArgs.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = allArgs[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
};

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const isPublic = hasFlag("--public");
const isTailscale = hasFlag("--tailscale");
const shouldExposeWeb = isPublic || isTailscale;
const shouldExposeServer = isPublic || isTailscale;
const bindHost = getFlagValue("--bind");
const DEFAULT_SERVER_PORT = 11080;
const SERVER_PORT_ATTEMPTS = 100;

const stripAnsi = (input: string) => {
  let result = "";
  for (let i = 0; i < input.length; i += 1) {
    if (input.charCodeAt(i) === 27) {
      i += 1;
      while (i < input.length && input[i] !== "m") {
        i += 1;
      }
      continue;
    }
    result += input[i];
  }
  return result;
};
const extractPort = (input: string) => {
  const cleaned = stripAnsi(input);
  const matches = cleaned.match(/https?:\/\/\S+/g);
  if (!matches) {
    return null;
  }
  for (const raw of matches) {
    const token = raw.replace(/[),]/g, "");
    try {
      const url = new URL(token);
      if (url.port) {
        return Number(url.port);
      }
    } catch {
      // ignore invalid URL
    }
  }
  return null;
};

const parsePort = (value: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const isPortAvailable = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = createNetServer();
    server.once("error", () => {
      server.close();
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });

const findAvailablePort = async (startPort: number, host: string, attempts: number) => {
  for (let i = 0; i < attempts; i += 1) {
    const port = startPort + i;
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error(
    `No available server port found in range ${startPort}-${startPort + attempts - 1}`,
  );
};

const resolvePortProbeHost = () => {
  if (bindHost) {
    return bindHost;
  }
  return shouldExposeServer ? "0.0.0.0" : "127.0.0.1";
};

const resolveProxyHost = () => {
  if (bindHost && bindHost !== "0.0.0.0") {
    return bindHost;
  }
  return "127.0.0.1";
};

const resolveServerPort = async () => {
  const requestedByPassthrough = parsePort(getFlagValue("--port"));
  if (requestedByPassthrough) {
    return requestedByPassthrough;
  }
  const requestedByScript = parsePort(getFlagValue("--server-port"));
  if (requestedByScript) {
    return requestedByScript;
  }
  return findAvailablePort(DEFAULT_SERVER_PORT, resolvePortProbeHost(), SERVER_PORT_ATTEMPTS);
};

const spawnPnpm = (args: string[], env?: NodeJS.ProcessEnv) => {
  return execa(pnpmCmd, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : process.env,
    reject: false,
  });
};

const main = async () => {
  const resolvedServerPort = await resolveServerPort();

  if (isTailscale && !isPublic) {
    console.warn(
      "[vde-monitor] --tailscale detected. Enabling --public for dev (web/server) to allow Vite WS proxy access.",
    );
  }

  let serverProcess: ReturnType<typeof execa> | null = null;
  let shuttingDown = false;
  let webBuffer = "";

  const webArgs = ["--filter", "@vde-monitor/web", shouldExposeWeb ? "dev:public" : "dev"];
  const webProcess = spawnPnpm(webArgs, {
    VITE_API_PROXY_TARGET: `http://${resolveProxyHost()}:${resolvedServerPort}`,
  });

  const startServer = (webPort: number) => {
    if (serverProcess) {
      return;
    }
    const args = ["--filter", "@vde-monitor/server", "dev", "--"];
    const hasForwarded = (flag: string) => passthroughArgs.includes(flag);
    if (shouldExposeServer && !hasForwarded("--public")) {
      args.push("--public");
    }
    if (isTailscale && !hasForwarded("--tailscale")) {
      args.push("--tailscale");
    }
    if (bindHost && !hasForwarded("--bind")) {
      args.push("--bind", bindHost);
    }
    if (!hasForwarded("--port")) {
      args.push("--port", String(resolvedServerPort));
    }
    args.push(...passthroughArgs);
    args.push("--web-port", String(webPort));
    serverProcess = spawnPnpm(args);
    serverProcess.stdout?.on("data", (data) => process.stdout.write(data));
    serverProcess.stderr?.on("data", (data) => process.stderr.write(data));
    serverProcess.on("exit", (code, signal) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      webProcess.kill("SIGTERM");
      process.exit(code ?? (signal ? 1 : 0));
    });
  };

  const handleWebOutput = (data: Buffer, isError = false) => {
    const text = data.toString();
    if (isError) {
      process.stderr.write(text);
    } else {
      process.stdout.write(text);
    }
    if (serverProcess) {
      return;
    }
    webBuffer += text;
    const lines = webBuffer.split(/\r?\n/);
    webBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const port = extractPort(line);
      if (port) {
        startServer(port);
        break;
      }
    }
  };

  webProcess.stdout?.on("data", (data: Buffer) => handleWebOutput(data));
  webProcess.stderr?.on("data", (data: Buffer) => handleWebOutput(data, true));

  webProcess.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
    process.exit(code ?? (signal ? 1 : 0));
  });

  process.on("SIGINT", () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    webProcess.kill("SIGINT");
    serverProcess?.kill("SIGINT");
  });
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
