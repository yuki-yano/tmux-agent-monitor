import path from "node:path";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

import { createReactCompilerCollector } from "./react-compiler";
import { createReactCompilerVitestPlugin } from "./react-compiler-vitest";

const collector = createReactCompilerCollector("vitest", "infer");
const runFullSuite = process.env.VDE_REACT_COMPILER_FULL_SUITE === "1";

const criticalTestInclude = [
  "test/compiler-contract/react-compiler-infer-transform.test.tsx",
  "src/features/shared-session-ui/components/PaneTextComposer.test.tsx",
  "src/pages/SessionDetail/components/CommitSection.test.tsx",
  "src/pages/SessionDetail/components/ScreenPanel.test.tsx",
  "src/pages/SessionDetail/components/ScreenPanelViewport.test.tsx",
  "src/pages/SessionDetail/components/SmartScreenViewport.test.tsx",
  "src/pages/SessionDetail/hooks/useScreenFetch.test.tsx",
];

export default defineConfig({
  plugins: [react(), createReactCompilerVitestPlugin(collector)],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "happy-dom",
    ...(runFullSuite
      ? {
          exclude: [
            ...configDefaults.exclude,
            "test/compiler-contract/react-compiler-transform.test.tsx",
          ],
        }
      : { include: criticalTestInclude }),
    setupFiles: ["../../vitest.setup.ts"],
  },
});
