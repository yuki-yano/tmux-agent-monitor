import { extractBackgroundColor, stripAnsi, wrapLineBackground } from "./ansi-text-utils";

type NullableColor = string | null;

const promptStartPattern = /^\s*\u203A(?:\s|$)/;
const lineStartsWithWhitespacePattern = /^\s/;
// eslint-disable-next-line no-control-regex
const sgrPattern = /\u001b\[([0-9;]*)m/g;

const normalizeBackgroundColor = (color: string | null): NullableColor => color;

const parseSgrCodes = (rawCodes: string): number[] =>
  rawCodes === "" ? [0] : rawCodes.split(";").map((value) => Number(value));

type BackgroundScanState = {
  active: boolean;
  lineHasBackground: boolean;
};

const isFiniteCode = (code: number | undefined): code is number =>
  typeof code === "number" && Number.isFinite(code);

const isResetBackgroundCode = (code: number) => code === 0 || code === 49;

const isBasicBackgroundCode = (code: number) =>
  (code >= 40 && code <= 47) || (code >= 100 && code <= 107);

const resolveExtendedBackgroundStep = (
  code: number,
  codes: number[],
  index: number,
): number | null => {
  if (code !== 48) {
    return null;
  }
  const mode = codes[index + 1];
  if (mode === 5) {
    return 3;
  }
  if (mode === 2) {
    return 5;
  }
  return 1;
};

const activateBackground = (state: BackgroundScanState) => {
  state.active = true;
  state.lineHasBackground = true;
};

const applyBackgroundCode = (
  code: number | undefined,
  codes: number[],
  index: number,
  state: BackgroundScanState,
): number => {
  if (!isFiniteCode(code)) {
    return 1;
  }
  if (isResetBackgroundCode(code)) {
    state.active = false;
    return 1;
  }
  if (isBasicBackgroundCode(code)) {
    activateBackground(state);
    return 1;
  }
  const extendedStep = resolveExtendedBackgroundStep(code, codes, index);
  if (extendedStep == null) {
    return 1;
  }
  activateBackground(state);
  return extendedStep;
};

const scanBackgroundLine = (line: string, active: boolean): BackgroundScanState => {
  const state: BackgroundScanState = { active, lineHasBackground: active };
  sgrPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = sgrPattern.exec(line))) {
    const codes = parseSgrCodes(match[1] ?? "");
    let index = 0;
    while (index < codes.length) {
      const code = codes[index];
      index += applyBackgroundCode(code, codes, index, state);
    }
  }
  return state;
};

const buildBackgroundActivityMask = (rawLines: string[]): boolean[] => {
  let active = false;
  return rawLines.map((line) => {
    const state = scanBackgroundLine(line, active);
    active = state.active;
    return state.lineHasBackground;
  });
};

const buildNextColorIndex = (baseColors: NullableColor[]): number[] => {
  const nextColorIndex = new Array<number>(baseColors.length).fill(-1);
  let nextColor = -1;
  for (let index = baseColors.length - 1; index >= 0; index -= 1) {
    nextColorIndex[index] = nextColor;
    if (baseColors[index]) {
      nextColor = index;
    }
  }
  return nextColorIndex;
};

const resolveNextColor = (
  baseColors: NullableColor[],
  nextColorIndex: number[],
  index: number,
): NullableColor => {
  const nextIndex = nextColorIndex[index];
  return typeof nextIndex === "number" && nextIndex >= 0 ? (baseColors[nextIndex] ?? null) : null;
};

const findPromptBlockEnd = (
  start: number,
  lineCount: number,
  isPromptStart: boolean[],
  lineHasContent: boolean[],
  lineStartsWithWhitespace: boolean[],
) => {
  for (let index = start + 1; index < lineCount; index += 1) {
    if (isPromptStart[index]) {
      return index;
    }
    if (lineHasContent[index] && !lineStartsWithWhitespace[index]) {
      return index;
    }
  }
  return lineCount;
};

const fillPromptHighlightMask = (
  highlightMask: boolean[],
  start: number,
  endExclusive: number,
  isPromptStart: boolean[],
  lineHasContent: boolean[],
) => {
  let lastContent = -1;
  for (let index = start; index < endExclusive; index += 1) {
    if (isPromptStart[index] || lineHasContent[index]) {
      lastContent = index;
    }
  }
  if (lastContent === -1) {
    return;
  }
  for (let index = start; index <= lastContent; index += 1) {
    highlightMask[index] = true;
  }
  const trailing = lastContent + 1;
  if (trailing < endExclusive && !lineHasContent[trailing]) {
    highlightMask[trailing] = true;
  }
};

const buildPromptHighlightMask = (
  rawLines: string[],
  plainLines: string[],
  isPromptStart: boolean[],
  lineHasContent: boolean[],
): boolean[] => {
  const lineStartsWithWhitespace = plainLines.map(
    (line) => line.length > 0 && lineStartsWithWhitespacePattern.test(line),
  );
  const highlightMask = new Array<boolean>(rawLines.length).fill(false);
  for (let index = 0; index < rawLines.length; index += 1) {
    if (!isPromptStart[index]) {
      continue;
    }
    const endExclusive = findPromptBlockEnd(
      index,
      rawLines.length,
      isPromptStart,
      lineHasContent,
      lineStartsWithWhitespace,
    );
    fillPromptHighlightMask(highlightMask, index, endExclusive, isPromptStart, lineHasContent);
    index = endExclusive - 1;
  }
  return highlightMask;
};

type PromptPaddingState = {
  inBlock: boolean;
  blockColor: NullableColor;
};

const updatePromptPaddingState = ({
  highlight,
  baseColor,
  baseColors,
  nextColorIndex,
  index,
  state,
}: {
  highlight: boolean;
  baseColor: NullableColor;
  baseColors: NullableColor[];
  nextColorIndex: number[];
  index: number;
  state: PromptPaddingState;
}) => {
  if (!highlight) {
    state.inBlock = false;
    state.blockColor = null;
    return;
  }
  if (!state.inBlock) {
    state.inBlock = true;
    state.blockColor = baseColor ?? resolveNextColor(baseColors, nextColorIndex, index);
    return;
  }
  if (baseColor) {
    state.blockColor = baseColor;
  }
};

const applyPromptPaddingColor = (
  paddedColors: NullableColor[],
  index: number,
  state: PromptPaddingState,
) => {
  if (state.blockColor && !paddedColors[index]) {
    paddedColors[index] = state.blockColor;
  }
};

const buildPromptPaddedColors = (
  baseColors: NullableColor[],
  highlightMask: boolean[],
  nextColorIndex: number[],
): NullableColor[] => {
  const paddedColors: NullableColor[] = [...baseColors];
  const state: PromptPaddingState = { inBlock: false, blockColor: null };
  for (let index = 0; index < highlightMask.length; index += 1) {
    const highlight = Boolean(highlightMask[index]);
    const baseColor = baseColors[index] ?? null;
    updatePromptPaddingState({
      highlight,
      baseColor,
      baseColors,
      nextColorIndex,
      index,
      state,
    });
    if (highlight) {
      applyPromptPaddingColor(paddedColors, index, state);
    }
  }
  return paddedColors;
};

const buildSegmentBreakers = (lineHasContent: boolean[], lineHasBackground: boolean[]) =>
  lineHasContent.map((hasText, index) => hasText && !lineHasBackground[index]);

const buildNextBackgroundInSegment = (
  lineHasBackground: boolean[],
  segmentBreakers: boolean[],
): number[] => {
  const nextBackgroundInSegment = new Array<number>(lineHasBackground.length).fill(-1);
  let nextBackground = -1;
  for (let index = lineHasBackground.length - 1; index >= 0; index -= 1) {
    if (segmentBreakers[index]) {
      nextBackground = -1;
      nextBackgroundInSegment[index] = -1;
      continue;
    }
    nextBackgroundInSegment[index] = nextBackground;
    if (lineHasBackground[index]) {
      nextBackground = index;
    }
  }
  return nextBackgroundInSegment;
};

const buildSegmentPaddedColors = (
  baseColors: NullableColor[],
  lineHasContent: boolean[],
  lineHasBackground: boolean[],
  nextColorIndex: number[],
): NullableColor[] => {
  const paddedColors: NullableColor[] = [...baseColors];
  const segmentBreakers = buildSegmentBreakers(lineHasContent, lineHasBackground);
  const nextBackgroundInSegment = buildNextBackgroundInSegment(lineHasBackground, segmentBreakers);

  const state = {
    inBlock: false,
    blockColor: null as NullableColor,
    trailingPadUsed: false,
  };

  const resetState = () => {
    state.inBlock = false;
    state.blockColor = null;
    state.trailingPadUsed = false;
  };

  const applyColor = (index: number) => {
    if (state.blockColor && !paddedColors[index]) {
      paddedColors[index] = state.blockColor;
    }
  };

  const startBlock = (index: number) => {
    state.inBlock = true;
    state.trailingPadUsed = false;
    const baseColor = baseColors[index] ?? null;
    if (baseColor) {
      state.blockColor = baseColor;
    } else if (!state.blockColor) {
      state.blockColor = resolveNextColor(baseColors, nextColorIndex, index);
    }
    applyColor(index);
  };

  const keepEmptyLineInBlock = (index: number): boolean => {
    if (nextBackgroundInSegment[index] !== -1) {
      applyColor(index);
      return true;
    }
    if (!state.trailingPadUsed) {
      applyColor(index);
      state.trailingPadUsed = true;
      return true;
    }
    return false;
  };

  for (let index = 0; index < lineHasBackground.length; index += 1) {
    if (segmentBreakers[index]) {
      resetState();
      continue;
    }
    if (lineHasBackground[index]) {
      startBlock(index);
      continue;
    }
    if (!state.inBlock) {
      continue;
    }
    if (!lineHasContent[index] && keepEmptyLineInBlock(index)) {
      continue;
    }
    resetState();
  }

  return paddedColors;
};

const applyPaddedColors = (htmlLines: string[], paddedColors: NullableColor[]): string[] =>
  htmlLines.map((html, index) => {
    const color = paddedColors[index];
    if (!color) {
      return html;
    }
    return wrapLineBackground(html, color);
  });

export const applyAdjacentBackgroundPadding = (
  htmlLines: string[],
  rawLines: string[],
): string[] => {
  if (htmlLines.length === 0) {
    return htmlLines;
  }

  const baseColors = htmlLines.map((html) =>
    normalizeBackgroundColor(extractBackgroundColor(html)),
  );
  const plainLines = rawLines.map((line) => stripAnsi(line ?? ""));
  const lineHasContent = plainLines.map((line) => line.trim().length > 0);
  const isPromptStart = plainLines.map((line) => promptStartPattern.test(line));
  const lineHasBackground = buildBackgroundActivityMask(rawLines).map(
    (active, index) => active || Boolean(baseColors[index]),
  );
  const nextColorIndex = buildNextColorIndex(baseColors);

  if (isPromptStart.some(Boolean)) {
    const highlightMask = buildPromptHighlightMask(
      rawLines,
      plainLines,
      isPromptStart,
      lineHasContent,
    );
    const paddedColors = buildPromptPaddedColors(baseColors, highlightMask, nextColorIndex);
    return applyPaddedColors(htmlLines, paddedColors);
  }

  const paddedColors = buildSegmentPaddedColors(
    baseColors,
    lineHasContent,
    lineHasBackground,
    nextColorIndex,
  );
  return applyPaddedColors(htmlLines, paddedColors);
};
