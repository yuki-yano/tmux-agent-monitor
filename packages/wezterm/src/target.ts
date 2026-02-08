import { normalizeWeztermTarget as normalizeWeztermTargetShared } from "@vde-monitor/shared";

export const normalizeWeztermTarget = (value: string | null | undefined): string =>
  normalizeWeztermTargetShared(value);

export const buildWeztermTargetArgs = (target: string | null | undefined): string[] => {
  const normalized = normalizeWeztermTarget(target);
  if (normalized === "auto") {
    return [];
  }
  return ["--target", normalized];
};
