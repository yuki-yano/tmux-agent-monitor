export const normalizeWeztermTarget = (value: string | null | undefined): string => {
  if (value == null) {
    return "auto";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "auto") {
    return "auto";
  }
  return trimmed;
};

export const buildWeztermTargetArgs = (target: string | null | undefined): string[] => {
  const normalized = normalizeWeztermTarget(target);
  if (normalized === "auto") {
    return [];
  }
  return ["--target", normalized];
};
