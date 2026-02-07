import { defaultConfig } from "@vde-monitor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  randomBytes: vi.fn((size: number) => Buffer.alloc(size, 0xab)),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("@vde-monitor/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vde-monitor/shared")>();
  return {
    ...actual,
    resolveConfigDir: () => "/mock/config",
  };
});

vi.mock("node:crypto", () => ({
  default: { randomBytes: mocks.randomBytes },
  randomBytes: mocks.randomBytes,
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
    mkdirSync: mocks.mkdirSync,
    chmodSync: mocks.chmodSync,
  },
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
  chmodSync: mocks.chmodSync,
}));

vi.mock("node:os", () => ({
  default: { homedir: mocks.homedir },
  homedir: mocks.homedir,
}));

import { ensureConfig, rotateToken } from "./config.js";

const configPath = "/mock/config/config.json";
const tokenPath = "/mock/home/.vde-monitor/token.json";

const fileContents = new Map<string, string>();
const writtenContents = new Map<string, string>();

const setConfigFile = (config: unknown) => {
  fileContents.set(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

const setTokenFile = (token: string) => {
  fileContents.set(tokenPath, `${JSON.stringify({ token }, null, 2)}\n`);
};

beforeEach(() => {
  vi.clearAllMocks();
  fileContents.clear();
  writtenContents.clear();

  mocks.readFileSync.mockImplementation((targetPath: unknown) => {
    if (typeof targetPath !== "string") {
      throw new Error("unexpected path type");
    }
    const raw = fileContents.get(targetPath);
    if (raw == null) {
      throw new Error(`ENOENT: ${targetPath}`);
    }
    return raw;
  });

  mocks.writeFileSync.mockImplementation((targetPath: unknown, data: unknown) => {
    if (typeof targetPath !== "string" || typeof data !== "string") {
      throw new Error("unexpected write args");
    }
    writtenContents.set(targetPath, data);
    fileContents.set(targetPath, data);
  });

  mocks.mkdirSync.mockImplementation(() => undefined);
  mocks.chmodSync.mockImplementation(() => undefined);
});

describe("ensureConfig", () => {
  it("creates config and token when no files exist", () => {
    const result = ensureConfig({ bind: "0.0.0.0" });

    expect(result.bind).toBe("0.0.0.0");
    expect(result.port).toBe(defaultConfig.port);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    expect(JSON.parse(writtenContents.get(configPath) ?? "{}")).toEqual({
      ...defaultConfig,
      bind: "0.0.0.0",
    });
    expect(JSON.parse(writtenContents.get(tokenPath) ?? "{}")).toEqual({ token: result.token });
  });

  it("keeps existing legacy-looking values without auto migration", () => {
    setConfigFile({
      ...defaultConfig,
      port: 10080,
      screen: {
        ...defaultConfig.screen,
        image: {
          ...defaultConfig.screen.image,
          enabled: false,
        },
      },
    });
    setTokenFile("existing-token");

    const result = ensureConfig();

    expect(result.port).toBe(10080);
    expect(result.screen.image.enabled).toBe(false);
    expect(result.token).toBe("existing-token");
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("does not rewrite existing config and only persists missing token", () => {
    setConfigFile(defaultConfig);

    const result = ensureConfig({ bind: "0.0.0.0" });

    expect(result.bind).toBe("0.0.0.0");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    const writtenPaths = mocks.writeFileSync.mock.calls.map((args) => args[0]);
    expect(writtenPaths).toEqual([tokenPath]);
  });
});

describe("rotateToken", () => {
  it("rotates token and persists only the new token", () => {
    setConfigFile(defaultConfig);
    setTokenFile("old-token");

    const result = rotateToken();

    expect(result.token).not.toBe("old-token");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(writtenContents.get(tokenPath) ?? "{}")).toEqual({ token: result.token });
    const writtenPaths = mocks.writeFileSync.mock.calls.map((args) => args[0]);
    expect(writtenPaths).toEqual([tokenPath]);
    expect(mocks.randomBytes).toHaveBeenCalled();
  });
});
