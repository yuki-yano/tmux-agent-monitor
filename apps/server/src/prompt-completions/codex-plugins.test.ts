import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { listCodexPlugins } from "./codex-plugins";

const fakeAppServer = String.raw`
const readline = require("node:readline");
const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\n");
  }
  if (message.method === "plugin/installed") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        marketplaces: [{
          name: "openai-bundled",
          plugins: [
            {
              id: "chrome@openai-bundled",
              name: "chrome",
              installed: true,
              enabled: true,
              interface: {
                displayName: "Chrome",
                shortDescription: "Control Chrome with ChatGPT"
              }
            },
            {
              id: "browser@openai-bundled",
              name: "browser",
              installed: true,
              enabled: false,
              interface: { displayName: "Browser" }
            },
            {
              id: "linear@openai-bundled",
              name: "linear",
              installed: false,
              enabled: true,
              interface: { displayName: "Linear" }
            }
          ]
        }, {
          name: "project",
          plugins: [{
            id: "local-tools@project",
            name: "local-tools",
            installed: true,
            enabled: true,
            interface: null
          }]
        }],
        marketplaceLoadErrors: []
      }
    }) + "\n");
  }
});
`;

describe("listCodexPlugins", () => {
  it("loads enabled installed plugins from the Codex App Server", async () => {
    const spawnAppServer = vi.fn(() =>
      spawn(process.execPath, ["-e", fakeAppServer], { stdio: ["pipe", "pipe", "pipe"] }),
    );

    const items = await listCodexPlugins({ cwd: "/repo", port: { spawnAppServer } });

    expect(spawnAppServer).toHaveBeenCalledWith("/repo");
    expect(items).toEqual([
      {
        id: "codex-plugin:chrome@openai-bundled",
        label: "@Chrome",
        insertText: "@Chrome",
        description: "Control Chrome with ChatGPT",
        argumentHint: "",
        kind: "plugin",
        scope: "openai-bundled",
      },
      {
        id: "codex-plugin:local-tools@project",
        label: "@local-tools",
        insertText: "@local-tools",
        description: "",
        argumentHint: "",
        kind: "plugin",
        scope: "project",
      },
    ]);
  });
});
