declare module "virtual:react-compiler-artifact" {
  type CompilerSuccess = {
    file: string | null;
    symbol: string | null;
    memoSlots: number;
    memoBlocks: number;
    memoValues: number;
  };

  type CompilerArtifact = {
    schemaVersion: number;
    run: {
      kind: string;
      measurementCommit: string;
      node: string;
      workingTreeClean: boolean;
    };
    compiler: {
      compilationMode: string;
      optionsHash: string;
      panicThreshold: string;
      sources: readonly string[];
      target: string;
    };
    requiredCompileSuccesses: Array<{
      file: string;
      symbol: string;
    }>;
    successes: CompilerSuccess[];
    failures: Array<{ file: string | null; kind: string }>;
  };

  const artifact: CompilerArtifact;
  export default artifact;
}
