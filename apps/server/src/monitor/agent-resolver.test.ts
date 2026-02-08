import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => {
  return {
    execa: vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    })),
  };
});

const getExeca = async () => {
  const mod = await import("execa");
  return mod.execa as unknown as ReturnType<typeof vi.fn>;
};

const loadModule = async () => {
  await vi.resetModules();
  const execa = await getExeca();
  execa.mockReset();
  execa.mockResolvedValue({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  return import("./agent-resolver");
};

const buildPane = (
  overrides: Partial<{
    currentCommand: string | null;
    paneStartCommand: string | null;
    paneTitle: string | null;
    panePid: number | null;
    paneTty: string | null;
  }>,
) => ({
  currentCommand: null,
  paneStartCommand: null,
  paneTitle: null,
  panePid: 100,
  paneTty: "tty1",
  ...overrides,
});

describe("resolvePaneAgent", () => {
  it("ignores editor panes with agent arg", async () => {
    const { resolvePaneAgent } = await loadModule();
    const result = await resolvePaneAgent(
      buildPane({ currentCommand: "vim", paneStartCommand: "vim -c codex" }),
    );
    expect(result).toEqual({ agent: "unknown", ignore: true });
    const execa = await getExeca();
    expect(execa).not.toHaveBeenCalled();
  });

  it("detects agent from hints", async () => {
    const { resolvePaneAgent } = await loadModule();
    const result = await resolvePaneAgent(buildPane({ currentCommand: "codex" }));
    expect(result).toEqual({ agent: "codex", ignore: false });
  });

  it("falls back to process command", async () => {
    const { resolvePaneAgent } = await loadModule();
    const execa = await getExeca();
    execa.mockImplementation(async (_file: string, args?: readonly string[] | null) => {
      const actualArgs = Array.isArray(args) ? args : [];
      if (actualArgs[0] === "-p") {
        return { stdout: "claude", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected args: ${actualArgs.join(" ")}`);
    });
    const result = await resolvePaneAgent(buildPane({ currentCommand: "bash" }));
    expect(result).toEqual({ agent: "claude", ignore: false });
  });

  it("falls back to pid tree lookup", async () => {
    const { resolvePaneAgent } = await loadModule();
    const execa = await getExeca();
    execa.mockImplementation(async (_file: string, args?: readonly string[] | null) => {
      const actualArgs = Array.isArray(args) ? args : [];
      if (actualArgs[0] === "-p") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (actualArgs[0] === "-ax") {
        return { stdout: "100 1 bash\n200 100 codex\n", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected args: ${actualArgs.join(" ")}`);
    });
    const result = await resolvePaneAgent(buildPane({ currentCommand: "bash" }));
    expect(result).toEqual({ agent: "codex", ignore: false });
  });

  it("falls back to tty lookup", async () => {
    const { resolvePaneAgent } = await loadModule();
    const execa = await getExeca();
    execa.mockImplementation(async (_file: string, args?: readonly string[] | null) => {
      const actualArgs = Array.isArray(args) ? args : [];
      if (actualArgs[0] === "-p") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (actualArgs[0] === "-ax") {
        return { stdout: "100 1 bash\n", stderr: "", exitCode: 0 };
      }
      if (actualArgs.includes("-t")) {
        return { stdout: "claude", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected args: ${actualArgs.join(" ")}`);
    });
    const result = await resolvePaneAgent(
      buildPane({ currentCommand: "bash", paneTty: "/dev/tty1" }),
    );
    expect(result).toEqual({ agent: "claude", ignore: false });
  });

  it("does not infer agent from pane title only", async () => {
    const { resolvePaneAgent } = await loadModule();
    const result = await resolvePaneAgent(
      buildPane({
        currentCommand: null,
        paneStartCommand: null,
        paneTitle: "✳ Claude Code",
      }),
    );
    expect(result).toEqual({ agent: "unknown", ignore: false });
  });

  it("does not ignore editor pane from title hint only", async () => {
    const { resolvePaneAgent } = await loadModule();
    const result = await resolvePaneAgent(
      buildPane({
        currentCommand: "vim",
        paneStartCommand: "vim",
        paneTitle: "✳ Claude Code",
      }),
    );
    expect(result).toEqual({ agent: "unknown", ignore: false });
  });
});
