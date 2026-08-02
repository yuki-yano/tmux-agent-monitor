import type { DiffFileStatus } from "@vde-monitor/shared";

export const pickStatus = (value: string): DiffFileStatus => {
  const allowed: DiffFileStatus[] = ["A", "M", "D", "R", "C", "U", "?"];
  const status = value.toUpperCase().slice(0, 1);
  return allowed.includes(status as DiffFileStatus) ? (status as DiffFileStatus) : "?";
};

export const isBinaryPatch = (patch: string) => {
  const binaryPattern = /^(Binary files |GIT binary patch$|literal \d+|delta \d+)/m;
  return binaryPattern.test(patch);
};

export type NumstatCounts = { additions: number | null; deletions: number | null };

const parseNumstatValue = (raw: string) => {
  if (raw === "-") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildNumstatCounts = (addRaw: string, delRaw: string): NumstatCounts => ({
  additions: parseNumstatValue(addRaw),
  deletions: parseNumstatValue(delRaw),
});

const parseNumstatParts = (parts: string[]) => {
  if (parts.length < 3) {
    return null;
  }
  const pathValue = parts[parts.length - 1] ?? "";
  return {
    pathValue,
    counts: buildNumstatCounts(parts[0] ?? "", parts[1] ?? ""),
  };
};

const parseNullDelimitedNumstat = (output: string) => {
  const stats = new Map<string, NumstatCounts>();
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const firstTab = token.indexOf("\t");
    const secondTab = token.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      continue;
    }
    const counts = buildNumstatCounts(
      token.slice(0, firstTab),
      token.slice(firstTab + 1, secondTab),
    );
    const path = token.slice(secondTab + 1);
    if (path) {
      stats.set(path, counts);
      continue;
    }
    const renamedTo = tokens[index + 2];
    if (renamedTo) {
      stats.set(renamedTo, counts);
      index += 2;
    }
  }
  return stats;
};

const findFirstContentLine = (output: string) =>
  output
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? null;

export const parseNumstat = (output: string) => {
  if (output.includes("\0")) {
    return parseNullDelimitedNumstat(output);
  }
  const stats = new Map<string, { additions: number | null; deletions: number | null }>();
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parsed = parseNumstatParts(line.split("\t"));
    if (!parsed) {
      continue;
    }
    stats.set(parsed.pathValue, parsed.counts);
  }
  return stats;
};

export const parseNumstatLine = (output: string) => {
  const line = findFirstContentLine(output);
  if (!line) {
    return null;
  }
  const parts = line.split("\t");
  if (parts.length < 2) {
    return null;
  }
  return buildNumstatCounts(parts[0] ?? "", parts[1] ?? "");
};
