import type { HighlightCorrectionConfig } from "@vde-monitor/shared";
import AnsiToHtml from "ansi-to-html";

import type { Theme } from "@/lib/theme";

import { applyAdjacentBackgroundPadding } from "./ansi-background-padding";
import { applyClaudeDiffMask, buildClaudeDiffMask, renderClaudeDiffLine } from "./ansi-claude-diff";
import { blendRgb, contrastRatio, luminance, parseColor } from "./ansi-colors";
import {
  ensureLineContent,
  extractBackgroundColor,
  isUnicodeTableHtmlLine,
  normalizeUnicodeTableLines,
  replaceBackgroundColors,
  sanitizeAnsiForHtml,
  splitLines,
  stripAnsi,
  unwrapUnicodeTableHtmlLine,
  wrapLineBackground,
} from "./ansi-text-utils";

const catppuccinLatteAnsi: Record<number, string> = {
  0: "#4c4f69",
  1: "#d20f39",
  2: "#40a02b",
  3: "#df8e1d",
  4: "#1e66f5",
  5: "#8839ef",
  6: "#179299",
  7: "#5c5f77",
  8: "#7c7f93",
  9: "#e64553",
  10: "#40a02b",
  11: "#fe640b",
  12: "#7287fd",
  13: "#ea76cb",
  14: "#04a5e5",
  15: "#eff1f5",
};

const catppuccinMochaAnsi: Record<number, string> = {
  0: "#1e1e2e",
  1: "#f38ba8",
  2: "#a6e3a1",
  3: "#f9e2af",
  4: "#89b4fa",
  5: "#cba6f7",
  6: "#94e2d5",
  7: "#cdd6f4",
  8: "#7f849c",
  9: "#f38ba8",
  10: "#a6e3a1",
  11: "#fab387",
  12: "#b4befe",
  13: "#f5c2e7",
  14: "#89dceb",
  15: "#cdd6f4",
};

const ansiConfigByTheme = {
  latte: {
    fg: "#4c4f69",
    colors: catppuccinLatteAnsi,
  },
  mocha: {
    fg: "#cdd6f4",
    colors: catppuccinMochaAnsi,
  },
} satisfies Record<Theme, { fg: string; colors: Record<number, string> }>;

const buildAnsiToHtml = (theme: Theme, options?: { stream?: boolean }) =>
  new AnsiToHtml({
    fg: ansiConfigByTheme[theme].fg,
    bg: "transparent",
    escapeXML: true,
    colors: ansiConfigByTheme[theme].colors,
    ...options,
  });

const ansiToHtmlByTheme: Record<Theme, AnsiToHtml> = {
  latte: buildAnsiToHtml("latte"),
  mocha: buildAnsiToHtml("mocha"),
};

const fallbackByTheme: Record<Theme, { background: string; text: string }> = {
  latte: { background: "#e6e9ef", text: "#4c4f69" },
  mocha: { background: "#313244", text: "#cdd6f4" },
};

type RenderAnsiOptions = {
  agent?: "codex" | "claude" | "unknown";
  highlightCorrections?: HighlightCorrectionConfig;
};

const isHighlightCorrectionEnabled = (
  options: RenderAnsiOptions | undefined,
  agent: "codex" | "claude",
) => {
  const value = options?.highlightCorrections?.[agent];
  return value !== false;
};

const shouldApplyHighlight = (options: RenderAnsiOptions | undefined, agent: "codex" | "claude") =>
  options?.agent === agent && isHighlightCorrectionEnabled(options, agent);

const needsLowContrastAdjust = (html: string, theme: Theme, options?: RenderAnsiOptions) => {
  if (!shouldApplyHighlight(options, "claude")) return false;
  if (html.includes("background-color")) return true;
  return theme === "latte" && html.includes("color:");
};

const resolveInlineColor = (node: HTMLElement): ReturnType<typeof parseColor> => {
  let current: HTMLElement | null = node;
  while (current) {
    const parsed = parseColor(current.style.color);
    if (parsed) return parsed;
    current = current.parentElement;
  }
  return null;
};

const applyContrastFallback = (
  node: HTMLElement,
  fallback: { background: string; text: string },
): void => {
  node.style.backgroundColor = fallback.background;
  node.style.color = fallback.text;
};

const adjustLatteNodeContrast = (
  node: HTMLElement,
  fallback: { background: string; text: string },
  options?: RenderAnsiOptions,
): void => {
  const bg = parseColor(node.style.backgroundColor);
  if (bg) {
    if (luminance(bg) > 0.28) {
      return;
    }
    applyContrastFallback(node, fallback);
    return;
  }
  if (options?.agent !== "claude") {
    return;
  }
  const fg = parseColor(node.style.color);
  if (!fg) {
    return;
  }
  if (luminance(fg) <= 0.85) {
    return;
  }
  node.style.color = fallback.text;
};

const adjustMochaNodeContrast = (
  node: HTMLElement,
  fallback: { background: string; text: string },
): void => {
  const bg = parseColor(node.style.backgroundColor);
  if (!bg) {
    return;
  }
  const fg = resolveInlineColor(node);
  if (!fg) {
    return;
  }
  if (contrastRatio(bg, fg) >= 3) {
    return;
  }
  applyContrastFallback(node, fallback);
};

const adjustLowContrast = (html: string, theme: Theme, options?: RenderAnsiOptions): string => {
  if (typeof window === "undefined") {
    return html;
  }
  if (!needsLowContrastAdjust(html, theme, options)) {
    return html;
  }
  const fallback = fallbackByTheme[theme];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nodes = Array.from(doc.querySelectorAll<HTMLElement>("[style]"));
  nodes.forEach((node) => {
    if (theme === "latte") {
      adjustLatteNodeContrast(node, fallback, options);
      return;
    }
    adjustMochaNodeContrast(node, fallback);
  });
  return doc.body.innerHTML;
};

const convertAnsiLineToHtml = (
  converter: AnsiToHtml,
  line: string,
  theme: Theme,
  options?: RenderAnsiOptions,
) => adjustLowContrast(converter.toHtml(line), theme, options);

const codexLatteBackgroundTarget = "#e6e9ef";

const normalizeCodexBackgrounds = (
  html: string,
  theme: Theme,
  options?: RenderAnsiOptions,
): string => {
  if (theme !== "latte" || !shouldApplyHighlight(options, "codex")) {
    return html;
  }
  if (!html.includes("background-color")) {
    return html;
  }
  const fallbackRgb = parseColor(codexLatteBackgroundTarget);
  if (!fallbackRgb) {
    return html;
  }
  return replaceBackgroundColors(html, (match, rawValue: string) => {
    const value = rawValue.trim();
    const rgb = parseColor(value);
    if (!rgb) {
      return match;
    }
    if (luminance(rgb) > 0.28) {
      return match;
    }
    const blended = blendRgb(rgb, fallbackRgb, 1);
    return `background-color: rgb(${blended[0]}, ${blended[1]}, ${blended[2]})`;
  });
};

const renderDefaultLines = (
  lines: string[],
  converter: AnsiToHtml,
  theme: Theme,
  options: RenderAnsiOptions | undefined,
  shouldApplyCodexHighlight: boolean,
): string[] => {
  const rendered = lines.map((line) => {
    if (isUnicodeTableHtmlLine(line)) {
      return ensureLineContent(unwrapUnicodeTableHtmlLine(line));
    }
    const html = convertAnsiLineToHtml(converter, line, theme, options);
    const normalized = shouldApplyCodexHighlight
      ? normalizeCodexBackgrounds(html, theme, options)
      : html;
    return ensureLineContent(normalized);
  });
  return shouldApplyCodexHighlight ? applyAdjacentBackgroundPadding(rendered, lines) : rendered;
};

const renderClaudeLines = (
  lines: string[],
  converter: AnsiToHtml,
  theme: Theme,
  options: RenderAnsiOptions | undefined,
): string[] => {
  const plainLines = lines.map((line) => (isUnicodeTableHtmlLine(line) ? "" : stripAnsi(line)));
  const diffMask = buildClaudeDiffMask(plainLines);
  const maskedHtml = applyClaudeDiffMask(plainLines, diffMask);
  const rendered = lines.map((line, index) => {
    if (isUnicodeTableHtmlLine(line)) {
      return ensureLineContent(unwrapUnicodeTableHtmlLine(line));
    }
    if (!diffMask[index]) {
      const html = convertAnsiLineToHtml(converter, line, theme, options);
      return ensureLineContent(html);
    }
    const plainLine = plainLines[index] ?? "";
    const masked = maskedHtml[index] ?? renderClaudeDiffLine(plainLine);
    return ensureLineContent(masked);
  });
  return normalizeClaudePromptBackgrounds(rendered, plainLines);
};

const claudePromptStartPattern = /^\s*\u276f(?:\s|$)/;
const startsWithWhitespacePattern = /^\s/;

const resolvePromptBlockEnd = (plainLines: string[], start: number) => {
  for (let index = start + 1; index < plainLines.length; index += 1) {
    const line = plainLines[index] ?? "";
    if (claudePromptStartPattern.test(line)) {
      return index;
    }
    if (line.trim().length > 0 && !startsWithWhitespacePattern.test(line)) {
      return index;
    }
  }
  return plainLines.length;
};

const pickPromptBlockColor = (renderedLines: string[], start: number, endExclusive: number) => {
  const entries = new Map<string, { count: number; first: number }>();
  for (let index = start; index < endExclusive; index += 1) {
    const color = extractBackgroundColor(renderedLines[index] ?? "");
    const normalized = color?.trim().toLowerCase();
    if (!normalized || normalized === "transparent") {
      continue;
    }
    const entry = entries.get(normalized);
    if (entry) {
      entry.count += 1;
      continue;
    }
    entries.set(normalized, { count: 1, first: index });
  }
  let bestColor: string | null = null;
  let bestCount = -1;
  let bestFirst = Number.POSITIVE_INFINITY;
  entries.forEach((value, color) => {
    if (value.count > bestCount || (value.count === bestCount && value.first < bestFirst)) {
      bestColor = color;
      bestCount = value.count;
      bestFirst = value.first;
    }
  });
  return bestColor;
};

const normalizePromptLineBackground = (html: string, color: string) =>
  wrapLineBackground(
    replaceBackgroundColors(html, (match, rawValue) => {
      const normalized = rawValue.trim().toLowerCase();
      if (normalized === "transparent") {
        return match;
      }
      return `background-color:${color}`;
    }),
    color,
  );

const normalizeClaudePromptBackgrounds = (renderedLines: string[], plainLines: string[]) => {
  const normalized = [...renderedLines];
  let index = 0;
  while (index < plainLines.length) {
    const line = plainLines[index] ?? "";
    if (!claudePromptStartPattern.test(line)) {
      index += 1;
      continue;
    }
    const endExclusive = resolvePromptBlockEnd(plainLines, index);
    const color = pickPromptBlockColor(normalized, index, endExclusive);
    if (color) {
      for (let cursor = index; cursor < endExclusive; cursor += 1) {
        const html = normalized[cursor] ?? "";
        const currentBg = extractBackgroundColor(html)?.trim().toLowerCase();
        if (!currentBg || currentBg === "transparent") {
          continue;
        }
        normalized[cursor] = normalizePromptLineBackground(html, color);
      }
    }
    index = endExclusive;
  }
  return normalized;
};

export const renderAnsi = (text: string, theme: Theme = "latte"): string => {
  const html = ansiToHtmlByTheme[theme].toHtml(sanitizeAnsiForHtml(text));
  return adjustLowContrast(html, theme);
};

export const renderAnsiLines = (
  text: string,
  theme: Theme = "latte",
  options?: RenderAnsiOptions,
): string[] => {
  const converter = buildAnsiToHtml(theme, { stream: false });
  const lines = splitLines(sanitizeAnsiForHtml(text));
  const shouldNormalizeUnicodeTable = options?.agent === "claude" || options?.agent === "unknown";
  const normalizedLines = shouldNormalizeUnicodeTable ? normalizeUnicodeTableLines(lines) : lines;
  const shouldApplyCodexHighlight = shouldApplyHighlight(options, "codex");
  const shouldApplyClaudeHighlight = shouldApplyHighlight(options, "claude");
  if (!shouldApplyClaudeHighlight) {
    return renderDefaultLines(
      normalizedLines,
      converter,
      theme,
      options,
      shouldApplyCodexHighlight,
    );
  }
  return renderClaudeLines(normalizedLines, converter, theme, options);
};
