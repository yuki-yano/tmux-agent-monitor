import { createInterface } from "node:readline/promises";

import { isObject } from "@vde-monitor/shared";
import { execaSync } from "execa";

export const buildTailscaleHttpsAccessUrl = ({
  dnsName,
  token,
}: {
  dnsName: string;
  token: string;
}) => {
  const hashParams = new URLSearchParams({ token });
  return `https://${dnsName}/#${hashParams.toString()}`;
};

export const buildTailscaleServeProxyTarget = ({
  proxyHost,
  displayPort,
}: {
  proxyHost: string;
  displayPort: number;
}) => `http://${proxyHost === "0.0.0.0" ? "127.0.0.1" : proxyHost}:${displayPort}`;

export const buildTailscaleServeCommand = (proxyTarget: string) =>
  `tailscale serve --bg ${proxyTarget}`;

const TAILSCALE_COMMAND_CANDIDATES = [
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
] as const;

type TailscaleCommandResult = {
  bin: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

const runTailscaleCommand = (
  bin: string,
  args: string[],
  timeout = 3000,
): TailscaleCommandResult | null => {
  try {
    const result = execaSync(bin, args, {
      encoding: "utf8",
      reject: false,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });
    return {
      bin,
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
};

export const resolveTailscaleBinary = () => {
  for (const bin of TAILSCALE_COMMAND_CANDIDATES) {
    const result = runTailscaleCommand(bin, ["version"]);
    if (!result) {
      continue;
    }
    if (result.exitCode === 0) {
      return bin;
    }
  }
  return null;
};

const normalizeDnsName = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/\.$/u, "");
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
};

const resolveDnsNameFromStatus = (value: unknown) => {
  if (!isObject(value)) {
    return null;
  }
  const self = value.Self;
  if (!isObject(self)) {
    return null;
  }
  return normalizeDnsName(self.DNSName);
};

const parseJson = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const normalizeServeProxyTarget = (value: string) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

export const collectServeProxyTargets = (value: unknown): string[] => {
  const targets = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const normalized = normalizeServeProxyTarget(node.trim());
      if (normalized) {
        targets.add(normalized);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (isObject(node)) {
      for (const child of Object.values(node)) {
        visit(child);
      }
    }
  };

  visit(value);
  return [...targets];
};

export const matchesExpectedTailscaleServeTarget = ({
  serveStatus,
  expectedProxyTarget,
}: {
  serveStatus: unknown;
  expectedProxyTarget: string;
}) => {
  const expected = normalizeServeProxyTarget(expectedProxyTarget);
  if (!expected) {
    return false;
  }
  return collectServeProxyTargets(serveStatus).includes(expected);
};

const hasExistingServeConfig = (value: unknown) => {
  if (!isObject(value)) {
    return false;
  }
  const tcp = value.TCP;
  if (isObject(tcp) && Object.keys(tcp).length > 0) {
    return true;
  }
  const web = value.Web;
  if (isObject(web) && Object.keys(web).length > 0) {
    return true;
  }
  const services = value.Services;
  if (Array.isArray(services) && services.length > 0) {
    return true;
  }
  return false;
};

const askRunTailscaleServe = async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[vde-monitor] Non-interactive terminal detected. Skip automatic tailscale serve.");
    return false;
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await prompt.question("Run tailscale serve now? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
};

export const runTailscaleHttpsPreflight = async (expectedProxyTarget: string) => {
  const tailscaleBin = resolveTailscaleBinary();
  if (!tailscaleBin) {
    console.log("[vde-monitor] tailscale command not found. Install Tailscale and log in first.");
    return { dnsName: null as string | null };
  }

  const statusResult = runTailscaleCommand(tailscaleBin, ["status", "--json"]);
  if (!statusResult || statusResult.exitCode !== 0) {
    console.log(
      "[vde-monitor] tailscale status --json failed. Ensure Tailscale is running and logged in.",
    );
    return { dnsName: null as string | null };
  }
  const parsedStatus = parseJson(statusResult.stdout);
  const dnsName = resolveDnsNameFromStatus(parsedStatus);
  if (!dnsName) {
    console.log(
      "[vde-monitor] Could not resolve Tailscale DNSName. Log in with `tailscale up` and enable MagicDNS.",
    );
    return { dnsName: null as string | null };
  }

  const manualCommand = buildTailscaleServeCommand(expectedProxyTarget);
  const serveStatus = runTailscaleCommand(tailscaleBin, ["serve", "status", "--json"]);
  if (!serveStatus || serveStatus.exitCode !== 0) {
    console.log("[vde-monitor] Could not read existing tailscale serve settings.");
    console.log(`[vde-monitor] Run manually: ${manualCommand}`);
    return { dnsName };
  }
  const parsedServeStatus = parseJson(serveStatus.stdout);
  if (!parsedServeStatus) {
    console.log("[vde-monitor] Failed to parse tailscale serve status output.");
    console.log(`[vde-monitor] Run manually: ${manualCommand}`);
    return { dnsName };
  }
  if (hasExistingServeConfig(parsedServeStatus)) {
    if (
      matchesExpectedTailscaleServeTarget({
        serveStatus: parsedServeStatus,
        expectedProxyTarget,
      })
    ) {
      console.log(
        "[vde-monitor] Existing tailscale serve settings detected and match expected upstream.",
      );
      console.log("[vde-monitor] Skipping auto configuration.");
      return { dnsName };
    }
    const existingTargets = collectServeProxyTargets(parsedServeStatus);
    console.log(
      "[vde-monitor] Existing tailscale serve settings detected, but upstream does not match this run.",
    );
    if (existingTargets.length > 0) {
      console.log(`[vde-monitor] Current upstream(s): ${existingTargets.join(", ")}`);
    } else {
      console.log("[vde-monitor] Current upstream(s): (not detected from serve status)");
    }
    console.log(`[vde-monitor] Expected upstream: ${expectedProxyTarget}`);
    console.log("[vde-monitor] Automatic overwrite is disabled for safety.");
    console.log(`[vde-monitor] Keep existing settings or update manually: ${manualCommand}`);
    return { dnsName };
  }

  const confirmed = await askRunTailscaleServe();
  if (!confirmed) {
    console.log("[vde-monitor] tailscale serve auto-setup skipped.");
    console.log(`[vde-monitor] Run manually if needed: ${manualCommand}`);
    return { dnsName };
  }

  const serveBg = runTailscaleCommand(tailscaleBin, ["serve", "--bg", expectedProxyTarget]);
  if (!serveBg || serveBg.exitCode !== 0) {
    const reason = serveBg?.stderr?.trim() || serveBg?.stdout?.trim() || "unknown error";
    console.log(`[vde-monitor] tailscale serve auto-setup failed: ${reason}`);
    console.log(`[vde-monitor] Run manually: ${manualCommand}`);
    return { dnsName };
  }

  const verify = runTailscaleCommand(tailscaleBin, ["serve", "status", "--json"]);
  if (!verify || verify.exitCode !== 0) {
    console.log(
      "[vde-monitor] tailscale serve verification failed. Confirm with: tailscale serve status",
    );
    return { dnsName };
  }

  console.log("[vde-monitor] tailscale serve configured successfully.");
  return { dnsName };
};
