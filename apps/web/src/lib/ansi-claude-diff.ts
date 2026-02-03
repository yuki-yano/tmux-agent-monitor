const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const lineNumberPattern = /^(\s*\d+)(\s+(?:[|:\u2502]\s*)?)(.*)$/;

const parseLineNumberParts = (line: string) => {
  const match = line.match(lineNumberPattern);
  if (!match) return null;
  return {
    prefix: `${match[1] ?? ""}${match[2] ?? ""}`,
    rest: match[3] ?? "",
  };
};

const leadingWhitespaceLength = (line: string) => {
  const match = line.match(/^\s+/);
  return match?.[0]?.length ?? 0;
};

const hasDiffMarker = (line: string) => {
  const parsed = parseLineNumberParts(line);
  if (!parsed) return false;
  const restTrimmed = parsed.rest.trimStart();
  return restTrimmed.startsWith("+") || restTrimmed.startsWith("-");
};

const isDiffCandidateLine = (line: string) => {
  if (parseLineNumberParts(line)) return true;
  const trimmed = line.trim();
  return trimmed === "" || trimmed === "...";
};

export const buildClaudeDiffMask = (lines: string[]) => {
  const mask = new Array(lines.length).fill(false);
  let segmentStart = -1;
  let segmentIndent: number | null = null;
  const closeSegment = (end: number) => {
    if (segmentStart < 0) return;
    let include = false;
    for (let i = segmentStart; i <= end; i += 1) {
      if (hasDiffMarker(lines[i] ?? "")) {
        include = true;
        break;
      }
    }
    if (include) {
      for (let i = segmentStart; i <= end; i += 1) {
        mask[i] = true;
      }
    }
    segmentStart = -1;
    segmentIndent = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const parsed = parseLineNumberParts(line);
    if (parsed) {
      if (segmentStart === -1) {
        segmentStart = i;
      }
      segmentIndent = Math.max(1, leadingWhitespaceLength(line));
      continue;
    }
    if (isDiffCandidateLine(line)) {
      if (segmentStart === -1) {
        segmentStart = i;
      }
      continue;
    }
    const isContinuation =
      segmentStart !== -1 &&
      segmentIndent !== null &&
      leadingWhitespaceLength(line) >= segmentIndent;
    if (isContinuation) {
      continue;
    }
    closeSegment(i - 1);
  }
  closeSegment(lines.length - 1);
  return mask;
};

export const renderClaudeDiffLine = (plainLine: string) => {
  const parsed = parseLineNumberParts(plainLine);
  if (!parsed) {
    return `<span class="text-latte-text">${escapeHtml(plainLine)}</span>`;
  }
  const restTrimmed = parsed.rest.trimStart();
  const restClass = restTrimmed.startsWith("+")
    ? "text-latte-green"
    : restTrimmed.startsWith("-")
      ? "text-latte-red"
      : "text-latte-text";
  return `<span class="text-latte-text">${escapeHtml(parsed.prefix)}</span><span class="${restClass}">${escapeHtml(parsed.rest)}</span>`;
};

const renderClaudeContinuationLine = (
  plainLine: string,
  marker: "add" | "remove" | "neutral" | null,
) => {
  const className =
    marker === "add"
      ? "text-latte-green"
      : marker === "remove"
        ? "text-latte-red"
        : "text-latte-text";
  return `<span class="${className}">${escapeHtml(plainLine)}</span>`;
};

const resolveClaudeMarker = (plainLine: string): "add" | "remove" | "neutral" => {
  const parsed = parseLineNumberParts(plainLine);
  if (!parsed) return "neutral";
  const restTrimmed = parsed.rest.trimStart();
  if (restTrimmed.startsWith("+")) return "add";
  if (restTrimmed.startsWith("-")) return "remove";
  return "neutral";
};

const isClaudeNeutralLine = (plainLine: string) => {
  const trimmed = plainLine.trim();
  return trimmed === "" || trimmed === "...";
};

export const applyClaudeDiffMask = (plainLines: string[], diffMask: boolean[]) => {
  let currentMarker: "add" | "remove" | "neutral" | null = null;
  return plainLines.map((plainLine, index) => {
    if (!diffMask[index]) {
      currentMarker = null;
      return null;
    }
    const parsed = parseLineNumberParts(plainLine);
    if (parsed) {
      currentMarker = resolveClaudeMarker(plainLine);
      return renderClaudeDiffLine(plainLine);
    }
    if (isClaudeNeutralLine(plainLine)) {
      currentMarker = "neutral";
      return renderClaudeContinuationLine(plainLine, "neutral");
    }
    return renderClaudeContinuationLine(plainLine, currentMarker);
  });
};
