import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentMonitorConfig } from "@tmux-agent-monitor/shared";
import { configSchema, defaultConfig } from "@tmux-agent-monitor/shared";

const configDirName = ".tmux-agent-monitor";

export const getConfigDir = () => {
  return path.join(os.homedir(), configDirName);
};

export const getConfigPath = () => {
  return path.join(getConfigDir(), "config.json");
};

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
};

const writeFileSafe = (filePath: string, data: string) => {
  fs.writeFileSync(filePath, data, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore
  }
};

const generateToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

export const loadConfig = (): AgentMonitorConfig | null => {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = configSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
};

export const saveConfig = (config: AgentMonitorConfig) => {
  const dir = getConfigDir();
  ensureDir(dir);
  writeFileSafe(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
};

export const ensureConfig = (overrides?: Partial<AgentMonitorConfig>) => {
  const existing = loadConfig();
  if (existing) {
    let next = existing;
    let migrated = false;
    if (existing.port === 10080 && defaultConfig.port === 11080) {
      next = { ...existing, port: defaultConfig.port };
      migrated = true;
    }
    if (existing.screen?.image?.enabled === false && defaultConfig.screen.image.enabled === true) {
      next = {
        ...next,
        screen: {
          ...next.screen,
          image: {
            ...next.screen.image,
            enabled: true,
          },
        },
      };
      migrated = true;
    }
    if (migrated) {
      saveConfig(next);
    }
    return { ...next, ...overrides };
  }
  const token = generateToken();
  const config = { ...defaultConfig, ...overrides, token };
  saveConfig(config);
  return config;
};

export const rotateToken = () => {
  const config = ensureConfig();
  const token = generateToken();
  const next = { ...config, token };
  saveConfig(next);
  return next;
};

export const applyRuntimeOverrides = (
  config: AgentMonitorConfig,
  overrides: Partial<AgentMonitorConfig>,
) => {
  return { ...config, ...overrides };
};
