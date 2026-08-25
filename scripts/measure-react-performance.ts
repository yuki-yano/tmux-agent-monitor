import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webDistRoot = path.join(repoRoot, "apps/web/dist");
const hmrTargets = [
  {
    name: "annotated",
    path: "/src/pages/SessionDetail/components/CommitSection.tsx",
  },
  {
    name: "unannotated",
    path: "/src/pages/SessionDetail/SessionDetailView.tsx",
  },
] as const;
const requireFromWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
const viteEntrypoint = path.join(
  path.dirname(requireFromWeb.resolve("vite/package.json")),
  "bin/vite.js",
);
type StopSignal = "SIGKILL" | "SIGTERM";

let stopActiveProcess: ((signal: StopSignal) => void) | null = null;
let restoreTargetMtimes: (() => void) | null = null;

const handleTermination = (exitCode: number): void => {
  restoreTargetMtimes?.();
  stopActiveProcess?.("SIGTERM");
  process.exit(exitCode);
};

process.once("SIGINT", () => handleTermination(130));
process.once("SIGTERM", () => handleTermination(143));
const runFlagIndex = process.argv.indexOf("--runs");
const runCount = Number.parseInt(
  runFlagIndex === -1 ? "5" : (process.argv[runFlagIndex + 1] ?? ""),
  10,
);

if (!Number.isSafeInteger(runCount) || runCount < 3 || runCount % 2 === 0) {
  throw new Error("--runs must be an odd integer greater than or equal to 3");
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const median = (samples: number[]): number =>
  [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)]!;

const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(file) : [file];
  });

const runCommand = async (command: string, args: string[]): Promise<void> => {
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stopProcessGroup = (signal: StopSignal): void => {
    if (child.pid != null && child.exitCode == null && child.signalCode == null) {
      process.kill(-child.pid, signal);
    }
  };
  stopActiveProcess = stopProcessGroup;
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (stopActiveProcess === stopProcessGroup) stopActiveProcess = null;
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${exitCode})\n${output}`);
  }
};

const measureBuild = async () => {
  const samplesMs: number[] = [];
  const gzipBytes: number[] = [];
  let jsFileCount = 0;
  for (let index = 0; index < runCount; index += 1) {
    process.stderr.write(`build ${index + 1}/${runCount}\n`);
    const startedAt = performance.now();
    await runCommand("pnpm", ["build"]);
    samplesMs.push(Math.round(performance.now() - startedAt));
    const jsFiles = collectFiles(webDistRoot).filter((file) => file.endsWith(".js"));
    jsFileCount = jsFiles.length;
    gzipBytes.push(
      jsFiles.reduce(
        (total, file) => total + gzipSync(readFileSync(file), { level: 6 }).byteLength,
        0,
      ),
    );
  }
  return {
    command: "pnpm build",
    samplesMs,
    medianMs: median(samplesMs),
    productionJs: {
      root: "apps/web/dist",
      fileCount: jsFileCount,
      gzipLevel: 6,
      gzipImplementation: "node:zlib gzipSync",
      samplesBytes: gzipBytes,
      medianBytes: median(gzipBytes),
    },
  };
};

const getAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a Vite port"));
        return;
      }
      server.close((error) => {
        if (error == null) resolve(address.port);
        else reject(error);
      });
    });
  });

const waitForHttp = async (url: string, getLogs: () => string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await sleep(20);
  }
  throw new Error(`Vite did not become ready\n${getLogs()}`);
};

const waitForHmrMessage = async (
  socket: WebSocket,
  predicate: (payload: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for a Vite HMR message"));
    }, 5_000);
    const onMessage = (event: MessageEvent) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(payload);
    };
    socket.addEventListener("message", onMessage);
  });

const measureVite = async () => {
  const coldStartSamplesMs: number[] = [];
  const hmrSamplesMs = Object.fromEntries(
    hmrTargets.map(({ name }) => [name, [] as number[]]),
  ) as Record<(typeof hmrTargets)[number]["name"], number[]>;
  const targetsWithFiles = hmrTargets.map((target) => ({
    ...target,
    file: path.join(repoRoot, "apps/web", target.path),
  }));
  const originalStats = new Map(
    targetsWithFiles.map(({ file }) => [file, statSync(file)] as const),
  );
  restoreTargetMtimes = () => {
    for (const [file, originalStat] of originalStats) {
      utimesSync(file, originalStat.atime, originalStat.mtime);
    }
  };

  for (let index = 0; index < runCount; index += 1) {
    process.stderr.write(`vite ${index + 1}/${runCount}\n`);
    const port = await getAvailablePort();
    const startedAt = performance.now();
    const child = spawn(
      process.execPath,
      [viteEntrypoint, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      {
        cwd: path.join(repoRoot, "apps/web"),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stopProcessGroup = (signal: StopSignal): void => {
      if (child.pid != null && child.exitCode == null && child.signalCode == null) {
        process.kill(-child.pid, signal);
      }
    };
    stopActiveProcess = stopProcessGroup;
    let logs = "";
    child.stdout?.on("data", (chunk) => {
      logs += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      logs += chunk.toString();
    });
    let socket: WebSocket | null = null;
    try {
      const origin = `http://127.0.0.1:${port}`;
      await waitForHttp(`${origin}/`, () => logs);
      coldStartSamplesMs.push(Math.round(performance.now() - startedAt));
      await Promise.all(
        targetsWithFiles.map(({ path: targetPath }) => fetch(`${origin}${targetPath}`)),
      );
      const clientSource = await (await fetch(`${origin}/@vite/client`)).text();
      const token = clientSource.match(/const wsToken = "([^"]+)"/u)?.[1];
      if (token == null) throw new Error("Could not read the Vite websocket token");
      socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, "vite-hmr");
      await new Promise<void>((resolve, reject) => {
        socket?.addEventListener("open", () => resolve(), { once: true });
        socket?.addEventListener("error", () => reject(new Error("Vite websocket failed")), {
          once: true,
        });
      });
      await waitForHmrMessage(socket, (payload) => payload.type === "connected");
      for (const target of targetsWithFiles) {
        const originalStat = originalStats.get(target.file)!;
        const hmrStartedAt = performance.now();
        utimesSync(target.file, originalStat.atime, new Date());
        await waitForHmrMessage(socket, (message) => {
          if (message.type !== "update" || !Array.isArray(message.updates)) return false;
          return message.updates.some(
            (update) =>
              typeof update === "object" &&
              update != null &&
              (Reflect.get(update, "path") === target.path ||
                Reflect.get(update, "acceptedPath") === target.path),
          );
        });
        hmrSamplesMs[target.name].push(Math.round(performance.now() - hmrStartedAt));
      }
    } finally {
      socket?.close();
      restoreTargetMtimes();
      if (child.exitCode == null && child.signalCode == null) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        stopProcessGroup("SIGTERM");
        await Promise.race([exited, sleep(2_000)]);
        stopProcessGroup("SIGKILL");
        await exited;
      }
      if (stopActiveProcess === stopProcessGroup) stopActiveProcess = null;
    }
  }

  restoreTargetMtimes = null;

  return {
    command:
      "pnpm --filter @vde-monitor/web exec vite --host 127.0.0.1 --port <ephemeral> --strictPort",
    coldStart: {
      definition: "spawn to first HTTP 200 response",
      samplesMs: coldStartSamplesMs,
      medianMs: median(coldStartSamplesMs),
    },
    hmr: Object.fromEntries(
      hmrTargets.map((target) => [
        target.name,
        {
          target: target.path,
          definition: "mtime update to Vite websocket update message",
          samplesMs: hmrSamplesMs[target.name],
          medianMs: median(hmrSamplesMs[target.name]),
          messageType: "update",
        },
      ]),
    ),
  };
};

const build = await measureBuild();
const vite = await measureVite();
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  packageManager: string;
};
const webPackage = JSON.parse(
  readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"),
) as {
  devDependencies: Record<string, string>;
};
const normalizeVersion = (version: string): string => version.replace(/^[~^]/u, "");
const measurementCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

console.log(
  JSON.stringify(
    {
      schemaVersion: 3,
      measurementCommit,
      measuredAt: new Date().toISOString().slice(0, 10),
      environment: {
        node: process.version,
        pnpm: rootPackage.packageManager.replace(/^pnpm@/u, ""),
        platform: `${process.platform}-${process.arch}`,
        vite: normalizeVersion(webPackage.devDependencies.vite!),
        reactTransform: [
          `@vitejs/plugin-react ${normalizeVersion(webPackage.devDependencies["@vitejs/plugin-react"]!)}`,
          `@rolldown/plugin-babel ${normalizeVersion(webPackage.devDependencies["@rolldown/plugin-babel"]!)}`,
          `babel-plugin-react-compiler ${normalizeVersion(
            webPackage.devDependencies["babel-plugin-react-compiler"]!,
          )}`,
        ].join(" / "),
      },
      reproduce: `pnpm --silent run react:performance -- --runs ${runCount}`,
      build,
      vite,
    },
    null,
    2,
  ),
);
