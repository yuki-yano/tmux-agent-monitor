export type VirtualLineItem = {
  id: string;
  html: string;
};

export type VirtualLineItemsState = {
  items: VirtualLineItem[];
  nextId: number;
};

const getLongestSuffixPrefixOverlap = (left: string[], right: string[]) => {
  const maxLength = Math.min(left.length, right.length);
  if (maxLength === 0) {
    return 0;
  }
  const separator = Symbol("virtual-line-overlap");
  const sequence: Array<string | symbol> = [
    ...right.slice(0, maxLength),
    separator,
    ...left.slice(left.length - maxLength),
  ];
  const prefixLengths = Array.from({ length: sequence.length }, () => 0);
  for (let index = 1; index < sequence.length; index += 1) {
    let candidateLength = prefixLengths[index - 1] ?? 0;
    while (candidateLength > 0 && sequence[index] !== sequence[candidateLength]) {
      candidateLength = prefixLengths[candidateLength - 1] ?? 0;
    }
    if (sequence[index] === sequence[candidateLength]) {
      candidateLength += 1;
    }
    prefixLengths[index] = candidateLength;
  }
  return Math.min(prefixLengths[prefixLengths.length - 1] ?? 0, maxLength);
};

const assignItem = (
  nextItems: Array<VirtualLineItem | null>,
  usedPreviousIndexes: boolean[],
  nextIndex: number,
  previousIndex: number,
  previousItems: VirtualLineItem[],
  html: string,
) => {
  const previousItem = previousItems[previousIndex];
  if (!previousItem || usedPreviousIndexes[previousIndex] || nextItems[nextIndex]) {
    return;
  }
  usedPreviousIndexes[previousIndex] = true;
  nextItems[nextIndex] = previousItem.html === html ? previousItem : { id: previousItem.id, html };
};

export const reconcileVirtualLineItems = (
  previousState: VirtualLineItemsState,
  lines: string[],
): VirtualLineItemsState => {
  const previousItems = previousState.items;
  const previousLines = previousItems.map((item) => item.html);
  const nextItems: Array<VirtualLineItem | null> = Array.from({ length: lines.length }, () => null);
  const usedPreviousIndexes = Array.from({ length: previousItems.length }, () => false);

  let prefixLength = 0;
  while (
    prefixLength < previousLines.length &&
    prefixLength < lines.length &&
    previousLines[prefixLength] === lines[prefixLength]
  ) {
    assignItem(
      nextItems,
      usedPreviousIndexes,
      prefixLength,
      prefixLength,
      previousItems,
      lines[prefixLength] ?? "",
    );
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousLines.length - prefixLength &&
    suffixLength < lines.length - prefixLength
  ) {
    const previousIndex = previousLines.length - suffixLength - 1;
    const nextIndex = lines.length - suffixLength - 1;
    if (previousLines[previousIndex] !== lines[nextIndex]) {
      break;
    }
    assignItem(
      nextItems,
      usedPreviousIndexes,
      nextIndex,
      previousIndex,
      previousItems,
      lines[nextIndex] ?? "",
    );
    suffixLength += 1;
  }

  const suffixPrefixOverlap = getLongestSuffixPrefixOverlap(previousLines, lines);
  for (let offset = 0; offset < suffixPrefixOverlap; offset += 1) {
    const previousIndex = previousLines.length - suffixPrefixOverlap + offset;
    assignItem(
      nextItems,
      usedPreviousIndexes,
      offset,
      previousIndex,
      previousItems,
      lines[offset] ?? "",
    );
  }

  const prefixSuffixOverlap = getLongestSuffixPrefixOverlap(lines, previousLines);
  for (let offset = 0; offset < prefixSuffixOverlap; offset += 1) {
    const nextIndex = lines.length - prefixSuffixOverlap + offset;
    assignItem(
      nextItems,
      usedPreviousIndexes,
      nextIndex,
      offset,
      previousItems,
      lines[nextIndex] ?? "",
    );
  }

  const previousIndexesByHtml = new Map<string, number[]>();
  previousItems.forEach((item, index) => {
    if (usedPreviousIndexes[index]) {
      return;
    }
    const indexes = previousIndexesByHtml.get(item.html);
    if (indexes) {
      indexes.push(index);
    } else {
      previousIndexesByHtml.set(item.html, [index]);
    }
  });

  lines.forEach((line, nextIndex) => {
    if (nextItems[nextIndex]) {
      return;
    }
    const matchingIndexes = previousIndexesByHtml.get(line);
    const previousIndex = matchingIndexes?.shift();
    if (previousIndex == null) {
      return;
    }
    assignItem(nextItems, usedPreviousIndexes, nextIndex, previousIndex, previousItems, line);
  });

  lines.forEach((line, index) => {
    if (nextItems[index] || usedPreviousIndexes[index]) {
      return;
    }
    assignItem(nextItems, usedPreviousIndexes, index, index, previousItems, line);
  });

  let nextId = previousState.nextId;
  const resolvedItems = nextItems.map((item, index) => {
    if (item) {
      return item;
    }
    const nextItem = { id: `virtual-line-${nextId}`, html: lines[index] ?? "" };
    nextId += 1;
    return nextItem;
  });

  return { items: resolvedItems, nextId };
};

export const createVirtualLineItemsState = (lines: string[]) =>
  reconcileVirtualLineItems({ items: [], nextId: 0 }, lines);
