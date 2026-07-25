import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { PromptCompletionItem } from "@vde-monitor/shared";

type JsonRpcId = string | number;

type JsonRpcResponse = {
  id?: JsonRpcId;
  result?: unknown;
  error?: { message?: string };
};

type CodexPlugin = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  marketplace: string;
};

export type CodexPluginsPort = {
  spawnAppServer: (cwd: string) => ChildProcessWithoutNullStreams;
};

const defaultPort: CodexPluginsPort = {
  spawnAppServer: (cwd) =>
    spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value != null;

const parsePlugins = (value: unknown): CodexPlugin[] => {
  if (!isRecord(value) || !Array.isArray(value.marketplaces)) {
    return [];
  }
  return value.marketplaces.flatMap((marketplace) => {
    if (
      !isRecord(marketplace) ||
      typeof marketplace.name !== "string" ||
      !Array.isArray(marketplace.plugins)
    ) {
      return [];
    }
    const marketplaceName = marketplace.name;
    return marketplace.plugins.flatMap((plugin) => {
      if (
        !isRecord(plugin) ||
        typeof plugin.id !== "string" ||
        typeof plugin.name !== "string" ||
        plugin.installed !== true ||
        plugin.enabled !== true
      ) {
        return [];
      }
      const pluginInterface = isRecord(plugin.interface) ? plugin.interface : {};
      const displayName =
        typeof pluginInterface.displayName === "string" && pluginInterface.displayName.trim()
          ? pluginInterface.displayName
          : plugin.name;
      const description =
        typeof pluginInterface.shortDescription === "string"
          ? pluginInterface.shortDescription
          : "";
      return [
        {
          id: plugin.id,
          name: plugin.name,
          displayName,
          description,
          marketplace: marketplaceName,
        },
      ];
    });
  });
};

const buildItems = (plugins: CodexPlugin[]): PromptCompletionItem[] =>
  plugins.map((plugin) => ({
    id: `codex-plugin:${plugin.id}`,
    label: `@${plugin.displayName}`,
    insertText: `@${plugin.displayName}`,
    description: plugin.description,
    argumentHint: "",
    kind: "plugin",
    scope: plugin.marketplace,
  }));

export const listCodexPlugins = async ({
  cwd,
  timeoutMs = 10_000,
  port = defaultPort,
}: {
  cwd: string;
  timeoutMs?: number;
  port?: CodexPluginsPort;
}): Promise<PromptCompletionItem[]> =>
  new Promise((resolve, reject) => {
    const child = port.spawnAppServer(cwd);
    const reader = createInterface({ input: child.stdout });
    const initId = `init-${Date.now()}`;
    const pluginsId = `plugins-${Date.now()}`;
    let settled = false;
    let stderr = "";

    child.stdin.on("error", () => {});

    const cleanup = () => {
      reader.close();
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.stdin.removeAllListeners();
      if (!child.stdin.destroyed) {
        child.stdin.end();
      }
      child.kill();
    };

    const finish = (items: PromptCompletionItem[]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      cleanup();
      resolve(items);
    };

    const fail = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(new Error(message));
    };

    const write = (message: Record<string, unknown>) => {
      if (!settled && !child.stdin.destroyed && child.stdin.writable) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
    };

    const timeout = setTimeout(() => fail("Timed out while loading Codex plugins."), timeoutMs);

    child.on("error", () => fail("Failed to start the Codex App Server."));
    child.on("exit", (code) => {
      if (!settled) {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        fail(`Codex App Server exited unexpectedly (code=${code ?? "unknown"})${suffix}`);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    reader.on("line", (line) => {
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      if (message.id === initId) {
        if (message.error) {
          fail(message.error.message || "Failed to initialize the Codex App Server.");
          return;
        }
        write({ jsonrpc: "2.0", method: "initialized" });
        write({
          jsonrpc: "2.0",
          id: pluginsId,
          method: "plugin/installed",
          params: { cwds: [cwd] },
        });
        return;
      }
      if (message.id === pluginsId) {
        if (message.error) {
          fail(message.error.message || "Failed to load Codex plugins.");
          return;
        }
        finish(buildItems(parsePlugins(message.result)));
      }
    });

    write({
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        clientInfo: { name: "vde-monitor", version: "0.0.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
