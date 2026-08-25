import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  createReactCompilerBuildArtifactPlugin,
  createReactCompilerCollector,
} from "./react-compiler";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || "http://localhost:11080";
const configuredDevPort = Number.parseInt(process.env.VITE_DEV_PORT ?? "", 10);
const devPort =
  Number.isSafeInteger(configuredDevPort) && configuredDevPort > 0 ? configuredDevPort : 24180;
const compilerCollector = createReactCompilerCollector("production");

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset(compilerCollector.options)] }),
    createReactCompilerBuildArtifactPlugin(compilerCollector),
    tailwindcss(),
  ],
  server: {
    port: devPort,
    strictPort: process.env.VITE_DEV_PORT != null,
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/file-preview": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
