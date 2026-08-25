import { describe, expect, it } from "vitest";

import {
  REACT_COMPILER_PILOT_MANIFEST_COUNT,
  assertReactCompilerPilotArtifact,
  reactCompilerPilotManifest,
} from "./react-compiler";

const validArtifact = () => ({
  manifest: [...reactCompilerPilotManifest],
  successes: reactCompilerPilotManifest.map(({ file, symbol }) => ({ file, symbol })),
  failures: [],
});

describe("React Compiler pilot artifact", () => {
  it("accepts exactly one keyed success for each manifest entry", () => {
    expect(reactCompilerPilotManifest).toHaveLength(REACT_COMPILER_PILOT_MANIFEST_COUNT);
    expect(reactCompilerPilotManifest.filter(({ family }) => family === "commit")).toHaveLength(10);
    expect(reactCompilerPilotManifest.filter(({ family }) => family === "screen")).toHaveLength(3);
    expect(reactCompilerPilotManifest.filter(({ family }) => family === "composer")).toHaveLength(
      2,
    );
    expect(() => assertReactCompilerPilotArtifact(validArtifact())).not.toThrow();
  });

  it("rejects an unkeyed or unexpected success", () => {
    expect(() =>
      assertReactCompilerPilotArtifact({
        ...validArtifact(),
        successes: [...validArtifact().successes, { file: null, symbol: null }],
      }),
    ).toThrow(/"unkeyed":1/u);
    expect(() =>
      assertReactCompilerPilotArtifact({
        ...validArtifact(),
        successes: [
          ...validArtifact().successes,
          { file: "apps/web/src/Unexpected.tsx", symbol: "Unexpected" },
        ],
      }),
    ).toThrow(/Unexpected/u);
  });

  it("rejects duplicate manifest entries and duplicate successes", () => {
    const duplicate = reactCompilerPilotManifest[0]!;
    expect(() =>
      assertReactCompilerPilotArtifact({
        ...validArtifact(),
        manifest: [...reactCompilerPilotManifest.slice(0, -1), duplicate],
      }),
    ).toThrow(/duplicateManifest/u);
    expect(() =>
      assertReactCompilerPilotArtifact({
        ...validArtifact(),
        successes: [...validArtifact().successes, duplicate],
      }),
    ).toThrow(/duplicateSuccesses/u);
  });
});
