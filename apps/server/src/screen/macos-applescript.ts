import { execa } from "execa";

const runCommand = (command: string, args: string[], timeout?: number) =>
  execa(command, args, timeout ? { timeout } : undefined);

export const runAppleScript = async (script: string) => {
  try {
    const result = await runCommand("osascript", ["-e", script]);
    return (result.stdout ?? "").trim();
  } catch {
    return "";
  }
};

export const isAppRunning = async (appName: string) => {
  const result = await runAppleScript(
    `tell application "System Events" to (exists process "${appName}")`,
  );
  return result.trim() === "true";
};

export const focusTerminalApp = async (appName: string) => {
  await runAppleScript(`tell application "${appName}" to activate`);
};
