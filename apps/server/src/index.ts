#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { createTmuxAdapter } from "@tmux-agent-monitor/tmux";
import qrcode from "qrcode-terminal";

import { createApp } from "./app.js";
import { ensureConfig, rotateToken } from "./config.js";
import { createSessionMonitor } from "./monitor.js";
import { getLocalIP, getTailscaleIP } from "./network.js";
import { findAvailablePort } from "./ports.js";
import { createTmuxActions } from "./tmux-actions.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const flags = new Map<string, string | boolean>();
  let command: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--")) {
      const next = args[i + 1];
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

const printHooksSnippet = () => {
  const snippet = {
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "tmux-agent-monitor-hook PreToolUse" }],
        },
      ],
      PostToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "tmux-agent-monitor-hook PostToolUse" }],
        },
      ],
      Notification: [
        { hooks: [{ type: "command", command: "tmux-agent-monitor-hook Notification" }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "tmux-agent-monitor-hook Stop" }] }],
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "tmux-agent-monitor-hook UserPromptSubmit" }] },
      ],
    },
  };
  console.log(JSON.stringify(snippet, null, 2));
};

const ensureTmuxAvailable = async (adapter: ReturnType<typeof createTmuxAdapter>) => {
  const version = await adapter.run(["-V"]);
  if (version.exitCode !== 0) {
    throw new Error("tmux not available");
  }
  const sessions = await adapter.run(["list-sessions"]);
  if (sessions.exitCode !== 0) {
    throw new Error("tmux server not running");
  }
};

const parsePort = (value: string | boolean | undefined) => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const runServe = async (flags: Map<string, string | boolean>) => {
  const config = ensureConfig();
  const publicBind = flags.has("--public");
  const tailscale = flags.has("--tailscale");
  const noAttach = flags.has("--no-attach");
  const portFlag = flags.get("--port");
  const webPortFlag = flags.get("--web-port");
  const socketName = flags.get("--socket-name");
  const socketPath = flags.get("--socket-path");

  config.bind = publicBind ? "0.0.0.0" : config.bind;
  config.attachOnServe = !noAttach;
  const parsedPort = parsePort(portFlag);
  if (parsedPort) {
    config.port = parsedPort;
  }
  if (typeof socketName === "string") {
    config.tmux.socketName = socketName;
  }
  if (typeof socketPath === "string") {
    config.tmux.socketPath = socketPath;
  }

  const host = config.bind;
  const port = await findAvailablePort(config.port, host, 10);

  const adapter = createTmuxAdapter({
    socketName: config.tmux.socketName,
    socketPath: config.tmux.socketPath,
  });

  await ensureTmuxAvailable(adapter);

  const monitor = createSessionMonitor(adapter, config);
  await monitor.start();

  const tmuxActions = createTmuxActions(adapter, config);
  const { app, injectWebSocket } = createApp({ config, monitor, tmuxActions });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
  injectWebSocket(server);

  const ip = tailscale
    ? (getTailscaleIP() ?? getLocalIP())
    : host === "0.0.0.0"
      ? getLocalIP()
      : "localhost";
  const displayPort = parsePort(webPortFlag) ?? port;
  const url = `http://${ip}:${displayPort}/?token=${config.token}`;
  console.log(`tmux-agent-monitor: ${url}`);

  qrcode.generate(url, { small: true });

  process.on("SIGINT", () => {
    monitor.stop();
    process.exit(0);
  });
};

const main = async () => {
  const { command, positional, flags } = parseArgs();
  if (command === "token" && positional[0] === "rotate") {
    const next = rotateToken();
    console.log(next.token);
    return;
  }
  if (command === "claude" && positional[0] === "hooks" && positional[1] === "print") {
    printHooksSnippet();
    return;
  }

  await runServe(flags);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
