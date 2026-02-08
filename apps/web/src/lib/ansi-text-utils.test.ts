import { describe, expect, it } from "vitest";

import {
  ensureLineContent,
  isUnicodeTableHtmlLine,
  normalizeUnicodeTableLines,
  replaceBackgroundColors,
  sanitizeAnsiForHtml,
  stripAnsi,
  unwrapUnicodeTableHtmlLine,
} from "./ansi-text-utils";

describe("ansi-text-utils", () => {
  it("strips ANSI escape codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("sanitizes unsupported ANSI control sequences but keeps CSI", () => {
    const value =
      "\u001b(B\u001b[31mred\u001b[0m \u001b]8;;https://example.com/\u001b\\link\u001b]8;;\u001b\\";
    expect(sanitizeAnsiForHtml(value)).toBe("\u001b[31mred\u001b[0m link");
  });

  it("normalizes colon-based SGR truecolor parameters", () => {
    const value = "\u001b[38:2::215:119:87mcolor\u001b[0m";
    expect(sanitizeAnsiForHtml(value)).toBe("\u001b[38;2;215;119;87mcolor\u001b[0m");
  });

  it("ensures line content when html is empty", () => {
    expect(ensureLineContent("")).toContain("&#x200B;");
  });

  it("keeps existing html content", () => {
    expect(ensureLineContent("<span>hi</span>")).toBe("<span>hi</span>");
  });

  it("replaces background colors using replacer", () => {
    const html = '<span style="background-color:#000">x</span>';
    const replaced = replaceBackgroundColors(html, (_match, rawValue) => {
      return `background-color:${rawValue}-changed`;
    });
    expect(replaced).toContain("background-color:#000-changed");
  });

  it("normalizes unicode table rows into html table", () => {
    const lines = ["┌─┬─┐", "│AAA│B│", "├─┼─┤", "│C│DDDD│", "└─┴─┘"];
    const normalized = normalizeUnicodeTableLines(lines);
    expect(normalized).toHaveLength(1);
    const line = normalized[0] ?? "";
    expect(isUnicodeTableHtmlLine(line)).toBe(true);
    const html = unwrapUnicodeTableHtmlLine(line);
    expect(html).toContain('class="vde-unicode-table"');
    expect(html).toContain("<colgroup>");
    expect(html).toContain('class="vde-unicode-table-cell-left">AAA</td>');
    expect(html).toContain('class="vde-unicode-table-cell-left">DDDD</td>');
  });

  it("normalizes unicode table rows with wide japanese characters", () => {
    const lines = ["┌─┬─┐", "│ファイル│役割│", "├─┼─┤", "│foo.ts│メイン│", "└─┴─┘"];
    const normalized = normalizeUnicodeTableLines(lines);
    expect(normalized).toHaveLength(1);
    const html = unwrapUnicodeTableHtmlLine(normalized[0] ?? "");
    expect(html).toContain("ファイル");
    expect(html).toContain("foo.ts");
    expect(html).toContain("メイン");
  });

  it("normalizes pane103 style unicode table blocks with long japanese descriptions", () => {
    const lines = [
      "  ┌──────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────┐",
      "  │               ファイル               │                                             変更内容                                              │",
      "  ├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤",
      "  │ atoms/replaySelection.ts             │ isAllCurrentPageSelectedAtom（全選択判定）と toggleSelectAllCurrentPageAtom（全選択トグル）を追加 │",
      "  ├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤",
      "  │ components/SelectionToolbar.tsx      │ バッジの左に全選択ボタンを配置。アイコンとラベルが全選択/選択解除でトグル                         │",
      "  ├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤",
      "  │ atoms/replaySelection.test.ts        │ ページ全選択の7テストケース追加（空ページ、一部選択、全選択、トグル、他ページ保持）               │",
      "  ├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤",
      "  │ components/SelectionToolbar.test.tsx │ ボタン表示・クリック動作の4テストケース追加                                                       │",
      "  └──────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────┘",
    ];
    const normalized = normalizeUnicodeTableLines(lines);

    expect(normalized).toHaveLength(1);
    const html = unwrapUnicodeTableHtmlLine(normalized[0] ?? "");
    expect(html).toContain("toggleSelectAllCurrentPageAtom");
    expect(html).toContain("アイコンとラベルが全選択/選択解除");
    expect(html).toContain('style="width:');
  });

  it("infers cell alignment from original spacing", () => {
    const lines = [
      "┌──────────┬──────────┬──────────┬──────────┐",
      "│ lpadded  │left      │  center  │     right│",
      "└──────────┴──────────┴──────────┴──────────┘",
    ];
    const normalized = normalizeUnicodeTableLines(lines);
    const html = unwrapUnicodeTableHtmlLine(normalized[0] ?? "");
    expect(html).toContain('class="vde-unicode-table-cell-left">lpadded</td>');
    expect(html).toContain('class="vde-unicode-table-cell-left">left</td>');
    expect(html).toContain('class="vde-unicode-table-cell-center">center</td>');
    expect(html).toContain('class="vde-unicode-table-cell-right">right</td>');
  });

  it("preserves intra-cell spacing for left-right text placement", () => {
    const lines = [
      "┌──────────────────────────────┐",
      "│ left                right   │",
      "└──────────────────────────────┘",
    ];
    const normalized = normalizeUnicodeTableLines(lines);
    const html = unwrapUnicodeTableHtmlLine(normalized[0] ?? "");
    expect(html).toMatch(/left {10,}right/);
  });
});
