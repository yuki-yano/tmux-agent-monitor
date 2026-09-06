import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || "http://localhost:11080";
const configuredDevPort = Number.parseInt(process.env.VITE_DEV_PORT ?? "", 10);
const devPort =
  Number.isSafeInteger(configuredDevPort) && configuredDevPort > 0 ? configuredDevPort : 24180;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
