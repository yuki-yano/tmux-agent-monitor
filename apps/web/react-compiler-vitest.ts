import { transformAsync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import type { Plugin } from "vite";

import {
  type ReactCompilerCollector,
  isReactCompilerSource,
  isReactCompilerTestModule,
} from "./react-compiler";

const virtualArtifactId = "virtual:react-compiler-artifact";
const resolvedVirtualArtifactId = `\0${virtualArtifactId}`;

export const shouldTransformReactCompilerVitestModule = (id: string): boolean => {
  const sourceId = id.split("?", 1)[0]!;
  if (!isReactCompilerSource(sourceId)) return false;

  const normalizedSourceId = sourceId.replaceAll("\\", "/");
  return !isReactCompilerTestModule(normalizedSourceId);
};

export const createReactCompilerVitestPlugin = (collector: ReactCompilerCollector): Plugin => ({
  name: "react-compiler-vitest-adapter",
  enforce: "pre",
  resolveId(id) {
    return id === virtualArtifactId ? resolvedVirtualArtifactId : null;
  },
  load(id) {
    if (id !== resolvedVirtualArtifactId) return null;
    return `export default ${JSON.stringify(collector.getArtifact())};`;
  },
  async transform(code, id) {
    if (!shouldTransformReactCompilerVitestModule(id)) return null;

    const sourceId = id.split("?", 1)[0]!;

    const result = await transformAsync(code, {
      babelrc: false,
      configFile: false,
      filename: sourceId,
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [[reactCompiler, collector.options]],
      sourceMaps: true,
    });

    if (result?.code == null) return null;
    return { code: result.code, map: result.map };
  },
});
