import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { createReactCompilerCollector } from "./react-compiler";
import { createReactCompilerVitestPlugin } from "./react-compiler-vitest";

const collector = createReactCompilerCollector("vitest", "infer");

export default defineConfig({
  plugins: [react(), createReactCompilerVitestPlugin(collector)],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: [
      "test/compiler-contract/react-compiler-infer-transform.test.tsx",
      "src/features/shared-session-ui/components/PaneTextComposer.test.tsx",
      "src/pages/SessionDetail/components/CommitSection.test.tsx",
      "src/pages/SessionDetail/components/ScreenPanel.test.tsx",
      "src/pages/SessionDetail/components/ScreenPanelViewport.test.tsx",
      "src/pages/SessionDetail/components/SmartScreenViewport.test.tsx",
      "src/pages/SessionDetail/hooks/useScreenFetch.test.tsx",
    ],
    setupFiles: ["../../vitest.setup.ts"],
  },
});
