import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "apps/server/src/index.ts",
    "tmux-agent-monitor-hook": "packages/hooks/src/cli.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  shims: false,
});
