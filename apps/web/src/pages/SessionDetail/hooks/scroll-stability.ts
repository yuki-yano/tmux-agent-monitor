const clampIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
};

const buildSignature = (lines: string[], index: number, size: number) => {
  if (size <= 0) return [];
  return lines.slice(index, Math.min(lines.length, index + size));
};

const matchesAt = (lines: string[], sequence: string[], startIndex: number) => {
  for (let offset = 0; offset < sequence.length; offset += 1) {
    if (lines[startIndex + offset] !== sequence[offset]) {
      return false;
    }
  }
  return true;
};

const matchesSequenceAt = (lines: string[], sequence: string[], startIndex: number) =>
  lines[startIndex] === sequence[0] && matchesAt(lines, sequence, startIndex);

const findSequenceInRange = (lines: string[], sequence: string[], start: number, end: number) => {
  for (let i = start; i <= end; i += 1) {
    if (matchesSequenceAt(lines, sequence, i)) {
      return i;
    }
  }
  return null;
};

const findSequenceIndex = (
  lines: string[],
  sequence: string[],
  expectedIndex: number | null,
  windowSize = 160,
): number | null => {
  if (sequence.length === 0 || lines.length < sequence.length) return null;
  const maxStart = lines.length - sequence.length;
  if (expectedIndex != null) {
    const windowStart = Math.max(0, expectedIndex - windowSize);
    const windowEnd = Math.min(maxStart, expectedIndex + windowSize);
    const nearbyMatch = findSequenceInRange(lines, sequence, windowStart, windowEnd);
    if (nearbyMatch != null) {
      return nearbyMatch;
    }
  }
  return findSequenceInRange(lines, sequence, 0, maxStart);
};

const findDropTop = (prev: string[], next: string[]) => {
  if (!prev.length || !next.length) return 0;
  const maxOverlap = Math.min(prev.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const prevStart = prev.length - overlap;
    let matches = true;
    for (let i = 0; i < overlap; i += 1) {
      if (prev[prevStart + i] !== next[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return prevStart;
    }
  }
  return 0;
};

export const mapAnchorIndex = (prev: string[], next: string[], anchorIndex: number) => {
  if (!next.length) return 0;
  if (!prev.length) return clampIndex(anchorIndex, next.length);
  const safeAnchor = clampIndex(anchorIndex, prev.length);
  const dropTop = findDropTop(prev, next);
  const expectedIndex = clampIndex(safeAnchor - dropTop, next.length);
  const signatureSizes = [3, 2, 1];
  for (const size of signatureSizes) {
    const signature = buildSignature(prev, safeAnchor, size);
    if (!signature.length) continue;
    const match = findSequenceIndex(next, signature, expectedIndex);
    if (match != null) return match;
  }
  return expectedIndex;
};

export const __testables = {
  clampIndex,
  findDropTop,
  findSequenceIndex,
};
