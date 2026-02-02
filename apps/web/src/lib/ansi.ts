import AnsiToHtml from "ansi-to-html";

import type { Theme } from "@/lib/theme";

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
};

const needsLowContrastAdjust = (html: string, theme: Theme, options?: RenderAnsiOptions) => {
  if (options?.agent !== "claude") {
    return false;
  }
  if (html.includes("background-color")) {
    return true;
  }
  return theme === "latte" && html.includes("color:");
};

const parseColor = (value: string | null): [number, number, number] | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const rHex = hex[0] ?? "0";
      const gHex = hex[1] ?? "0";
      const bHex = hex[2] ?? "0";
      const r = Number.parseInt(rHex + rHex, 16);
      const g = Number.parseInt(gHex + gHex, 16);
      const b = Number.parseInt(bHex + bHex, 16);
      return [r, g, b];
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2) || "00", 16);
      const g = Number.parseInt(hex.slice(2, 4) || "00", 16);
      const b = Number.parseInt(hex.slice(4, 6) || "00", 16);
      return [r, g, b];
    }
    return null;
  }
  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbMatch) return null;
  return [
    Number.parseInt(rgbMatch[1] ?? "0", 10),
    Number.parseInt(rgbMatch[2] ?? "0", 10),
    Number.parseInt(rgbMatch[3] ?? "0", 10),
  ];
};

const luminance = (rgb: [number, number, number]) => {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const contrastRatio = (a: [number, number, number], b: [number, number, number]) => {
  const lumA = luminance(a);
  const lumB = luminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
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
    const bg = parseColor(node.style.backgroundColor);
    if (theme === "latte") {
      if (bg) {
        const bgLum = luminance(bg);
        if (bgLum > 0.28) return;
        node.style.backgroundColor = fallback.background;
        node.style.color = fallback.text;
        return;
      }
      if (options?.agent === "claude") {
        const fg = parseColor(node.style.color);
        if (!fg) return;
        if (luminance(fg) <= 0.85) return;
        node.style.color = fallback.text;
      }
      return;
    }
    if (!bg) return;
    const fg = parseColor(node.style.color);
    if (!fg) return;
    if (contrastRatio(bg, fg) >= 3) return;
    node.style.backgroundColor = fallback.background;
    node.style.color = fallback.text;
  });
  return doc.body.innerHTML;
};

const ensureLineContent = (html: string): string => {
  const placeholder = "&#x200B;";
  if (!html) {
    return placeholder;
  }
  const text = html.replace(/<[^>]*>/g, "");
  if (text.length > 0) {
    return html;
  }
  if (html.includes("</")) {
    return html.replace(/(<\/[^>]+>)+$/, `${placeholder}$1`);
  }
  return `${html}${placeholder}`;
};

const ansiEscapePattern = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, "g");
const stripAnsi = (value: string) => value.replace(ansiEscapePattern, "");

const backgroundColorPattern = /background-color:\s*([^;"']+)/i;
const backgroundColorPatternGlobal = /background-color:\s*([^;"']+)/gi;

const extractBackgroundColor = (html: string): string | null => {
  const match = html.match(backgroundColorPattern);
  return match?.[1]?.trim() ?? null;
};

const codexLatteBackgroundTarget = "#e6e9ef";

const blendRgb = (
  from: [number, number, number],
  to: [number, number, number],
  ratio: number,
): [number, number, number] => {
  const safeRatio = Math.min(1, Math.max(0, ratio));
  const mix = (value: number, target: number) =>
    Math.round(value * (1 - safeRatio) + target * safeRatio);
  return [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
};

const normalizeCodexBackgrounds = (
  html: string,
  theme: Theme,
  options?: RenderAnsiOptions,
): string => {
  if (options?.agent !== "codex" || theme !== "latte") {
    return html;
  }
  if (!html.includes("background-color")) {
    return html;
  }
  const fallbackRgb = parseColor(codexLatteBackgroundTarget);
  if (!fallbackRgb) {
    return html;
  }
  return html.replace(backgroundColorPatternGlobal, (match, rawValue: string) => {
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

const wrapLineBackground = (html: string, color: string): string => {
  return `<span style="background-color:${color}; display:block; width:100%;">${html}</span>`;
};

const hasVisibleText = (line: string): boolean => stripAnsi(line).length > 0;

const applyAdjacentBackgroundPadding = (htmlLines: string[], rawLines: string[]): string[] => {
  if (htmlLines.length === 0) return htmlLines;
  const baseColors = htmlLines.map(extractBackgroundColor);
  const paddedColors: Array<string | null> = [...baseColors];
  let inBlock = false;
  let blockColor: string | null = null;
  let blockEnd = -1;

  for (let i = 0; i < baseColors.length; i += 1) {
    const baseColor = baseColors[i];
    if (baseColor) {
      inBlock = true;
      blockColor = baseColor;
      blockEnd = i;
      continue;
    }
    if (inBlock && hasVisibleText(rawLines[i] ?? "")) {
      if (!paddedColors[i]) {
        paddedColors[i] = blockColor;
      }
      blockEnd = i;
      continue;
    }
    if (inBlock) {
      const below = i;
      if (blockColor && below < paddedColors.length && !paddedColors[below]) {
        paddedColors[below] = blockColor;
      }
      inBlock = false;
      blockColor = null;
      blockEnd = -1;
    }
  }
  if (inBlock) {
    const below = blockEnd + 1;
    if (blockColor && below < paddedColors.length && !paddedColors[below]) {
      paddedColors[below] = blockColor;
    }
  }

  return htmlLines.map((html, index) => {
    const color = paddedColors[index];
    if (!color) return html;
    return wrapLineBackground(html, color);
  });
};

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

const buildClaudeDiffMask = (lines: string[]) => {
  const mask = new Array(lines.length).fill(false);
  let segmentStart = -1;
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
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isDiffCandidateLine(line)) {
      if (segmentStart === -1) {
        segmentStart = i;
      }
      continue;
    }
    closeSegment(i - 1);
  }
  closeSegment(lines.length - 1);
  return mask;
};

const renderClaudeDiffLine = (plainLine: string) => {
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

export const renderAnsi = (text: string, theme: Theme = "latte"): string => {
  const html = ansiToHtmlByTheme[theme].toHtml(text);
  return adjustLowContrast(html, theme);
};

export const renderAnsiLines = (
  text: string,
  theme: Theme = "latte",
  options?: RenderAnsiOptions,
): string[] => {
  const converter = buildAnsiToHtml(theme, { stream: false });
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const shouldPadBackground = options?.agent === "codex";
  if (options?.agent !== "claude") {
    const rendered = lines.map((line) => {
      const html = converter.toHtml(line);
      const adjusted = adjustLowContrast(html, theme, options);
      const normalized = normalizeCodexBackgrounds(adjusted, theme, options);
      return ensureLineContent(normalized);
    });
    return shouldPadBackground ? applyAdjacentBackgroundPadding(rendered, lines) : rendered;
  }
  const plainLines = lines.map(stripAnsi);
  const diffMask = buildClaudeDiffMask(plainLines);
  const rendered = lines.map((line, index) => {
    if (!diffMask[index]) {
      const html = converter.toHtml(line);
      return ensureLineContent(adjustLowContrast(html, theme, options));
    }
    const plainLine = plainLines[index] ?? "";
    return ensureLineContent(renderClaudeDiffLine(plainLine));
  });
  return rendered;
};
