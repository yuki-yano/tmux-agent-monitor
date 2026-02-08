const ansiEscapePattern = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, "g");
const ansiSgrPattern = new RegExp(String.raw`(\u001b\[)([0-9:;]*)(m)`, "g");
const ansiOscPattern = new RegExp(String.raw`\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)`, "g");
const ansiCharsetDesignatePattern = new RegExp(String.raw`\u001b[\(\)\*\+\-\.\/][0-~]`, "g");
const ansiSingleCharacterPattern = new RegExp(String.raw`\u001b(?:[@-Z\\^_]|[=>])`, "g");
const ansiControlPattern = new RegExp(
  String.raw`[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]`,
  "g",
);
const backgroundColorPattern = /background-color:\s*([^;"']+)/i;
const backgroundColorPatternGlobal = /background-color:\s*([^;"']+)/gi;
const unicodeTableBorderPattern = /^(\s*)([┌├└]).*([┐┤┘])\s*$/;
const unicodeTableRowPattern = /^(\s*)│(.*)│\s*$/;
const tableHtmlLinePrefix = "__VDE_TABLE_HTML__:";
type UnicodeTableCell = {
  text: string;
  align: "left" | "center" | "right";
};

export const stripAnsi = (value: string) => value.replace(ansiEscapePattern, "");

const normalizeSgrParams = (params: string) => {
  if (!params.includes(":")) {
    return params;
  }
  return params.replace(/:/g, ";").replace(/;{2,}/g, ";").replace(/^;|;$/g, "");
};

export const sanitizeAnsiForHtml = (value: string) =>
  value
    .replace(ansiSgrPattern, (_match, prefix: string, params: string, suffix: string) => {
      return `${prefix}${normalizeSgrParams(params)}${suffix}`;
    })
    .replace(ansiOscPattern, "")
    .replace(ansiCharsetDesignatePattern, "")
    .replace(ansiSingleCharacterPattern, "")
    .replace(ansiControlPattern, "");

export const extractBackgroundColor = (html: string): string | null => {
  const match = html.match(backgroundColorPattern);
  return match?.[1]?.trim() ?? null;
};

export const replaceBackgroundColors = (
  html: string,
  replacer: (match: string, rawValue: string) => string,
) => html.replace(backgroundColorPatternGlobal, replacer);

export const ensureLineContent = (html: string): string => {
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

export const normalizeLineBreaks = (text: string) => text.replace(/\r\n/g, "\n");

export const splitLines = (text: string) => normalizeLineBreaks(text).split("\n");

const parseUnicodeTableBorder = (plainLine: string) => {
  const match = plainLine.match(unicodeTableBorderPattern);
  if (!match) return null;
  return {
    indent: match[1] ?? "",
    left: match[2] ?? "",
    right: match[3] ?? "",
  };
};

const parseUnicodeTableRow = (plainLine: string) => {
  const match = plainLine.match(unicodeTableRowPattern);
  if (!match) return null;
  const indent = match[1] ?? "";
  const body = match[2] ?? "";
  const cells = body.split("│").map((cell): UnicodeTableCell => {
    const leadingSpaces = cell.match(/^ +/)?.[0].length ?? 0;
    const trailingSpaces = cell.match(/ +$/)?.[0].length ?? 0;
    const trimmed = cell.trim();
    let align: UnicodeTableCell["align"] = "left";
    if (trimmed.length > 0) {
      // Box-drawing tables usually keep one baseline space on both sides.
      // Determine intent from the *extra* spaces beyond that baseline.
      const extraLeading = Math.max(leadingSpaces - 1, 0);
      const extraTrailing = Math.max(trailingSpaces - 1, 0);
      if (extraLeading > 0 && extraTrailing === 0) {
        align = "right";
      } else if (extraLeading > 0 && extraTrailing > 0) {
        align =
          Math.abs(extraLeading - extraTrailing) <= 1
            ? "center"
            : extraLeading > extraTrailing
              ? "right"
              : "left";
      }
    }
    return { text: trimmed, align };
  });
  if (cells.length === 0) return null;
  return { indent, cells };
};

const isUnicodeTableCandidateLine = (plainLine: string) =>
  parseUnicodeTableBorder(plainLine) !== null || parseUnicodeTableRow(plainLine) !== null;

const padCells = (cells: UnicodeTableCell[], columnCount: number) => {
  if (cells.length >= columnCount) return cells;
  return [
    ...cells,
    ...new Array(columnCount - cells.length)
      .fill(null)
      .map((): UnicodeTableCell => ({ text: "", align: "left" })),
  ];
};

const isCombiningCharacter = /\p{Mark}/u;

const isFullWidthCodePoint = (codePoint: number): boolean =>
  codePoint >= 0x1100 &&
  (codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
    (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd));

const getCharacterDisplayWidth = (char: string): number => {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0) return 0;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (isCombiningCharacter.test(char)) return 0;
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
};

export const getTextDisplayWidth = (text: string): number =>
  Array.from(text).reduce((width, char) => width + getCharacterDisplayWidth(char), 0);
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildUnicodeTableHtml = (rows: UnicodeTableCell[][], indent: string) => {
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const normalizedRows = rows.map((row) => padCells(row, columnCount));
  const columnWidths = new Array<number>(columnCount).fill(0);
  normalizedRows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      const width = getTextDisplayWidth(cell.text);
      columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] ?? 0, width);
    });
  });

  const colWidthsCh = columnWidths.map((width) => Math.max(width, 1) + 2);
  const totalWidthCh = colWidthsCh.reduce((sum, width) => sum + width, 0);
  const colgroup = colWidthsCh
    .map((width) => `<col style="width:${width}ch; min-width:${width}ch;" />`)
    .join("");
  const rowsHtml = normalizedRows
    .map((row, rowIndex) => {
      const className = rowIndex === 0 ? ' class="vde-unicode-table-header"' : "";
      const cellsHtml = row
        .map((cell) => {
          const escaped = escapeHtml(stripAnsi(cell.text));
          const content = escaped.length > 0 ? escaped : "&nbsp;";
          return `<td class="vde-unicode-table-cell-${cell.align}">${content}</td>`;
        })
        .join("");
      return `<tr${className}>${cellsHtml}</tr>`;
    })
    .join("");
  return `${indent}<span class="vde-unicode-table-wrap"><table class="vde-unicode-table" style="width:${totalWidthCh}ch;"><colgroup>${colgroup}</colgroup><tbody>${rowsHtml}</tbody></table></span>`;
};

export const isUnicodeTableHtmlLine = (line: string) => line.startsWith(tableHtmlLinePrefix);

export const unwrapUnicodeTableHtmlLine = (line: string) => line.slice(tableHtmlLinePrefix.length);

export const normalizeUnicodeTableLines = (lines: string[]): string[] => {
  const normalized: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const firstLine = lines[index] ?? "";
    const firstPlain = stripAnsi(firstLine);
    if (!isUnicodeTableCandidateLine(firstPlain)) {
      normalized.push(firstLine);
      index += 1;
      continue;
    }

    const blockRows: string[] = [];
    const blockOriginal: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const originalLine = lines[cursor] ?? "";
      const plainLine = stripAnsi(originalLine);
      if (!isUnicodeTableCandidateLine(plainLine)) {
        break;
      }
      blockRows.push(plainLine);
      blockOriginal.push(originalLine);
      cursor += 1;
    }

    const parsedRows = blockRows
      .map((line) => parseUnicodeTableRow(line))
      .filter((row): row is { indent: string; cells: UnicodeTableCell[] } => row !== null);

    if (parsedRows.length === 0) {
      normalized.push(...blockOriginal);
      index = cursor;
      continue;
    }

    const borderLines = blockRows
      .map((line) => parseUnicodeTableBorder(line))
      .filter(
        (border): border is { indent: string; left: string; right: string } => border !== null,
      );
    if (borderLines.length < 2) {
      normalized.push(...blockOriginal);
      index = cursor;
      continue;
    }

    const indent = parsedRows[0]?.indent ?? borderLines[0]?.indent ?? "";
    const html = buildUnicodeTableHtml(
      parsedRows.map((row) => row.cells),
      indent,
    );
    normalized.push(`${tableHtmlLinePrefix}${html}`);
    index = cursor;
  }

  return normalized;
};

export const wrapLineBackground = (html: string, color: string): string =>
  `<span style="background-color:${color}; display:block; width:100%;">${html}</span>`;

export const hasVisibleText = (line: string): boolean => stripAnsi(line).length > 0;
