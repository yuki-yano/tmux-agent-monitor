import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { execa } from "execa";

import { buildWeztermTargetArgs } from "./target.js";

export type WeztermRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type WeztermAdapter = {
  run: (args: string[]) => Promise<WeztermRunResult>;
  spawnProxy?: () => ChildProcessWithoutNullStreams;
};

type AdapterOptions = {
  cliPath?: string;
  target?: string | null;
};

export const createWeztermAdapter = ({
  cliPath = "wezterm",
  target = "auto",
}: AdapterOptions = {}): WeztermAdapter => {
  const targetArgs = buildWeztermTargetArgs(target);

  const run = async (args: string[]): Promise<WeztermRunResult> => {
    const result = await execa(cliPath, ["cli", ...targetArgs, ...args], { reject: false });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  };
  const spawnProxy = () => spawn(cliPath, ["cli", ...targetArgs, "proxy"], { stdio: "pipe" });
  return { run, spawnProxy };
};
