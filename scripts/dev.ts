#!/usr/bin/env node
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const hasFlag = (flag: string) => argv.includes(flag);
const getFlagValue = (flag: string) => {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
};

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const isPublic = hasFlag("--public");
const serverPort = getFlagValue("--server-port");

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

const spawnPnpm = (args: string[]) => {
  return spawn(pnpmCmd, args, { stdio: ["inherit", "pipe", "pipe"] });
};

let serverProcess: ReturnType<typeof spawn> | null = null;
let shuttingDown = false;
let webBuffer = "";

const startServer = (webPort: number) => {
  if (serverProcess) {
    return;
  }
  const args = ["--filter", "@tmux-agent-monitor/server", "dev", "--"];
  if (isPublic) {
    args.push("--public");
  }
  if (serverPort) {
    args.push("--port", serverPort);
  }
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

const webArgs = ["--filter", "@tmux-agent-monitor/web", isPublic ? "dev:public" : "dev"];
const webProcess = spawnPnpm(webArgs);

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
